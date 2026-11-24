/**
 * Verifica que dos recargas simultáneas actualicen el saldo y el libro de movimientos sin
 * perder ninguna operación. Requiere `docker compose up -d` y `npm run db:test:prepare`.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTopUpCash } from "@/application/wallet/top-up-cash";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaWalletRepository } from "@/infrastructure/wallet/prisma-wallet-repository";

const url = process.env.DATABASE_URL_TEST;
const prisma = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;

describe.skipIf(!prisma)("recargas de monedero concurrentes", () => {
  const db = prisma!;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const passengerEmail = `wallet-passenger-${suffix}@pasolanchas.test`;
  const adminEmail = `wallet-admin-${suffix}@pasolanchas.test`;
  const dockCode = `WT${suffix.slice(0, 7)}`;
  let passengerId: string | null = null;
  let adminId: string | null = null;
  let dockId: string | null = null;
  let deviceId: string | null = null;

  beforeAll(async () => {
    const dock = await db.dock.create({
      data: {
        code: dockCode,
        name: "Muelle de prueba",
        latitude: "18.149700",
        longitude: "-94.434900",
      },
    });
    dockId = dock.id;
    const admin = await db.user.create({
      data: {
        email: adminEmail,
        fullName: "Admin de prueba",
        passwordHash: "test-hash",
        role: "ADMIN",
        status: "ACTIVE",
        dockId: dock.id,
      },
    });
    adminId = admin.id;
    const device = await db.authorizedDevice.create({
      data: {
        dockId: dock.id,
        name: "Equipo de prueba",
        deviceTokenHash: `wallet-device-${suffix}`,
        status: "APPROVED",
        requestedById: admin.id,
        approvedById: admin.id,
        approvedAt: new Date(),
      },
    });
    deviceId = device.id;
    const passenger = await db.user.create({
      data: {
        email: passengerEmail,
        fullName: "Pasajero de prueba",
        passwordHash: "test-hash",
        role: "PASSENGER",
        status: "ACTIVE",
      },
    });
    passengerId = passenger.id;
    await db.wallet.create({ data: { userId: passenger.id } });
  });

  afterAll(async () => {
    if (passengerId) {
      const wallet = await db.wallet.findUnique({
        where: { userId: passengerId },
        select: { id: true },
      });
      if (wallet) {
        await db.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
        await db.cashShift.deleteMany({ where: { adminId: adminId ?? "" } });
        await db.wallet.delete({ where: { id: wallet.id } });
      }
    }
    if (deviceId) await db.authorizedDevice.delete({ where: { id: deviceId } });
    if (passengerId) await db.user.delete({ where: { id: passengerId } });
    if (adminId) await db.user.delete({ where: { id: adminId } });
    if (dockId) await db.dock.delete({ where: { id: dockId } });
    await db.$disconnect();
  });

  it("preserva ambas recargas, el saldo acumulado y un solo turno de caja", async () => {
    const repo = new PrismaWalletRepository(db);
    const audit = { log: vi.fn(async () => {}) };
    const topUpCash = createTopUpCash({ repo, audit });
    const actor = { adminId: adminId!, deviceId: deviceId! };

    await Promise.all([
      topUpCash({ passengerId, amount: "10.00" }, actor),
      topUpCash({ passengerId, amount: "10.00" }, actor),
    ]);

    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId: passengerId! } });
    const transactions = await db.walletTransaction.findMany({
      where: { walletId: wallet.id },
    });
    const shifts = await db.cashShift.findMany({ where: { adminId: adminId! } });

    expect(wallet.balance.toString()).toBe("20");
    expect(wallet.version).toBe(2);
    expect(transactions).toHaveLength(2);
    expect(transactions.every((item) => item.type === "TOPUP_CASH")).toBe(true);
    expect(transactions.every((item) => item.cashShiftId === shifts[0]?.id)).toBe(true);
    expect(shifts).toHaveLength(1);
    expect(audit.log).toHaveBeenCalledTimes(2);
  });
});
