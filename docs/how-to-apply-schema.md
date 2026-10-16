# Apply a reviewed additive plan

**The question:** How do I apply only the reviewed operations to the correct
environment?

This page requires [a saved plan](how-to-plan-schema.md). It is not safe to
apply a plan without reviewing its organization, mapping, and operations.

## Before you start

Use a dedicated development environment. The mapped unmanaged solution must
already exist, and its publisher prefix must match the plan. The application
user needs approved metadata-creation permissions. Keep fixture and real
namespaces separate. The application never creates a publisher or solution
implicitly; only the explicit opt-in test harness creates disposable fixtures.

## Steps

1. Apply with explicit confirmation:

   ```sh
   unverse schema apply --env dev --plan-file plan.json --confirm --json
   ```

   Omitting `--confirm` fails before token acquisition. A foreign environment,
   stale fingerprint, modified plan, or blocked operation fails before writes.
   The library also checks the authenticated client's endpoint and WhoAmI
   organization; it does not trust only the caller-provided context labels.

2. Inspect the returned plan. In the dedicated DEV fixture, creation and an
   additive field addition each produced empty `operations` and `blocked`
   lists after inspection. Reapplying the satisfied plan created no duplicate
   structure. Unknown post-apply state reports incomplete coverage, not success.

## What can go wrong

Metadata apply is a sequence of requests, not an atomic transaction. Writes
are not retried automatically. A lost response may have committed remotely:
inspect and create a fresh plan instead of repeating an old one. Node writes
have a 180-second deadline, longer than the 30-second read deadline.

The test harness recovered an early timed-out fixture creation, removed only
its owned resources, then completed the run with the longer deadline. Cleanup
failures are reported and are never silently treated as success. Production
schema apply does not auto-delete or roll back structures.

## Next

Run [schema inspection](how-to-inspect-schema.md) again and validate the
application behaviour outside metadata management.
