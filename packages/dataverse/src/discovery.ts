import { type DataverseClient, DataverseError } from "./client.js";
import { endpoint, guid, nullableText, text } from "./odata.js";

export interface Resource {
  readonly id: string;
  readonly name: string;
  readonly uniqueName: string | null;
  readonly kind: string;
  readonly state: number | null;
}

export function matches(
  search: string | undefined,
  ...values: readonly (string | null)[]
): boolean {
  return (
    search === undefined ||
    values.some((value) => value?.toLowerCase().includes(search.toLowerCase()))
  );
}

export async function solutions(client: DataverseClient, search?: string) {
  const result = await client.collect(
    endpoint("solutions", {
      $select: "solutionid,uniquename,friendlyname,version,ismanaged",
    }),
  );
  return result.rows
    .map((row) => ({
      id: guid(text(row, "solutionid")),
      uniqueName: text(row, "uniquename"),
      name: text(row, "friendlyname"),
      version: text(row, "version"),
      managed: boolean(row.ismanaged),
    }))
    .filter((row) => matches(search, row.name, row.uniqueName))
    .sort((a, b) => a.uniqueName.localeCompare(b.uniqueName));
}

export async function solutionComponents(
  client: DataverseClient,
  solutionId: string,
) {
  const result = await client.collect(
    endpoint("solutioncomponents", {
      $select:
        "solutioncomponentid,objectid,componenttype,rootcomponentbehavior",
      $filter: `_solutionid_value eq ${guid(solutionId)}`,
    }),
  );
  return result.rows
    .map((row) => ({
      id: guid(text(row, "solutioncomponentid")),
      objectId: nullableText(row, "objectid"),
      componentType: number(row.componenttype),
      rootBehavior:
        row.rootcomponentbehavior === null
          ? null
          : number(row.rootcomponentbehavior),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function apps(
  client: DataverseClient,
  kind: "all" | "canvas" | "model-driven" = "all",
  search?: string,
): Promise<readonly Resource[]> {
  if (!["all", "canvas", "model-driven"].includes(kind))
    throw new DataverseError(
      "invalid-input",
      "App kind must be all, canvas, or model-driven.",
    );
  const result: Resource[] = [];
  for (const type of kind === "all" ? ["canvas", "model-driven"] : [kind]) {
    const canvas = type === "canvas";
    const response = await client.collect(
      endpoint(canvas ? "canvasapps" : "appmodules", {
        $select: canvas
          ? "canvasappid,name,displayname"
          : "appmoduleid,name,uniquename,statecode",
      }),
    );
    for (const row of response.rows) {
      const name = text(row, canvas ? "displayname" : "name");
      const uniqueName = nullableText(row, canvas ? "name" : "uniquename");
      if (matches(search, name, uniqueName))
        result.push({
          id: guid(text(row, canvas ? "canvasappid" : "appmoduleid")),
          name,
          uniqueName,
          kind: type,
          state: canvas ? null : number(row.statecode),
        });
    }
  }
  return result.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

export async function flows(
  client: DataverseClient,
  search?: string,
): Promise<readonly Resource[]> {
  const response = await client.collect(
    endpoint("workflows", {
      $select: "workflowid,name,uniquename,statecode",
      $filter: "category eq 5",
    }),
  );
  return response.rows
    .map((row) => ({
      id: guid(text(row, "workflowid")),
      name: text(row, "name"),
      uniqueName: nullableText(row, "uniquename"),
      kind: "cloud-flow",
      state: number(row.statecode),
    }))
    .filter((row) => matches(search, row.name, row.uniqueName))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function users(client: DataverseClient, search?: string) {
  const response = await client.collect(
    endpoint("systemusers", {
      $select:
        "systemuserid,fullname,internalemailaddress,domainname,isdisabled,_businessunitid_value",
    }),
  );
  return response.rows
    .map((row) => ({
      id: guid(text(row, "systemuserid")),
      name: text(row, "fullname"),
      email: nullableText(row, "internalemailaddress"),
      domain: nullableText(row, "domainname"),
      disabled: boolean(row.isdisabled),
      businessUnitId: nullableText(row, "_businessunitid_value"),
    }))
    .filter((row) => matches(search, row.name, row.email, row.domain))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface Variable {
  readonly schemaName: string;
  readonly name: string;
  readonly type: number;
  readonly configured: boolean | null;
  readonly value: string | null;
  readonly source: "override" | "default" | "unset" | "secret" | "ambiguous";
}

async function readVariables(
  client: DataverseClient,
): Promise<readonly Variable[]> {
  const response = await client.collect(
    endpoint("environmentvariabledefinitions", {
      $select: "environmentvariabledefinitionid,schemaname,displayname,type",
    }),
  );
  const result: Variable[] = [];
  for (const row of response.rows) {
    const type = number(row.type);
    const base = {
      schemaName: text(row, "schemaname"),
      name: text(row, "displayname"),
      type,
    };
    if (type === 100000005) {
      result.push({ ...base, configured: null, value: null, source: "secret" });
      continue;
    }
    const values = await client.collect(
      endpoint("environmentvariablevalues", {
        $select: "value",
        $filter: `_environmentvariabledefinitionid_value eq ${guid(text(row, "environmentvariabledefinitionid"))} and statecode eq 0`,
      }),
    );
    if (values.rows.length > 1) {
      result.push({
        ...base,
        configured: null,
        value: null,
        source: "ambiguous",
      });
      continue;
    }
    const override =
      values.rows.length === 1
        ? nullableText(values.rows[0] ?? {}, "value")
        : null;
    const defaults = await client.collect(
      endpoint("environmentvariabledefinitions", {
        $select: "defaultvalue",
        $filter: `environmentvariabledefinitionid eq ${guid(text(row, "environmentvariabledefinitionid"))}`,
      }),
    );
    if (defaults.rows.length !== 1)
      throw new DataverseError(
        "service",
        "Variable definition changed during inventory.",
      );
    const fallback = nullableText(defaults.rows[0] ?? {}, "defaultvalue");
    const value = override ?? fallback;
    result.push({
      ...base,
      configured: value !== null,
      value,
      source:
        override !== null
          ? "override"
          : fallback !== null
            ? "default"
            : "unset",
    });
  }
  return result.sort((a, b) => a.schemaName.localeCompare(b.schemaName));
}

export async function variables(client: DataverseClient, search?: string) {
  return (await readVariables(client))
    .filter((row) => matches(search, row.schemaName, row.name))
    .map(({ value: _value, ...row }) => ({ ...row, value: "[MASKED]" }));
}

export async function compareEnvironments(
  source: DataverseClient,
  target: DataverseClient,
  scope: "solutions" | "variables" | "components" | "all" = "all",
  componentSolution?: string,
) {
  if (!["solutions", "variables", "components", "all"].includes(scope))
    throw new DataverseError(
      "invalid-input",
      "Comparison scope must be solutions, variables, components, or all.",
    );
  const differences: {
    kind: string;
    key: string;
    fields: readonly string[];
  }[] = [];
  const unknown: string[] = [];
  const [sourceSolutions, targetSolutions] =
    scope === "variables"
      ? [[], []]
      : await Promise.all([solutions(source), solutions(target)]);
  if (scope === "components" && !componentSolution)
    throw new DataverseError(
      "invalid-input",
      "Component comparison requires an explicit solution unique name.",
    );
  if (scope === "solutions" || scope === "all")
    compareRows(
      sourceSolutions,
      targetSolutions,
      "uniqueName",
      ["version", "managed"],
      "solution",
      differences,
    );
  if (
    scope === "components" ||
    (scope === "all" && componentSolution !== undefined)
  ) {
    const left = sourceSolutions.filter(
      (solution) => solution.uniqueName === componentSolution,
    );
    const right = targetSolutions.filter(
      (solution) => solution.uniqueName === componentSolution,
    );
    if (left.length !== 1 || right.length !== 1)
      throw new DataverseError(
        "invalid-input",
        "The selected component solution must exist uniquely in both environments.",
      );
    const sourceComponents = await solutionComponents(
      source,
      left[0]?.id ?? "",
    );
    const targetComponents = await solutionComponents(
      target,
      right[0]?.id ?? "",
    );
    for (const row of [...sourceComponents, ...targetComponents])
      if (row.objectId === null)
        unknown.push(`component:${row.componentType}:unknown-object`);
    const keyed = (rows: typeof sourceComponents) =>
      rows
        .filter((row) => row.objectId !== null)
        .map((row) => ({
          key: `${row.componentType}:${row.objectId}`,
          rootBehavior: row.rootBehavior,
        }));
    compareRows(
      keyed(sourceComponents),
      keyed(targetComponents),
      "key",
      ["rootBehavior"],
      "component-membership",
      differences,
    );
  }
  if (scope === "variables" || scope === "all") {
    const left = await readVariables(source);
    const right = await readVariables(target);
    compareRows(
      left,
      right,
      "schemaName",
      ["type", "configured"],
      "variable",
      differences,
    );
    for (const row of left) {
      const other = right.find(
        (candidate) => candidate.schemaName === row.schemaName,
      );
      if (other === undefined) continue;
      if (
        [row.source, other.source].some(
          (value) => value === "secret" || value === "ambiguous",
        )
      )
        unknown.push(row.schemaName);
      else if (row.value !== other.value)
        differences.push({
          kind: "variable-value",
          key: row.schemaName,
          fields: ["value"],
        });
    }
  }
  return {
    equal: differences.length === 0 && unknown.length === 0,
    differences,
    unknown,
    limitations: [
      "Values and value hashes are never returned. Secret variables and ambiguous overrides are not compared.",
      "Component membership compares component type and object ID, not semantic dependencies or app contents; independently recreated objects can have different IDs.",
      ...(componentSolution === undefined
        ? [
            "Component membership was not compared; select --component-solution for a named solution.",
          ]
        : []),
      "Inventory is limited by the caller's visibility and is not an environment-wide transactional snapshot.",
    ],
  };
}

function compareRows<T extends object>(
  left: readonly T[],
  right: readonly T[],
  key: keyof T,
  fields: readonly (keyof T)[],
  kind: string,
  output: { kind: string; key: string; fields: readonly string[] }[],
) {
  const a = new Map(left.map((row) => [String(row[key]), row]));
  const b = new Map(right.map((row) => [String(row[key]), row]));
  if (a.size !== left.length || b.size !== right.length)
    throw new DataverseError(
      "service",
      "Inventory has duplicate stable names; comparison is ambiguous.",
    );
  for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const l = a.get(name);
    const r = b.get(name);
    const changed =
      l === undefined || r === undefined
        ? [l === undefined ? "source-missing" : "target-missing"]
        : fields.filter((field) => l[field] !== r[field]).map(String);
    if (changed.length) output.push({ kind, key: name, fields: changed });
  }
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new DataverseError(
      "service",
      "Inventory boolean metadata is missing.",
    );
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new DataverseError(
      "service",
      "Inventory numeric metadata is missing.",
    );
  return value;
}
