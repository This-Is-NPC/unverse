# Plan an additive schema change

**The question:** Which changes are needed, and which changes are unsafe or
unsupported?

This page builds on [schema inspection](how-to-inspect-schema.md).

## Before you start

Prepare a versioned logical model, independently of physical publisher names.
The [synthetic model](../packages/core/test/fixtures/schema.json) shows the
supported types and a 1:N relationship. See
[the model contract](design.md#14-schema-model-and-safety) for constraints.

## Steps

1. Save a reviewable plan. File paths, prefix, and solution below are placeholders:

   ```sh
   unverse schema plan --env dev --prefix uv --solution UnverseFixture --model-file schema.json --json > plan.json
   ```

   The installed fixture produced two `create-entity` operations and no blocks.
   The plan binds the model and mapping to the actual organization, normalized
   URL, environment name, and normalized metadata fingerprint.

2. Read `data.operations`, `data.blocked`, and `data.limitations` in `plan.json`.
   Unsupported types are rejected rather than removed. Changed types, changed
   constraints, removed fields, removed tables, and unknown definitions cannot
   reach the write transport.

## What can go wrong

Planning is informational: exit 0 does not mean every listed change can be
applied. Any non-empty `blocked` list prevents apply. Keep the full plan, not
only the operations array. Do not edit the generated plan to bypass a block.

## Next

[Apply the reviewed plan](how-to-apply-schema.md) only after explicit approval.
