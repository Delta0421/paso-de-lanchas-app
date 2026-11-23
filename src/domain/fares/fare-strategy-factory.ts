import { DomainError } from "@/domain/shared/domain-error";

import { BoatFareStrategy } from "./boat-fare-strategy";
import { FerryFareStrategy } from "./ferry-fare-strategy";
import type { FareStrategy, FareVesselKind } from "./fare-strategy";

const boatFareStrategy = new BoatFareStrategy();
const ferryFareStrategy = new FerryFareStrategy();

export function createFareStrategy(vesselKind: FareVesselKind): FareStrategy {
  switch (vesselKind) {
    case "BOAT":
      return boatFareStrategy;
    case "FERRY":
      return ferryFareStrategy;
    default:
      throw new DomainError("INVALID_VESSEL_KIND", "Tipo de embarcación no válido.");
  }
}
