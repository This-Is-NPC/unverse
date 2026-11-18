import {
  canonical,
  type PlanKind,
  parseMapping,
  parseModel,
  planSchema,
  readPlanHeader,
  record,
  type SchemaEnvironment,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "./client.js";
import { applyDataPlan, verifyDataPlan } from "./data-plan.js";
import { applySchema, assertEnvironment, inspectSchema } from "./schema.js";

export interface PlanOutcome {
  readonly kind: PlanKind;
  readonly status: "ok" | "failed" | "inconclusive";
  readonly report: unknown;
}

export async function applyPlan(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
  confirm: boolean,
): Promise<PlanOutcome> {
  const { kind } = readPlanHeader(input);
  if (kind === "schema") {
    const report = await applySchema(client, input, environment, confirm);
    const unfinished = [
      report.operations,
      report.blocked,
      report.unverified,
    ].some((remaining) => remaining.length !== 0);
    return { kind, status: unfinished ? "inconclusive" : "ok", report };
  }
  const report = await applyDataPlan(client, input, environment, confirm);
  return { kind, status: report.verified ? "ok" : "failed", report };
}

export async function verifyPlan(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
): Promise<PlanOutcome> {
  const { kind } = readPlanHeader(input);
  const report =
    kind === "schema"
      ? await verifySchemaPlan(client, input, environment)
      : await verifyDataPlan(client, input, environment);
  return { kind, status: report.satisfied ? "ok" : "failed", report };
}

async function verifySchemaPlan(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
) {
  const value = record(input);
  if (
    value.planVersion !== 1 ||
    value.kind !== "schema" ||
    canonical(value.environment) !== canonical(environment)
  )
    throw new DataverseError(
      "invalid-input",
      "Plan is invalid or bound to another environment.",
    );
  const model = parseModel(value.model);
  const mapping = parseMapping(value.mapping);
  await assertEnvironment(client, environment);
  const current = await planSchema(
    model,
    mapping,
    environment,
    await inspectSchema(client, mapping, model),
  );
  return {
    kind: "schema" as const,
    satisfied: [current.operations, current.blocked, current.unverified].every(
      (remaining) => remaining.length === 0,
    ),
    operations: current.operations,
    blocked: current.blocked,
    unverified: current.unverified,
  };
}
