import assert from "node:assert/strict";
import test from "node:test";
import { renderCsv } from "../dist/csv.js";

test("CSV quotes nested records and prevents spreadsheet formulas", () => {
  const output = renderCsv({
    command: "users list",
    status: "ok",
    data: {
      users: [
        {
          name: '=HYPERLINK("bad")',
          roles: ["one", "two"],
          email: "line\r\nbreak",
        },
      ],
    },
  });
  assert.ok(output.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(output.includes('"[""one"",""two""]"'));
  assert.ok(output.includes('"line\r\nbreak"'));
});
