import assert from "node:assert/strict";
import test from "node:test";
import { declaredPrivileges, parseMapping, planSchema } from "@unverse/core";
import { applySchema, inspectSchema } from "../dist/index.js";
import {
  environment,
  securityRoleFixture as fixture,
  model,
} from "./fixtures/schema.mjs";

const base = { prefix: "uv", solution: "UnverseFixture" };
const role = {
  name: "sr-Example-Users",
  privileges: { prvReadAccount: "local" },
  tables: { parent: { read: "global", write: "global", appendTo: "global" } },
};
const mapping = parseMapping({ ...base, securityRoles: [role] });
const known = ["prvReadAccount", "prvCreateAccount"];

async function plan(state, selected = mapping) {
  return planSchema(
    model,
    selected,
    environment,
    await inspectSchema(state.client, selected, model),
  );
}

async function withTable(options) {
  const state = fixture({ known, ...options });
  await applySchema(
    state.client,
    await plan(state, parseMapping(base)),
    environment,
    true,
  );
  state.writes.length = 0;
  return state;
}

const roleOperations = (result) =>
  result.operations.filter((operation) =>
    ["create-security-role", "add-role-privileges"].includes(operation.kind),
  );

test("security role mappings validate names, depths, accesses and tables", () => {
  const invalid = (roles, pattern) =>
    assert.throws(
      () => parseMapping({ ...base, securityRoles: roles }),
      pattern,
    );
  invalid([role, { ...role, name: "SR-EXAMPLE-USERS" }], /unique/);
  invalid([{ ...role, name: " " }], /name/);
  invalid([{ ...role, preset: "other" }], /preset/);
  invalid([{ ...role, extra: 1 }], /Unknown/);
  invalid([{ name: "r", privileges: { prvReadAccount: "org" } }], /depth/);
  invalid([{ name: "r", privileges: { ReadAccount: "basic" } }], /prv/);
  invalid([{ name: "r", tables: { parent: { view: "basic" } } }], /access/);
  invalid([{ name: "r", tables: { parent: { read: "all" } } }], /depth/);
  invalid([{ name: "r", tables: { Parent: { read: "global" } } }], /modeled/);
  invalid(
    [{ name: "r", tables: { parent: { read: "local" } } }],
    /organization-owned/,
  );
  invalid({}, /array/);
  assert.deepEqual(
    parseMapping({ ...base, securityRoles: [role] }).securityRoles,
    [role],
  );
});

test("presets expand to base privileges and explicit entries raise depth but never lower it", () => {
  const expanded = (declared) =>
    new Map(
      declaredPrivileges(
        mapping,
        model,
        parseMapping({ ...base, securityRoles: [declared] }).securityRoles[0],
      ).privileges.map((privilege) => [privilege.name, privilege.depth]),
    );
  const preset = expanded({ name: "r", preset: "code-app-base" });
  assert.equal(preset.size, 82);
  assert.equal(preset.get("prvReadUserQuery"), "basic");
  assert.equal(preset.get("prvReadOrganization"), "global");
  const merged = expanded({
    name: "r",
    preset: "code-app-base",
    privileges: {
      prvReadUserQuery: "deep",
      prvReadOrganization: "basic",
      prvReadAccount: "local",
    },
    tables: { parent: { read: "global" } },
  });
  assert.equal(merged.size, 84);
  assert.equal(merged.get("prvReadUserQuery"), "deep");
  assert.equal(merged.get("prvReadOrganization"), "global");
  assert.equal(merged.get("prvReadAccount"), "local");
  assert.equal(merged.get("prvReaduv_parent"), "global");
});

test("an absent role is created and its missing privileges are added", async () => {
  const state = await withTable();
  assert.deepEqual(roleOperations(await plan(state)), [
    { kind: "create-security-role", role: "sr-Example-Users" },
    {
      kind: "add-role-privileges",
      role: "sr-Example-Users",
      privileges: [
        { name: "prvAppendTouv_parent", depth: "global" },
        { name: "prvReadAccount", depth: "local" },
        { name: "prvReaduv_parent", depth: "global" },
        { name: "prvWriteuv_parent", depth: "global" },
      ],
    },
  ]);
});

