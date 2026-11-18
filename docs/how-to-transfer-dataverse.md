# Transfer a modeled dataset between Dataverse environments

**The question:** How do I copy an explicitly reviewed subset without clearing
the destination or implicitly copying sensitive fields?

This page needs [a canonical export](how-to-export-data.md) and an already
compatible target schema. Source and target must be different organizations.

## Before you start

Review the source manifest locally. It contains real values if exported from
a real application. Configure the target profile and prepare a policy with
`policyVersion: 1` and a `fields` object. Every non-primary-key, non-relationship
field needs exactly one rule, keyed as `entity.column`:

```json
{
  "policyVersion": 1,
  "fields": {
    "example.name": { "action": "constant", "value": "Anonymous" },
    "example.notes": { "action": "constant", "value": null },
    "example.status": { "action": "copy" }
  }
}
```

The entity and field names are placeholders. Constants must satisfy the model.
There is no implicit field copy, automatic PII classifier, email generator,
or claim of regulatory anonymization. IDs and relationship IDs are preserved;
they can themselves identify people. Do not transfer a real dataset until its
identifiers and every permitted copied field have been reviewed and authorized.

## Steps

1. Plan against the explicitly selected destination:

   ```sh
   unverse pipeline plan transfer --env test --format json -- --mapping-file mapping.json --manifest-file manifest.json --policy-file policy.json > transfer-plan.json
   ```

   `transfer` is a built-in [pipeline](how-to-write-a-pipeline.md); its three
   flags come after `--`. Profile and file paths are placeholders. `mapping.json` holds
   `{ "prefix": "uv", "solution": "CommunityExample" }`. The plan stores
   transformed rows, the source identity, a policy fingerprint, the target
   identity, and observed target state. It does not re-read the source.
   Synthetic two-environment tests verified constant replacement, identity
   preservation, conflicts, and source/target separation.

2. Review all proposed rows and apply with confirmation:

   ```sh
   unverse apply transfer-plan.json --env test --confirm --format json
   ```

   The same guarded data executor as seed creates rows before links and checks
   modeled invariants afterward. Existing identical rows are no-ops and are
   counted as `unchanged`; existing different rows are blocks. Add
   `--on-existing update` to the plan command to update them instead: the plan
   then lists only the differing fields, as
   [for a seed](how-to-seed-data.md#re-run-or-update-a-seed). A source
   row whose ID is absent in the target but whose alternate key matches a target
   row is treated as that row, and references to it are
   [repointed](how-to-seed-data.md#match-rows-that-already-exist-under-other-ids),
   which is why an identity map can differ from the source IDs. Unrelated target
   records are never deleted or updated. The returned report records counts, identity maps, differences,
   and a changeset-level checkpoint. `unverse verify transfer-plan.json --env
   test` re-checks the plan afterwards without writing and exits 1 while rows
   are missing or conflicting.

## Tenant-scoped user references

A model column declared with `"scope": "tenant"` on `aaduser` (a Microsoft
Entra user) is copied as a UUID, since the ID is the same in the target
environment's tenant. A policy still needs an explicit rule for it (`copy` or
a constant), as for any other non-relationship field. The plan does not read
the user in the target: it states that existence is not verified, and the
lookup is bound with the user's ID. Output of the offline fixture check, not
of a live transfer:

```text
Tenant-scoped references (parent.owner) keep their UUIDs; their existence in the target tenant is not verified, and PostgreSQL stores them as uuid without a foreign key.
System lookups (owner, created by, modified by, business unit) are not modeled columns and are not copied.
```

What Dataverse does with an ID that has no user in the target tenant was not
observed; check the users first. Environment-local external references (`systemuser`, `team`) and
fields that are not modeled (owner, created by, modified by, business unit)
are rejected, not dropped. See
[the export page](how-to-export-data.md#tenant-scoped-user-references).

## What can go wrong

Use [the seed failure and resume rules](how-to-seed-data.md#what-can-go-wrong):
the same 1000-operation/4 MB bound, no automatic writes retry,
and no per-row checkpointing apply; overwrite happens only with
`--on-existing update`, and only for fields that differ. Changesets create first and link second,
including cycles. Target reads before and after the batch are not a single
transaction snapshot; concurrent modifications can invalidate verification.

Distinct real-environment transfer has not been observed: only the authorized
DEV environment is available here. Two-environment transfer is tested with
synthetic clients; the shared batch mechanism is probed in owned DEV fixtures.
This is not synchronization, a backup, or a complete application migration.

## Next

Check the report's invariants and validate application behaviour separately.
[Design §16](design.md#16-community-development-workflow) records these boundaries.
