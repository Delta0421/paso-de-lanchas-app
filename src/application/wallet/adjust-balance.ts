import type { AuditLogger, Clock } from "@/application/shared/ports";
import { systemClock } from "@/application/shared/ports";
import { parseInput } from "@/application/shared/input-error";
import { DomainError } from "@/domain/shared/domain-error";
import { Money } from "@/domain/shared/money";

import type { WalletRepository } from "./ports";
import { adjustBalanceSchema } from "./wallet-input";

const MAX_CONCURRENT_RETRIES = 3;

async function retryConcurrentUpdate<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_CONCURRENT_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "CONCURRENT_UPDATE") throw error;
      if (attempt === MAX_CONCURRENT_RETRIES - 1) {
        throw new DomainError(
          "CONCURRENT_UPDATE",
          "El saldo cambió varias veces. Revisa el movimiento e inténtalo de nuevo.",
        );
      }
    }
  }
  throw new DomainError("CONCURRENT_UPDATE", "No se pudo actualizar el saldo.");
}

export function createAdjustBalance<TransactionContext>(deps: {
  repo: WalletRepository<TransactionContext>;
  audit: AuditLogger;
  clock?: Clock;
}) {
  const clock = deps.clock ?? systemClock;

  return async function adjustBalance(rawInput: unknown, adminId: string) {
    const parsed = parseInput<
      "passengerId" | "type" | "direction" | "amount" | "reason",
      typeof adjustBalanceSchema
    >(adjustBalanceSchema, rawInput);
    const passenger = await deps.repo.findPassengerById(parsed.passengerId);
    if (!passenger) {
      throw new DomainError(
        "PASSENGER_NOT_FOUND",
        "No se encontró un pasajero activo con monedero.",
      );
    }
    if (parsed.type === "REFUND" && parsed.direction !== "CREDIT") {
      throw new DomainError("INVALID_REFUND_DIRECTION", "Un reembolso debe abonarse al monedero.");
    }

    const amount = Money.fromPesos(parsed.amount);
    const at = clock.now();
    const transaction = await retryConcurrentUpdate(() =>
      deps.repo.withTransaction((tx) => {
        const input = {
          userId: passenger.id,
          amount,
          type: parsed.type,
          performedById: adminId,
          at,
          reason: parsed.reason,
        };
        return parsed.direction === "CREDIT"
          ? deps.repo.credit(tx, input)
          : deps.repo.debit(tx, input);
      }),
    );

    await deps.audit.log({
      userId: adminId,
      action: parsed.type === "REFUND" ? "WALLET_REFUND" : "WALLET_ADJUSTED",
      entity: "wallet_transactions",
      entityId: transaction.id,
      details: {
        passengerId: passenger.id,
        amountCents: transaction.amountCents,
        reason: parsed.reason,
      },
    });

    return transaction;
  };
}
