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
   unverse transfer plan --env test --prefix uv --solution CommunityExample --manifest-file manifest.json --policy-file policy.json --json > transfer-plan.json
   ```

   Profile, prefix, solution, and file paths are placeholders. The plan stores
   transformed rows, the source identity, a policy fingerprint, the target
   identity, and observed target state. It does not re-read the source.
   Synthetic two-environment tests verified constant replacement, identity
   preservation, conflicts, and source/target separation.

2. Review all proposed rows and apply with confirmation:

   ```sh
   unverse transfer apply --env test --plan-file transfer-plan.json --confirm --json
   ```

   The same guarded data executor as seed creates rows before links and checks
   modeled invariants afterward. Existing identical rows are no-ops; existing
   different rows are blocks. Unrelated target records are not deleted or
   updated. The returned report records counts, identity maps, differences,
   and a changeset-level checkpoint.

## What can go wrong

Use [the seed failure and resume rules](how-to-seed-data.md#what-can-go-wrong):
the same 1000-operation/4 MB bound, no automatic writes retry, no overwrite,
and no per-row checkpointing apply. Changesets create first and link second,
including cycles. Target reads before and after the batch are not a single
transaction snapshot; concurrent modifications can invalidate verification.

Distinct real-environment transfer has not been observed: only the authorized
DEV environment is available here. Two-environment transfer is tested with
synthetic clients; the shared batch mechanism is probed in owned DEV fixtures.
This is not synchronization, a backup, or a complete application migration.

## Next

Check the report's invariants and validate application behaviour separately.
[Design §16](design.md#16-community-development-workflow) records these boundaries.
