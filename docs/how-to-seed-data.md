# Seed deterministic development data

**The question:** How do I create reproducible fixture records without copying
internal application pipelines or overwriting another person's rows?

This page requires [a satisfied schema](how-to-apply-schema.md) and a dedicated
development environment. It does not provision a schema implicitly.

## Before you start

Start from [the declarative example](examples/seed.json). Its prefix, solution,
names, and seed namespace are placeholders to replace with your owned model.
The `model` follows [schema rules](design.md#14-schema-model-and-safety).
The model's JSON can also be saved separately for schema planning.

Every row has a stable `key` and explicit `values` for every non-key column,
including nulls. Do not supply the primary UUID. For a modeled relationship,
use `{ "key": "target-row-key" }` or null. All entities have a rows array,
which may be empty. External references are not portable seed relationships.

## Steps

1. Save a preview. Paths below are placeholders:

   ```sh
   unverse seed plan --env dev --seed-file seed.json --json > seed-plan.json
   ```

   The installed related fixture produced two proposed row creations. IDs
   are SHA-256-derived UUIDs from the namespace, entity, and row key. Repeating
   those inputs produces the same IDs; changing the namespace changes them.
   This is deterministic synthetic identity, not an imported real identity.

2. Review the complete plan, target organization, rows, `create`, `blocked`,
   and `limitations`. Apply only the reviewed JSON:

   ```sh
   unverse seed apply --env dev --plan-file seed-plan.json --confirm --json
   ```

   The synthetic integration verified counts, IDs, relationships, and declared
   values. A repeated satisfied plan returned checkpoint state `verified-resume`
   without sending another batch. Different existing rows block instead of
   being repaired, reseeded, or overwritten.

## What can go wrong

Apply rechecks the target identity and data fingerprint. New rows are created
first, then their relationships, in one atomic changeset. Creation uses
`If-None-Match: *`, so a concurrent record cannot be silently updated. A failed
changeset is not a successful seed. No destructive purge command is added.

Each changeset is limited to 1000 operations and 4 MB; each non-null relationship
uses another operation. There is no automatic splitting or per-row resume.
A lost response has an unknown outcome: inspect and re-plan. Fully matching
records become a verified no-op; conflicting or partially different records
remain blocked. Keep plan files private because they contain values and IDs.

## Next

[Transfer reviewed modeled data between environments](how-to-transfer-dataverse.md).