test("existing privileges at equal or higher depth are satisfied and lower ones are raised", async () => {
  const state = await withTable();
  const id = state.addRole("sr-Example-Users");
  state.grant(id, "prvReadAccount", "global");
  state.grant(id, "prvReaduv_parent", "global");
  state.grant(id, "prvWriteuv_parent", "global");
  state.grant(id, "prvAppendTouv_parent", "basic");
  state.grant(id, "prvCreateAccount", "global");
  const result = await plan(state);
  assert.deepEqual(roleOperations(result), [
    {
      kind: "add-role-privileges",
      role: "sr-Example-Users",
      privileges: [{ name: "prvAppendTouv_parent", depth: "global" }],
    },
  ]);
  assert.deepEqual(result.blocked, []);
  state.grant(id, "prvAppendTouv_parent", "global");
  assert.deepEqual(roleOperations(await plan(state)), []);
  assert.ok(!JSON.stringify(await plan(state)).includes("prvCreateAccount"));
});

test("table privileges of an entity the same plan creates are pending and unknown privileges block", async () => {
  const state = fixture({ known });
  const selected = parseMapping({
    ...base,
    securityRoles: [
      {
        ...role,
        privileges: { prvReadAccount: "global", prvReadNothing: "basic" },
        tables: { ...role.tables, ghost: { read: "global" } },
      },
    ],
  });
  const result = await plan(state, selected);
  assert.deepEqual(
    result.blocked.map((entry) => entry.path),
    [
      "securityRoles.sr-Example-Users.tables.ghost",
      "securityRoles.sr-Example-Users.privileges.prvReadNothing",
    ],
  );
  assert.deepEqual(
    roleOperations(result)[1].privileges.filter((entry) => entry.pending),
    [
      { name: "prvAppendTouv_parent", depth: "global", pending: true },
      { name: "prvReaduv_parent", depth: "global", pending: true },
      { name: "prvWriteuv_parent", depth: "global", pending: true },
    ],
  );
  const accepted = await plan(
    state,
    parseMapping({ ...base, securityRoles: [role] }),
  );
  assert.deepEqual(accepted.blocked, []);
  const applied = await applySchema(state.client, accepted, environment, true);
  assert.deepEqual(applied.operations, []);
});

test("pending privileges are resolved after the created table becomes visible", async () => {
  const state = fixture({ known, privilegeLag: 3 });
  const result = await plan(state);
  await applySchema(state.client, result, environment, true);
  const grant = state.writes.find((write) =>
    write.path.endsWith("AddPrivilegesRole"),
  );
  assert.deepEqual(
    grant.body.Privileges.map((privilege) => privilege.PrivilegeName),
    [
      "prvAppendTouv_parent",
      "prvReadAccount",
      "prvReaduv_parent",
      "prvWriteuv_parent",
    ],
  );
});

test("roles are matched by name in the root business unit only", async () => {
  const state = await withTable();
  state.addRole("sr-Example-Users", state.childUnit);
  const result = await plan(state);
  assert.equal(roleOperations(result)[0].kind, "create-security-role");
  assert.ok(
    state.reads.some((url) => url.includes("parentbusinessunitid_value")),
  );
});

test("role creation uses the solution header and AddPrivilegesRole removes nothing", async () => {
  const state = await withTable();
  await applySchema(state.client, await plan(state), environment, true);
  const created = state.writes.find((write) => write.path === "roles");
  assert.equal(created.headers["MSCRM.SolutionUniqueName"], "UnverseFixture");
  assert.deepEqual(created.body, {
    name: "sr-Example-Users",
    "businessunitid@odata.bind": `/businessunits(${state.rootUnit})`,
  });
  const grants = state.writes.filter((write) =>
    write.path.includes("Privileges"),
  );
  assert.equal(grants.length, 1);
  assert.match(
    grants[0].path,
    /^roles\([\da-f-]+\)\/Microsoft\.Dynamics\.CRM\.AddPrivilegesRole$/,
  );
  assert.equal(grants[0].headers["MSCRM.SolutionUniqueName"], "UnverseFixture");
  assert.deepEqual(grants[0].body.Privileges[1], {
    PrivilegeId: [...state.privileges].find(
      ([, name]) => name === "prvReadAccount",
    )[0],
    PrivilegeName: "prvReadAccount",
    Depth: "Local",
    BusinessUnitId: state.rootUnit,
  });
  assert.ok(
    state.writes.every(
      (write) => !/Remove|Replace|DELETE/.test(write.path + write.method),
    ),
  );
  assert.deepEqual(roleOperations(await plan(state)), []);
});

test("extra privileges on an existing role stay untouched and unreported", async () => {
  const state = await withTable();
  const id = state.addRole("sr-Example-Users");
  state.grant(id, "prvCreateAccount", "global");
  await applySchema(state.client, await plan(state), environment, true);
  const result = await plan(state);
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.blocked, []);
  assert.equal(
    state.grants
      .get(id)
      .get(
        [...state.privileges].find(
          ([, name]) => name === "prvCreateAccount",
        )[0],
      ),
    8,
  );
});
