# Apply a reviewed plan

**The question:** How do I apply only the reviewed operations to the correct
environment, and check afterwards that the plan is satisfied?

This page requires [a saved plan](how-to-plan-schema.md). It is not safe to
apply a plan without reviewing its organization, mapping, and operations.
It is enough on its own for schema plans. `unverse apply` runs every plan the
same way, including the [seed](how-to-seed-data.md) and
[transfer](how-to-transfer-dataverse.md) plans; those pages add only what is
specific to data.

## Before you start

Use a dedicated development environment. The mapped unmanaged solution must
already exist, and its publisher prefix must match the plan. The application
user needs approved metadata-creation permissions. Keep fixture and real
namespaces separate. The application never creates a publisher or solution
implicitly; only the explicit opt-in test harness creates disposable fixtures.

## Steps

1. Read the plan header. Every plan carries its own `kind` and `effect`:

   ```json
   { "planVersion": 1, "kind": "schema", "effect": "write", "provider": "dataverse" }
   ```

   `kind` is `schema` or `data`; `apply` uses it to pick the executor, so you
   never name one. `effect` is `write` for every plan today. A plan with effect
   `destructive` is applied only with `--destructive` added to the command in
   step 2; without it the command exits 2 before any request.

2. Apply with explicit confirmation. `plan.json` is the plan file or the JSON
   result of `schema plan`; `dev` is the profile you select again here:

   ```sh
   unverse apply plan.json --env dev --confirm --format json
   ```

   Omitting `--confirm` fails before token acquisition. A foreign environment,
   stale fingerprint, modified plan, or blocked operation fails before writes.
   The library also checks the authenticated client's endpoint and WhoAmI
   organization; it does not trust only the caller-provided context labels.

3. Inspect the returned plan. In the dedicated DEV fixture, creation and an
   additive field addition each produced empty `operations` and `blocked`
   lists after inspection. Reapplying the satisfied plan created no duplicate
   structure. Unknown post-apply state reports incomplete coverage, not success.

   Reviewed environment variable definitions and connection references are
   created in the mapped solution, in the same run. Apply creates no variable
   values and no connections; bind those in the environment afterwards.

4. After an alternate key is created Dataverse builds its index in the
   background. Apply waits up to 300 seconds. If the index is still not
   `Active`, the command exits 7 with status `inconclusive`, and `unverified`
   in the returned plan names the key:

   ```json
   "unverified": [
     { "path": "parent.keys.by_code", "reason": "The key index status is Pending, not Active." }
   ]
   ```

   The key exists. Run `schema plan` again later: the key is satisfied once its
   index is `Active`. A `Failed` index also stays in `unverified`; fix the
   data that violates uniqueness in Dataverse, then reactivate the key there.

5. Check the plan without writing. `verify` re-inspects the target and says
   whether anything in the plan is still missing:

   ```sh
   unverse verify plan.json --env dev --format json
   ```

   Before apply, in the synthetic fixture, it exited 1 with status `failed`:

   ```json
   "data": { "kind": "schema", "satisfied": false, "operations": [{ "kind": "create-entity", "entity": "parent" }], "blocked": [], "unverified": [] }
   ```

   After apply it exited 0 with `"satisfied": true` and empty lists. `verify`
   sends only reads, so it is safe in CI.

## What can go wrong

After each creation, apply waits up to 120 seconds for the created metadata
to be listed before it creates anything that depends on it. If it never
appears, apply stops with exit 5 and a message naming the entity. The earlier
writes stay in place: inspect, then create a fresh plan.

Metadata apply is a sequence of requests, not an atomic transaction. Writes
are not retried automatically. A lost response may have committed remotely:
inspect and create a fresh plan instead of repeating an old one. Node writes
have a 180-second deadline, longer than the 30-second read deadline.

The test harness recovered an early timed-out fixture creation, removed only
its owned resources, then completed the run with the longer deadline. Cleanup
failures are reported and are never silently treated as success. Production
`apply` does not auto-delete or roll back structures.

## Next

Run [schema inspection](how-to-inspect-schema.md) again and validate the
application behaviour outside metadata management.
