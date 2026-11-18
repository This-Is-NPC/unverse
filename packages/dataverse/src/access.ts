import {
  type AccessDocument,
  canonical,
  fingerprint,
  parseAccessDocument,
  record,
  type SchemaEnvironment,
  type TeamSelector,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "./client.js";
import { readVariable, variableDefinitions } from "./discovery.js";
import { endpoint, guid, literal, text } from "./odata.js";
import { assertEnvironment } from "./schema.js";

export interface AssignTeamRole {
  readonly kind: "assign-team-role";
  readonly teamId: string;
  readonly teamName: string;
  readonly roleId: string;
  readonly roleName: string;
}

export interface AccessPlan {
  readonly accessPlanVersion: 1;
  readonly kind: "access";
  readonly effect: "write";
  readonly environment: SchemaEnvironment;
  readonly document: AccessDocument;
  readonly teams: readonly {
    readonly id: string;
    readonly name: string;
    readonly businessUnitId: string;
  }[];
  readonly satisfied: readonly Omit<AssignTeamRole, "kind">[];
  readonly operations: readonly AssignTeamRole[];
  readonly blocked: readonly {
    readonly teamId: string;
    readonly teamName: string;
    readonly roleName: string;
    readonly reason: string;
  }[];
  readonly observedFingerprint: string;
  readonly fingerprint: string;
  readonly limitations: readonly string[];
}

interface ResolvedTeam {
  readonly id: string;
  readonly name: string;
  readonly businessUnitId: string;
}

const teamColumns = "teamid,name,_businessunitid_value";

async function resolveTeam(
  client: DataverseClient,
  selector: TeamSelector,
): Promise<ResolvedTeam> {
  let filter: string;
  if ("id" in selector) filter = `teamid eq ${guid(selector.id)}`;
  else if ("name" in selector) filter = `name eq ${literal(selector.name)}`;
  else filter = `teamid eq ${await variableTeamId(client, selector)}`;
  const { rows } = await client.collect(
    endpoint("teams", { $select: teamColumns, $filter: filter }),
  );
  if (rows.length !== 1)
    throw new DataverseError(
      "invalid-input",
      rows.length === 0
        ? "A team selector matched no team."
        : "A team name matches several teams; select the team by id.",
    );
  const row = rows[0] ?? {};
  return {
    id: guid(text(row, "teamid")),
    name: text(row, "name"),
    businessUnitId: guid(text(row, "_businessunitid_value")),
  };
}

async function variableTeamId(
  client: DataverseClient,
  selector: { readonly environmentVariable: string },
): Promise<string> {
  const definition = (await variableDefinitions(client)).find(
    (candidate) => candidate.schemaName === selector.environmentVariable,
  );
  if (definition === undefined)
    throw new DataverseError(
      "invalid-input",
      `Environment variable ${selector.environmentVariable} does not exist.`,
    );
  const variable = await readVariable(client, definition);
  if (variable.source === "secret")
    throw new DataverseError(
      "invalid-input",
      `Environment variable ${selector.environmentVariable} is a secret and cannot select a team.`,
    );
  if (variable.value === null)
    throw new DataverseError(
      "invalid-input",
      `Environment variable ${selector.environmentVariable} has no usable value (${variable.source}).`,
    );
  return guid(variable.value);
}

async function roleIn(
  client: DataverseClient,
  name: string,
  businessUnitId: string,
) {
  const { rows } = await client.collect(
    endpoint("roles", {
      $select: "roleid",
      $filter: `name eq ${literal(name)} and _businessunitid_value eq ${businessUnitId}`,
    }),
  );
  return rows.map((row) => guid(text(row, "roleid")));
}

export async function planAccess(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
): Promise<AccessPlan> {
  const document = parseAccessDocument(input);
  const teams: ResolvedTeam[] = [];
  const satisfied: Omit<AssignTeamRole, "kind">[] = [];
  const operations: AssignTeamRole[] = [];
  const blocked: AccessPlan["blocked"][number][] = [];
  const observed: unknown[] = [];
  for (const entry of document.teams) {
    const team = await resolveTeam(client, entry.team);
    if (teams.some((candidate) => candidate.id === team.id))
      throw new DataverseError(
        "invalid-input",
        "The access document selects the same team more than once.",
      );
    teams.push(team);
    const assigned = new Set(
      (
        await client.collect(
          endpoint(`teams(${team.id})/teamroles_association`, {
            $select: "roleid",
          }),
        )
      ).rows.map((row) => guid(text(row, "roleid"))),
    );
    const candidates: unknown[] = [];
    for (const roleName of entry.roles) {
      const ids = await roleIn(client, roleName, team.businessUnitId);
      candidates.push({ roleName, ids: [...ids].sort() });
      const subject = { teamId: team.id, teamName: team.name, roleName };
      const roleId = ids[0];
      if (roleId === undefined || ids.length > 1)
        blocked.push({
          ...subject,
          reason:
            roleId === undefined
              ? "No role with this name exists in the team's business unit."
              : "Several roles with this name exist in the team's business unit.",
        });
      else if (assigned.has(roleId)) satisfied.push({ ...subject, roleId });
      else operations.push({ kind: "assign-team-role", ...subject, roleId });
    }
    observed.push({ team, assigned: [...assigned].sort(), candidates });
  }
  const body = {
    accessPlanVersion: 1 as const,
    kind: "access" as const,
    effect: "write" as const,
    environment,
    document,
    teams,
    satisfied,
    operations,
    blocked,
    observedFingerprint: await fingerprint(observed),
    limitations: [
      "Roles are only added to teams; no role is ever removed.",
      "Roles are resolved by name in each team's own business unit.",
      "Effective record access is not checked.",
    ],
  };
  return { ...body, fingerprint: await fingerprint(body) };
}

async function readAccessPlan(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
): Promise<AccessPlan> {
  const value = record(input);
  if (
    value.accessPlanVersion !== 1 ||
    value.kind !== "access" ||
    canonical(value.environment) !== canonical(environment)
  )
    throw new DataverseError(
      "invalid-input",
      "Access plan is invalid or belongs to another environment.",
    );
  await assertEnvironment(client, environment);
  const { fingerprint: digest, ...body } = value;
  if ((await fingerprint(body)) !== digest)
    throw new DataverseError("invalid-input", "The access plan was modified.");
  return planAccess(client, value.document, environment);
}

export async function verifyAccessPlan(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
) {
  const expected = await readAccessPlan(client, input, environment);
  return {
    kind: "access" as const,
    satisfied:
      expected.operations.length === 0 && expected.blocked.length === 0,
    operations: expected.operations,
    blocked: expected.blocked,
  };
}

export async function applyAccessPlan(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
  confirm: boolean,
) {
  if (!confirm)
    throw new DataverseError(
      "invalid-input",
      "Access apply requires explicit --confirm.",
    );
  const expected = await readAccessPlan(client, input, environment);
  if (expected.blocked.length !== 0)
    throw new DataverseError(
      "invalid-input",
      "The access plan contains blocked roles; no writes were issued.",
    );
  if (
    expected.operations.length !== 0 &&
    canonical(expected) !== canonical(input)
  )
    throw new DataverseError(
      "invalid-input",
      "The access plan is stale; inspect and re-plan.",
    );
  for (const operation of expected.operations)
    await client.write(
      "POST",
      `teams(${operation.teamId})/teamroles_association/$ref`,
      {
        "@odata.id": `${client.url}/api/data/v9.2/roles(${operation.roleId})`,
      },
    );
  const after = await planAccess(client, expected.document, environment);
  return {
    kind: "access" as const,
    verified: after.operations.length === 0 && after.blocked.length === 0,
    assigned: expected.operations,
    operations: after.operations,
    blocked: after.blocked,
    limitations: expected.limitations,
  };
}
