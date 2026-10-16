import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { parseModel, planSchema } from "../../packages/core/dist/index.js";
import sourceModel from "../../packages/core/test/fixtures/schema.json" with {
  type: "json",
};
import {
  applySchema,
  inspectSchema,
} from "../../packages/dataverse/dist/index.js";

export const fixtureModel = parseModel(sourceModel);

export async function withSchemaFixture(client, url, action) {
  assert.equal(
    process.env.UNVERSE_ALLOW_FIXTURE_WRITES,
    "1",
    "Set UNVERSE_ALLOW_FIXTURE_WRITES=1 to authorize only disposable DEV fixture writes.",
  );
  const prefix = `uv${randomBytes(3).toString("hex")}`;
  const mapping = { prefix, solution: `${prefix}_fixture` };
  const publisherId = randomUUID();
  const solutionId = randomUUID();
  const identity = await client.whoAmI();
  const environment = {
    name: "dev",
    url,
    organizationId: identity.organizationId,
  };
  const initial = await inspectSchema(client, mapping);
  assert.equal(
    initial.entities.length,
    0,
    "A fixture namespace must be empty before use.",
  );
  for (const [collection, key, id] of [
    ["publishers", "publisherid", publisherId],
    ["solutions", "solutionid", solutionId],
  ]) {
    const existing = await client.collect(
      `${collection}?${new URLSearchParams({ $select: key, $filter: `${key} eq ${id}` })}`,
    );
    assert.equal(
      existing.rows.length,
      0,
      "A fixture resource ID must not already exist.",
    );
  }
  const originalWrite = client.write.bind(client);
  let cleaning = false;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  client.write = (...args) => {
    if (interrupted && !cleaning)
      throw new Error("Fixture interrupted; only cleanup writes are allowed.");
    return originalWrite(...args);
  };
  let publisherCreated = false;
  let solutionCreated = false;
  let schemaAttempted = false;
  const failures = [];
  try {
    publisherCreated = true;
    await client.write("POST", "publishers", {
      publisherid: publisherId,
      uniquename: `${prefix}_publisher`,
      friendlyname: "Unverse disposable fixture",
      customizationprefix: prefix,
    });
    solutionCreated = true;
    await client.write("POST", "solutions", {
      solutionid: solutionId,
      uniquename: mapping.solution,
      friendlyname: "Unverse disposable fixture",
      version: "0.1.0.0",
      "publisherid@odata.bind": `/publishers(${publisherId})`,
    });
    const plan = await planSchema(fixtureModel, mapping, environment, initial);
    assert.deepEqual(plan.blocked, []);
    schemaAttempted = true;
    const remaining = await applySchema(client, plan, environment, true);
    if (remaining.operations.length || remaining.blocked.length) {
      console.error(
        `Fixture verification: ${remaining.operations.length} pending operations, ${remaining.blocked.length} compatibility blocks.`,
      );
      for (const block of remaining.blocked)
        console.error(`Fixture field ${block.path}: ${block.reason}`);
    }
    assert.deepEqual(remaining.operations, []);
    assert.deepEqual(remaining.blocked, []);
    console.log(
      "Observed DEV: inspect, plan, apply, and inspect produced an empty additive plan.",
    );
    await action({ mapping, environment, model: fixtureModel, remaining });
  } catch (error) {
    failures.push(
      `${error.message}${error.httpStatus === undefined ? "" : ` (HTTP ${error.httpStatus})`}`,
    );
  } finally {
    cleaning = true;
    const previousFailures = failures.length;
    if (schemaAttempted) {
      let observed;
      try {
        observed = await inspectSchema(client, mapping);
      } catch {
        failures.push("could not inspect fixture tables for cleanup");
      }
      for (const entity of [...fixtureModel.entities].sort((a) =>
        a.name === "child" ? -1 : 1,
      )) {
        const physical = `${prefix}_${entity.name}`;
        if (
          observed?.entities.some((candidate) => candidate.name === physical)
        ) {
          try {
            await removeOwned(
              client,
              "EntityDefinitions",
              observed.entities.find((candidate) => candidate.name === physical)
                .metadataId,
              "MetadataId",
            );
          } catch (error) {
            failures.push(
              `could not remove owned fixture entity ${entity.name}: ${error.message}`,
            );
          }
        }
      }
    }
    if (solutionCreated)
      try {
        await removeOwned(client, "solutions", solutionId, "solutionid");
      } catch (error) {
        if (error.httpStatus !== 404)
          failures.push(
            `could not remove owned fixture solution: ${error.message}`,
          );
      }
    if (publisherCreated)
      try {
        await removeOwned(client, "publishers", publisherId, "publisherid");
      } catch (error) {
        if (error.httpStatus !== 404)
          failures.push(
            `could not remove owned fixture publisher: ${error.message}`,
          );
      }
    if (failures.length === previousFailures)
      console.log(
        "Cleaned only the tables, solution, and publisher owned by this fixture run.",
      );
    client.write = originalWrite;
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (interrupted) failures.push("fixture interrupted");
  }
  if (failures.length)
    throw new Error(
      `Fixture verification or cleanup failed: ${failures.join("; ")}. Namespace: ${prefix}`,
    );
}

async function removeOwned(client, collection, id, key) {
  assert.match(
    id,
    /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i,
  );
  try {
    await client.write("DELETE", `${collection}(${id})`);
  } catch (error) {
    if (error.httpStatus === 404) return;
    const remaining = await client.collect(
      `${collection}?${new URLSearchParams({ $select: key, $filter: `${key} eq ${id}` })}`,
    );
    if (remaining.rows.length !== 0) throw error;
    console.log(
      "Observed owned-resource deletion completed despite a lost response.",
    );
  }
}
