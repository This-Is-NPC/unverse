import { record, SchemaError } from "./schema.js";

export type PlanKind = "schema" | "data" | "access";
export type PlanEffect = "write" | "destructive";

export interface PlanHeader {
  readonly kind: PlanKind;
  readonly effect: PlanEffect;
}

const kinds: readonly string[] = ["schema", "data", "access"];
const effects: readonly string[] = ["write", "destructive"];

export function readPlanHeader(input: unknown): PlanHeader {
  const value = record(input);
  if (!kinds.includes(String(value.kind)))
    throw new SchemaError(
      "invalid-input",
      "The plan kind must be schema, data, or access.",
    );
  if (!effects.includes(String(value.effect)))
    throw new SchemaError(
      "invalid-input",
      "The plan effect must be write or destructive.",
    );
  return { kind: value.kind as PlanKind, effect: value.effect as PlanEffect };
}
