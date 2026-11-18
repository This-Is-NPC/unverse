# Seed deterministic development data

**The question:** How do I create reproducible fixture records without copying
internal application pipelines, and re-run them without duplicating or
overwriting another person's rows?

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
which may be empty. Environment-local external references are not portable seed relationships; a tenant-scoped `aaduser` reference is a plain UUID value.

## Steps

1. Save a preview. Paths below are placeholders:

   ```sh
   unverse pipeline plan seed --env dev --format json -- --seed seed.json > seed-plan.json
   ```

   `seed` is a built-in [pipeline](how-to-write-a-pipeline.md). Its `--seed`
   flag comes after `--`. A value that is a plain name, such as `demo`, reads
   `.unverse/seeds/demo.json` in your project; anything with a path or a
   `.json` ending is read as given.

   The installed related fixture produced two proposed row creations. IDs
   are SHA-256-derived UUIDs from the namespace, entity, and row key. Repeating
   those inputs produces the same IDs; changing the namespace changes them.
   This is deterministic synthetic identity, not an imported real identity.

2. Review the complete plan, target organization, rows, `create`, `blocked`,
   and `limitations`. Apply only the reviewed JSON:

   ```sh
   unverse apply seed-plan.json --env dev --confirm --format json
   ```

   The plan's `kind` is `data` and its `effect` is `write`; `apply` runs the
   data executor from that. [Apply a reviewed plan](how-to-apply-schema.md)
   covers the flags and exits shared by every plan.

   The synthetic integration verified counts, IDs, relationships, and declared
   values. A repeated satisfied plan returned checkpoint state `verified-resume`
   without sending another batch. Different existing rows block instead of
   being repaired, reseeded, or overwritten, unless you ask for updates in
   [the next section](#re-run-or-update-a-seed).

3. Check the result without writing:

   ```sh
   unverse verify seed-plan.json --env dev --format json
   ```

   It exits 0 with `"satisfied": true` when every planned row exists and none
   conflicts, and exits 1 with the remaining `create` and `blocked` lists
   otherwise.

## Re-run or update a seed

A seed has deterministic IDs, so planning it again finds the rows it created.
By default a row that differs from the seed blocks the plan. Add
`--on-existing update` to let the plan change it:

```sh
unverse pipeline plan seed --env dev --format json -- --seed seed.json --on-existing update > seed-plan.json
```

`--on-existing` is `block` (the default) or `update`. Right after a successful
apply the plan reports every row `unchanged` and has nothing to do (excerpt of
the real output; the fixture has one `parent` and one `child` row):

```json
{
  "onExisting": "update",
  "create": [],
  "update": [],
  "unchanged": { "child": 1, "parent": 1 },
  "blocked": []
}
```

An unchanged row costs no operation. If somebody edited the parent's name in
the target, the same command proposes an `update` that lists only the
differing modeled fields (excerpt):

```json
{
  "onExisting": "update",
  "create": [],
  "update": [
    {
      "entity": "parent",
      "id": "c2d5338b-6fb3-80bf-8c06-7c6f69f865ad",
      "fields": { "name": "Synthetic Parent" }
    }
  ],
  "unchanged": { "child": 1, "parent": 0 },
  "blocked": []
}
```

Without the flag the same target gives the plan a `blocked` entry
(`An existing row differs; set onExisting to update to change it.`) and
`apply` refuses it. `apply` sends the update as a `PATCH` with `If-Match: *`,
so it can only change a row that exists, and it sends only the fields listed.
Columns the model does not describe are never read or written. The plan
records the target values it compared; if the target changes between `plan`
and `apply`, `apply` rejects the plan as stale and writes nothing. Plan again.

## Match rows that already exist under other IDs

If another seed namespace, or a person, already created the rows, their IDs
differ from the ones this seed derives. When the model declares
[alternate keys](design.md#14-schema-model-and-safety), the plan looks for a
target row with the same key values before it proposes a create. Keys are tried
in declaration order and the first hit wins. A match is handled like any
existing row: unchanged, updated with `--on-existing update`, or blocked. Every
reference to the seed's own ID is pointed at the matched row, so children join
the row that exists instead of a duplicate. Excerpt of a real plan for a seed
in namespace `new` against rows created by namespace `old`; the model keys
`parent` by `name` and `child` by `parentid` and `name`:

```json
{
  "create": [],
  "update": [
    {
      "entity": "parent",
      "id": "3b5d5421-9447-864f-bdbf-7313e0bfaed1",
      "fields": { "amount": "1.00" }
    }
  ],
  "unchanged": { "child": 1, "parent": 0 },
  "matched": [
    {
      "entity": "parent",
      "id": "cd18065e-0732-8dda-9ea5-e4ede74784c5",
      "targetId": "3b5d5421-9447-864f-bdbf-7313e0bfaed1",
      "key": "byname"
    },
    {
      "entity": "child",
      "id": "e1bf82fc-e139-8021-9c37-f0be60bed1ca",
      "targetId": "fa1e78f7-e513-84f6-8fbd-970382d25500",
      "key": "byparent"
    }
  ]
}
```

`id` is the ID the seed derives; `targetId` is the row that exists, and the
`update` names that row. A null value in a key column never matches. If a target
row would match two seed rows, the second is `blocked` and the plan cannot
apply.

## What can go wrong

Apply rechecks the target identity and data fingerprint. New rows are created
first, then updates, then their relationships, in one atomic changeset.
Creation uses `If-None-Match: *`, so a concurrent record cannot be silently
updated; an update uses `If-Match: *`, so it cannot create. A failed
changeset is not a successful seed.

Each changeset is limited to 1000 operations and 4 MB; each non-null relationship
and each changed field group uses another operation. There is no automatic splitting or per-row resume.
A lost response has an unknown outcome: inspect and re-plan. Fully matching
records become a verified no-op; conflicting or partially different records
remain blocked. Keep plan files private because they contain values and IDs.

## Next

[Transfer reviewed modeled data between environments](how-to-transfer-dataverse.md).
