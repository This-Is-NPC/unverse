import {
  type ArtifactItem,
  type ArtifactTypeName,
  artifactTypeNames,
  findArtifactType,
} from "./artifacts.js";

export const artifactsVersion = 1;

export class ArtifactDeclarationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactDeclarationError";
  }
}

export interface MemberSolution {
  readonly uniqueName: string;
  readonly managed: boolean;
  readonly publisher: string | null;
}

export interface MemberItem extends ArtifactItem {
  readonly solutions?: readonly MemberSolution[];
}

export type WhereValue = string | readonly string[] | boolean;
export type SolutionRule = "required" | "forbidden" | readonly string[];

export interface ArtifactRule {
  readonly name?: string;
  readonly displayName?: string;
  readonly solution?: SolutionRule;
  readonly publisher?: readonly string[];
  readonly owner?: readonly string[];
  readonly managed?: boolean;
}

type RuleKey = keyof ArtifactRule;
type WhereField =
  | "name"
  | "id"
  | "displayName"
  | "owner"
  | "managed"
  | "kind"
  | "solution"
  | "publisher";

const ruleKeys = [
  "name",
  "displayName",
  "solution",
  "publisher",
  "owner",
  "managed",
] as const satisfies readonly RuleKey[];
const whereFields = [
  "name",
  "id",
  "displayName",
  "owner",
  "managed",
  "kind",
  "solution",
  "publisher",
] as const satisfies readonly WhereField[];
const topKeys = ["artifactsVersion", "types", "rules"];
const typeKeys = ["from", "where"];
const typeName = /^[a-z][a-z0-9-]*$/;
const placeholder =
  /^([A-Za-z][A-Za-z0-9_-]*)(?::(lower|upper|digits)(?::([1-9][0-9]?))?)?$/;
const systemSolutions: readonly string[] = ["Default", "Active", "Basic"];

interface Condition {
  readonly field: WhereField;
  readonly tests: readonly RegExp[] | boolean;
}

export interface UserArtifactType {
  readonly type: string;
  readonly from: ArtifactTypeName;
  readonly where: Readonly<Record<string, WhereValue>>;
  readonly conditions: readonly Condition[];
}

export interface ArtifactDeclarations {
  readonly types: readonly UserArtifactType[];
  readonly rules: ReadonlyMap<string, ArtifactRule>;
  readonly patterns: ReadonlyMap<string, RegExp>;
}

export interface ArtifactViolation {
  readonly type: string;
  readonly rule: string;
  readonly item: { readonly id: string; readonly name: string };
  readonly expected: unknown;
  readonly observed: unknown;
}

export interface ArtifactUnknown {
  readonly type: string;
  readonly rule: string;
  readonly item: { readonly id: string; readonly name: string };
  readonly field: string;
  readonly reason: string;
}

export interface ArtifactCheck {
  readonly violations: readonly ArtifactViolation[];
  readonly checked: number;
  readonly unknown: readonly ArtifactUnknown[];
}

function fail(message: string): never {
  throw new ArtifactDeclarationError(message);
}

