import assert from "node:assert/strict";
import test from "node:test";
import { resolveRole, userRoles } from "../dist/index.js";
import { fixture, otherRoleId, role, roleId } from "./fixtures/roles.mjs";

const selector = { field: "email", value: "synthetic@example.invalid" };

test("includes team-assigned roles", async () => {
  const { client } = fixture({ direct: [] });
  assert.deepEqual(
    (await userRoles(client, selector)).roles.map((assigned) => assigned.id),
    [roleId],
  );
});

test("retains direct and team evidence after deduplication", async () => {
  const { client } = fixture();
  const result = await userRoles(client, selector);
  assert.equal(result.roles.length, 1);
  assert.deepEqual(
    result.roles[0].sources.map((source) => source.kind),
    ["direct", "team"],
  );
});

test("does not report absence after a denied team investigation", async () => {
  await assert.rejects(
    userRoles(fixture({ denied: true, direct: [] }).client, selector),
    (error) => error.code === "permission",
  );
});

test("requires disambiguation of duplicate role names", async () => {
  await assert.rejects(
    resolveRole(
      fixture({ roleMatches: [role, { ...role, roleid: otherRoleId }] }).client,
      { name: "Reader" },
    ),
    (error) => error.code === "invalid-input",
  );
});

test("reports disabled users and rejects ambiguous users", async () => {
  assert.equal(
    (await userRoles(fixture({ disabled: true }).client, selector)).user
      .disabled,
    true,
  );
  await assert.rejects(
    userRoles(fixture({ users: [{}, {}] }).client, selector),
    (error) => error.code === "invalid-input",
  );
});

test("escapes user filters before encoding query parameters", async () => {
  const { client, calls } = fixture();
  await userRoles(client, {
    field: "domain",
    value: "o'brien@example.invalid",
  });
  const filter = new URL(calls[0]).searchParams.get("$filter");
  assert.equal(filter, "domainname eq 'o''brien@example.invalid'");
});
