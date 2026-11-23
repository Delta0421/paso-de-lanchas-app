import type { Money } from "@/domain/shared/money";

export type FareVesselKind = "BOAT" | "FERRY";
export type FareCategory = "GENERAL" | "STUDENT" | "INAPAM" | "PEDESTRIAN" | "VEHICLE";
export type DiscountType = "STUDENT" | "INAPAM";
export type DiscountStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export interface FareOption {
  id: string;
  vesselKind: FareVesselKind;
  category: FareCategory;
  vehicleTypeId: number | null;
  amount: Money;
  validFrom: Date;
  validTo: Date | null;
}

export interface PassengerDiscount {
  type: DiscountType;
  status: DiscountStatus;
  validUntil: Date | null;
}

export interface FareStrategyInput {
  vehicleTypeId?: number | null;
  discount?: PassengerDiscount | null;
}

export interface ResolvedFare {
  fareId: string;
  vesselKind: FareVesselKind;
  category: FareCategory;
  vehicleTypeId: number | null;
  amount: Money;
}

export interface FareStrategy {
  resolve(input: FareStrategyInput, fares: readonly FareOption[], at: Date): ResolvedFare;
}