function objectOf(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${where} must be an object.`);
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      fail(`${where} has unknown key ${key}; allowed: ${allowed.join(", ")}.`);
}

function strings(value: unknown, where: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry === "")
  )
    fail(`${where} must be a non-empty list of non-empty strings.`);
  return value as readonly string[];
}

function escapeRegex(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

const kinds = {
  any: ".+?",
  lower: "(?:(?!\\p{Lu}).)+?",
  upper: "(?:(?!\\p{Ll}).)+?",
  digits: "[0-9]+?",
} as const;

function compilePattern(source: unknown, where: string): RegExp {
  if (typeof source !== "string" || source === "")
    fail(`${where} must be a non-empty pattern string.`);
  const text = source as string;
  const labels = new Map<string, { spec: string; group: string }>();
  let body = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index] ?? "";
    if (character === "}")
      fail(`${where} has an unmatched } in pattern ${text}.`);
    if (character !== "{") {
      body += escapeRegex(character);
      index += 1;
      continue;
    }
    const end = text.indexOf("}", index);
    const spec = end === -1 ? "" : text.slice(index + 1, end);
    const parts = placeholder.exec(spec);
    if (parts === null)
      fail(
        `${where} has a malformed placeholder in pattern ${text}; use {label}, {label:lower}, {label:upper}, {label:digits} or {label:digits:N}.`,
      );
    const [, label = "", kind = "any", width] = parts as RegExpExecArray;
    if (width !== undefined && kind !== "digits")
      fail(`${where} gives a width to a placeholder that is not digits.`);
    const modifier = spec.slice(label.length);
    const earlier = labels.get(label);
    if (earlier === undefined) {
      const group = `p${labels.size}`;
      labels.set(label, { spec: modifier, group });
      body += `(?<${group}>${
        width === undefined
          ? kinds[kind as keyof typeof kinds]
          : `[0-9]{${width}}`
      })`;
    } else if (earlier.spec !== modifier)
      fail(`${where} uses label ${label} with two different kinds.`);
    else body += `\\k<${earlier.group}>`;
    index = end + 1;
  }
  return new RegExp(`^${body}$`, "su");
}

function compileGlob(value: string, caseless: boolean): RegExp {
  return new RegExp(
    `^${value.split("*").map(escapeRegex).join(".*")}$`,
    caseless ? "siu" : "su",
  );
}

function providedFields(from: ArtifactTypeName): readonly string[] {
  const spec = findArtifactType(from);
  return [
    "name",
    ...(spec?.fields ?? []),
    ...(spec?.componentType === undefined ? [] : ["solution", "publisher"]),
  ];
}

function parseWhere(
  name: string,
  from: ArtifactTypeName,
  input: unknown,
): { where: Record<string, WhereValue>; conditions: Condition[] } {
  const raw = objectOf(input, `Type ${name} where`);
  const allowed = [...providedFields(from), "id"];
  const where: Record<string, WhereValue> = {};
  const conditions: Condition[] = [];
  for (const [field, value] of Object.entries(raw)) {
    const at = `Type ${name} where.${field}`;
    if (!whereFields.includes(field as WhereField) || !allowed.includes(field))
      fail(
        `${at}: ${from} does not provide ${field}; allowed: ${allowed.join(", ")}.`,
      );
    if (field === "managed") {
      if (typeof value !== "boolean") fail(`${at} must be a boolean.`);
      where[field] = value as boolean;
      conditions.push({ field, tests: value as boolean });
      continue;
    }
    const list = typeof value === "string" ? [value] : strings(value, at);
    if (typeof value === "string" && value === "")
      fail(`${at} must be a non-empty string.`);
    where[field] = typeof value === "string" ? value : list;
    conditions.push({
      field: field as WhereField,
      tests: list.map((entry) => compileGlob(entry, field === "id")),
    });
  }
  return { where, conditions };
}

function parseRule(
  name: string,
  from: ArtifactTypeName,
  input: unknown,
  patterns: Map<string, RegExp>,
): ArtifactRule {
  const raw = objectOf(input, `Rule ${name}`);
  const allowed = providedFields(from).filter((field) =>
    (ruleKeys as readonly string[]).includes(field),
  );
  onlyKeys(raw, ruleKeys, `Rule ${name}`);
  const rule: { -readonly [key in RuleKey]?: ArtifactRule[key] } = {};
  for (const key of ruleKeys) {
    const value = raw[key];
    if (value === undefined) continue;
    const at = `Rule ${name}.${key}`;
    if (!allowed.includes(key)) fail(`${at}: ${from} does not provide ${key}.`);
    if (key === "name" || key === "displayName") {
      patterns.set(`${name}.${key}`, compilePattern(value, at));
      rule[key] = value as string;
    } else if (key === "solution") {
      rule.solution =
        value === "required" || value === "forbidden"
          ? value
          : strings(value, `${at} (or "required" or "forbidden")`);
    } else if (key === "managed") {
      if (typeof value !== "boolean") fail(`${at} must be a boolean.`);
      rule.managed = value as boolean;
    } else rule[key] = strings(value, at);
  }
  return rule;
}

export function parseArtifactDeclarations(
  input: unknown,
): ArtifactDeclarations {
  const root = objectOf(input, "The artifacts file");
  onlyKeys(root, topKeys, "The artifacts file");
  if (root.artifactsVersion !== artifactsVersion)
    fail(`artifactsVersion must be ${artifactsVersion}.`);
  const declared = objectOf(root.types ?? {}, "types");
  const types: UserArtifactType[] = [];
  for (const [name, entry] of Object.entries(declared)) {
    if (!typeName.test(name))
      fail(
        `Type name ${name} must be lowercase letters, digits and hyphens, starting with a letter.`,
      );
    if (artifactTypeNames.includes(name as ArtifactTypeName))
      fail(`Type name ${name} collides with the built-in type of that name.`);
    const raw = objectOf(entry, `Type ${name}`);
    onlyKeys(raw, typeKeys, `Type ${name}`);
    const from = raw.from;
    if (!artifactTypeNames.includes(from as ArtifactTypeName))
      fail(
        `Type ${name}: from must be one of ${artifactTypeNames.join(", ")}.`,
      );
    const parsed = parseWhere(name, from as ArtifactTypeName, raw.where ?? {});
    types.push({
      type: name,
      from: from as ArtifactTypeName,
      where: parsed.where,
      conditions: parsed.conditions,
    });
  }
  const patterns = new Map<string, RegExp>();
  const rules = new Map<string, ArtifactRule>();
  for (const [name, entry] of Object.entries(
    objectOf(root.rules ?? {}, "rules"),
  )) {
    const type = types.find((candidate) => candidate.type === name);
    if (type === undefined)
      fail(`Rule ${name} has no declared type; rules are keyed by user type.`);
    rules.set(name, parseRule(name, type.from, entry, patterns));
  }
  return { types, rules, patterns };
}

export function findUserType(
  declarations: ArtifactDeclarations,
  name: string,
): UserArtifactType | undefined {
  return declarations.types.find((type) => type.type === name);
}

export function needsMembership(
  declarations: ArtifactDeclarations,
  type: UserArtifactType,
): boolean {
  const rule = declarations.rules.get(type.type);
  return (
    type.conditions.some(
      ({ field }) => field === "solution" || field === "publisher",
    ) ||
    (rule !== undefined &&
      (rule.solution !== undefined || rule.publisher !== undefined))
  );
}

function unmanaged(item: MemberItem): readonly MemberSolution[] | undefined {
  return item.solutions?.filter((solution) => !solution.managed);
}

export function isSystemSolution(uniqueName: string): boolean {
  return systemSolutions.includes(uniqueName);
}

function fieldValue(
  item: MemberItem,
  field: WhereField,
): readonly string[] | boolean | undefined {
  switch (field) {
    case "solution":
      return unmanaged(item)?.map((solution) => solution.uniqueName);
    case "publisher":
      return unmanaged(item)?.flatMap((solution) =>
        solution.publisher === null ? [] : [solution.publisher],
      );
    case "managed":
      return item.managed;
    default: {
      const value = item[field];
      return value === undefined ? undefined : [value];
    }
  }
}

function reference(item: MemberItem) {
  return { id: item.id, name: item.name };
}

export function selectArtifacts(
  type: UserArtifactType,
  items: readonly MemberItem[],
): {
  readonly selected: readonly MemberItem[];
  readonly unknown: readonly ArtifactUnknown[];
} {
  const selected: MemberItem[] = [];
  const unknown: ArtifactUnknown[] = [];
  for (const item of items) {
    let verdict: boolean | ArtifactUnknown = true;
    for (const { field, tests } of type.conditions) {
      const value = fieldValue(item, field);
      if (value === undefined) {
        verdict = {
          type: type.type,
          rule: "where",
          item: reference(item),
          field,
          reason: `The item has no ${field}, so the where filter cannot decide whether it belongs to the type.`,
        };
        break;
      }
      const matched =
        typeof tests === "boolean"
          ? value === tests
          : (value as readonly string[]).some((entry) =>
              tests.some((test) => test.test(entry)),
            );
      if (!matched) {
        verdict = false;
        break;
      }
    }
    if (verdict === true) selected.push(item);
    else if (verdict !== false) unknown.push(verdict);
  }
  return { selected, unknown };
}

type Outcome =
  | { readonly kind: "ok" }
  | { readonly kind: "violation"; expected: unknown; observed: unknown }
  | { readonly kind: "unknown"; field: string; reason: string };

const ok: Outcome = { kind: "ok" };

function missing(field: string): Outcome {
  return { kind: "unknown", field, reason: `The item has no ${field}.` };
}

function evaluate(
  key: RuleKey,
  rule: ArtifactRule,
  item: MemberItem,
  pattern: RegExp | undefined,
): Outcome {
  const expected = rule[key];
  if (key === "name" || key === "displayName") {
    const observed = item[key];
    if (observed === undefined) return missing(key);
    return (pattern as RegExp).test(observed)
      ? ok
      : { kind: "violation", expected, observed };
  }
  if (key === "managed" || key === "owner") {
    const observed = item[key];
    if (observed === undefined) return missing(key);
    const accepted =
      key === "managed"
        ? observed === expected
        : (expected as readonly string[]).some(
            (id) => id.toLowerCase() === (observed as string).toLowerCase(),
          );
    return accepted ? ok : { kind: "violation", expected, observed };
  }
  const counted = unmanaged(item);
  if (counted === undefined || item.solutions === undefined)
    return {
      kind: "unknown",
      field: key,
      reason: "Solution membership was not read.",
    };
  const names = counted.map((solution) => solution.uniqueName);
  if (key === "publisher") {
    if (counted.some((solution) => solution.publisher === null))
      return {
        kind: "unknown",
        field: key,
        reason: "A solution of the item has no readable publisher.",
      };
    const prefixes = counted.map((solution) => solution.publisher as string);
    return prefixes.length > 0 &&
      prefixes.every((prefix) =>
        (expected as readonly string[]).includes(prefix),
      )
      ? ok
      : { kind: "violation", expected, observed: prefixes };
  }
  if (expected === "required")
    return names.length > 0
      ? ok
      : { kind: "violation", expected, observed: names };
  if (expected === "forbidden")
    return names.length === 0
      ? ok
      : { kind: "violation", expected, observed: names };
  const all = item.solutions.map((solution) => solution.uniqueName);
  return all.some((name) => (expected as readonly string[]).includes(name))
    ? ok
    : { kind: "violation", expected, observed: all };
}

export function checkArtifacts(
  declarations: ArtifactDeclarations,
  inventory: ReadonlyMap<string, readonly MemberItem[]>,
): ArtifactCheck {
  const violations: ArtifactViolation[] = [];
  const unknown: ArtifactUnknown[] = [];
  let checked = 0;
  for (const [name, items] of inventory) {
    const type = findUserType(declarations, name);
    const rule = declarations.rules.get(name);
    if (type === undefined || rule === undefined) continue;
    const { selected, unknown: undecided } = selectArtifacts(type, items);
    unknown.push(...undecided);
    for (const item of selected) {
      checked += 1;
      for (const key of ruleKeys) {
        if (rule[key] === undefined) continue;
        const outcome = evaluate(
          key,
          rule,
          item,
          declarations.patterns.get(`${name}.${key}`),
        );
        if (outcome.kind === "violation")
          violations.push({
            type: name,
            rule: key,
            item: reference(item),
            expected: outcome.expected,
            observed: outcome.observed,
          });
        else if (outcome.kind === "unknown")
          unknown.push({
            type: name,
            rule: key,
            item: reference(item),
            field: outcome.field,
            reason: outcome.reason,
          });
      }
    }
  }
  return { violations, checked, unknown };
}
