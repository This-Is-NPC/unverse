import assert from "node:assert/strict";
import test from "node:test";
import { applyPlan, planAccess, verifyPlan } from "../dist/index.js";
import {
  accessFixture,
  childRole,
  childTeam,
  document,
  duplicateRoles,
  environment,
  rootOnlyRole,
  rootRole,
  rootTeam,
  twinTeam,
  variableDefaultTeam,
  variableSecret,
  variableTeam,
  variableUnset,
} from "./fixtures/access.mjs";

const users = "sr-Example-Users";

async function plan(fixture, ...teams) {
  return planAccess(fixture.client, document(...teams), environment);
}

test("resolves a team by id, by name, and by environment variable", async () => {
  const fixture = accessFixture();
  for (const team of [
    { id: childTeam },
    { name: "Child Team" },
    { environmentVariable: variableTeam },
  ]) {
    const result = await plan(fixture, { team, roles: [users] });
    assert.equal(result.operations[0].teamId, childTeam);
  }
  const fallback = await plan(fixture, {
    team: { environmentVariable: variableDefaultTeam },
    roles: [users],
  });
  assert.equal(fallback.operations[0].teamId, rootTeam);
});

test("rejects unset, secret, and unknown team variables", async () => {
  const fixture = accessFixture();
  for (const environmentVariable of [
    variableUnset,
    variableSecret,
    "uv_Missing",
  ])
    await assert.rejects(
      plan(fixture, { team: { environmentVariable }, roles: [users] }),
      (error) => error.code === "invalid-input",
    );
});

test("rejects an ambiguous or unknown team name", async () => {
  const fixture = accessFixture();
  for (const name of ["Twin", "Nobody"])
    await assert.rejects(
      plan(fixture, { team: { name }, roles: [users] }),
      (error) => error.code === "invalid-input",
    );
});

test("keeps a variable selector by name and records the resolved team id", async () => {
  const result = await plan(accessFixture(), {
    team: { environmentVariable: variableTeam },
    roles: [users],
  });
  assert.deepEqual(result.document.teams[0].team, {
    environmentVariable: variableTeam,
  });
  assert.equal(result.teams[0].id, childTeam);
});

test("resolves a role in the team's business unit, not the root", async () => {
  const fixture = accessFixture();
  const child = await plan(fixture, {
    team: { id: childTeam },
    roles: [users],
  });
  assert.equal(child.operations[0].roleId, childRole);
  const root = await plan(fixture, { team: { id: rootTeam }, roles: [users] });
  assert.equal(root.operations[0].roleId, rootRole);
});

test("separates satisfied roles from missing ones", async () => {
  const fixture = accessFixture({ assigned: { [childTeam]: [childRole] } });
  const result = await plan(fixture, {
    team: { id: childTeam },
    roles: [users],
  });
  assert.deepEqual(result.operations, []);
  assert.equal(result.satisfied[0].roleId, childRole);
  const missing = await plan(accessFixture(), {
    team: { id: childTeam },
    roles: [users],
  });
  assert.deepEqual(missing.satisfied, []);
  assert.equal(missing.operations[0].kind, "assign-team-role");
});

test("blocks a missing or ambiguous role with a reason", async () => {
  const result = await plan(accessFixture(), {
    team: { id: childTeam },
    roles: ["sr-Root-Only", "sr-Duplicate"],
  });
  assert.deepEqual(result.operations, []);
  assert.match(result.blocked[0].reason, /No role/);
  assert.match(result.blocked[1].reason, /Several roles/);
  assert.equal(result.blocked[0].roleName, "sr-Root-Only");
});

test("rejects a document that selects a team twice", async () => {
  await assert.rejects(
    plan(
      accessFixture(),
      { team: { id: childTeam }, roles: [users] },
      { team: { name: "Child Team" }, roles: [users] },
    ),
    (error) => error.code === "invalid-input",
  );
});

test("access apply writes only the planned associations", async () => {
  const fixture = accessFixture({ assigned: { [rootTeam]: [rootRole] } });
  const reviewed = await plan(
    fixture,
    { team: { id: childTeam }, roles: [users] },
    { team: { id: rootTeam }, roles: [users, "sr-Root-Only"] },
  );
  assert.equal(reviewed.operations.length, 2);
  const outcome = await applyPlan(
    fixture.client,
    JSON.parse(JSON.stringify(reviewed)),
    environment,
    true,
  );
  assert.equal(outcome.status, "ok");
  assert.deepEqual(fixture.writes, [
    { teamId: childTeam, roleId: childRole },
    { teamId: rootTeam, roleId: rootOnlyRole },
  ]);
  assert.deepEqual([...fixture.links.get(twinTeam)], []);
});

test("access apply requires confirmation before any write", async () => {
  const fixture = accessFixture();
  const reviewed = await plan(fixture, {
    team: { id: childTeam },
    roles: [users],
  });
  await assert.rejects(
    applyPlan(fixture.client, reviewed, environment, false),
    /confirm/,
  );
  assert.deepEqual(fixture.writes, []);
});

test("access apply rejects a stale plan before any write", async () => {
  const fixture = accessFixture();
  const reviewed = await plan(fixture, {
    team: { id: childTeam },
    roles: [users],
  });
  fixture.links.get(childTeam).add(duplicateRoles[0]);
  await assert.rejects(
    applyPlan(
      fixture.client,
      JSON.parse(JSON.stringify(reviewed)),
      environment,
      true,
    ),
    /stale/,
  );
  assert.deepEqual(fixture.writes, []);
});

test("access apply rejects a modified plan and a blocked plan", async () => {
  const fixture = accessFixture();
  const reviewed = await plan(fixture, {
    team: { id: childTeam },
    roles: [users],
  });
  const tampered = { ...reviewed, operations: [] };
  await assert.rejects(
    applyPlan(fixture.client, tampered, environment, true),
    /modified/,
  );
  const blocked = await plan(fixture, {
    team: { id: childTeam },
    roles: ["sr-Root-Only"],
  });
  await assert.rejects(
    applyPlan(fixture.client, blocked, environment, true),
    /blocked/,
  );
  assert.deepEqual(fixture.writes, []);
});

test("access verify reports satisfied and unsatisfied plans", async () => {
  const fixture = accessFixture();
  const reviewed = await plan(fixture, {
    team: { id: childTeam },
    roles: [users],
  });
  const before = await verifyPlan(fixture.client, reviewed, environment);
  assert.equal(before.status, "failed");
  assert.equal(before.report.operations.length, 1);
  await applyPlan(fixture.client, reviewed, environment, true);
  const after = await verifyPlan(fixture.client, reviewed, environment);
  assert.equal(after.status, "ok");
  assert.equal(after.report.satisfied, true);
});
