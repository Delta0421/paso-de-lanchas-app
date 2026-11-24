import type { AuditLogger, Clock } from "@/application/shared/ports";
import { systemClock } from "@/application/shared/ports";
import { parseInput } from "@/application/shared/input-error";
import { DomainError } from "@/domain/shared/domain-error";
import { Money } from "@/domain/shared/money";
import { validateTopUpAmount } from "@/domain/wallet/wallet";

import type { WalletRepository } from "./ports";
import { topUpCashSchema } from "./wallet-input";

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

export interface CashTopUpActor {
  adminId: string;
  deviceId: string;
}

export function createTopUpCash<TransactionContext>(deps: {
  repo: WalletRepository<TransactionContext>;
  audit: AuditLogger;
  clock?: Clock;
}) {
  const clock = deps.clock ?? systemClock;

  return async function topUpCash(rawInput: unknown, actor: CashTopUpActor) {
    const parsed = parseInput<"passengerId" | "amount", typeof topUpCashSchema>(
      topUpCashSchema,
      rawInput,
    );
    const passenger = await deps.repo.findPassengerById(parsed.passengerId);
    if (!passenger) {
      throw new DomainError(
        "PASSENGER_NOT_FOUND",
        "No se encontró un pasajero activo con monedero.",
      );
    }

    const amount = Money.fromPesos(parsed.amount);
    validateTopUpAmount(amount, await deps.repo.getTopUpLimits());
    const at = clock.now();

    const result = await retryConcurrentUpdate(() =>
      deps.repo.withTransaction(async (tx) => {
        const cashShiftId = await deps.repo.ensureOpenCashShift(tx, {
          adminId: actor.adminId,
          deviceId: actor.deviceId,
          at,
        });
        const transaction = await deps.repo.credit(tx, {
          userId: passenger.id,
          amount,
          type: "TOPUP_CASH",
          performedById: actor.adminId,
          at,
          reason: "Recarga en efectivo",
          cashShiftId,
        });
        return { transaction, cashShiftId };
      }),
    );

    await deps.audit.log({
      userId: actor.adminId,
      action: "WALLET_TOPUP_CASH",
      entity: "wallet_transactions",
      entityId: result.transaction.id,
      details: {
        passengerId: passenger.id,
        amountCents: amount.cents,
        cashShiftId: result.cashShiftId,
      },
    });

    return result.transaction;
  };
}
