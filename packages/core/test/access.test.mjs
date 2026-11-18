import assert from "node:assert/strict";
import test from "node:test";
import { parseAccessDocument } from "@unverse/core";

const valid = {
  accessVersion: 1,
  teams: [{ team: { name: "Team" }, roles: ["sr-A"] }],
};

test("access document accepts each selector form", () => {
  for (const team of [
    { id: "00000000-0000-0000-0000-000000000001" },
    { name: "Team" },
    { environmentVariable: "uv_Team" },
  ])
    assert.deepEqual(
      parseAccessDocument({ ...valid, teams: [{ team, roles: ["sr-A"] }] })
        .teams[0].team,
      team,
    );
});

test("access document rejects malformed input", () => {
  for (const input of [
    { ...valid, accessVersion: 2 },
    { ...valid, teams: [] },
    { ...valid, extra: 1 },
    { ...valid, teams: [{ team: {}, roles: ["sr-A"] }] },
    { ...valid, teams: [{ team: { id: "x", name: "y" }, roles: ["sr-A"] }] },
    { ...valid, teams: [{ team: { name: "T" }, roles: [] }] },
    { ...valid, teams: [{ team: { name: "T" }, roles: ["a", "a"] }] },
  ])
    assert.throws(() => parseAccessDocument(input), { code: "invalid-input" });
});
