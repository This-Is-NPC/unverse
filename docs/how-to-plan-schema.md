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
   unverse schema plan --env dev --prefix uv --solution UnverseFixture --model-file schema.json --format json > plan.json
   ```

   The installed fixture produced two `create-entity` operations and no blocks.
   The plan binds the model and mapping to the actual organization, normalized
   URL, environment name, and normalized metadata fingerprint.

2. Read `data.operations`, `data.blocked`, and `data.limitations` in `plan.json`.
   Unsupported types are rejected rather than removed. Changed types, changed
   constraints, removed fields, removed tables, and unknown definitions cannot
   reach the write transport.

3. To require uniqueness, declare alternate keys on an entity. `code` and
   `by_code` are placeholders:

   ```json
   "columns": [
     { "name": "code", "type": "text", "nullable": false, "maxLength": 20 }
   ],
   "keys": [{ "name": "by_code", "columns": ["code"] }]
   ```

   Key columns must be required and of a type Dataverse can key (text,
   integer, decimal, date, instant, choice, or a lookup). Against the
   synthetic fixture that already had the entity without `code`, the plan
   listed the column first and the key after it:

   ```json
   "operations": [
     { "kind": "add-column", "entity": "parent", "column": "code" },
     { "kind": "create-key", "entity": "parent", "key": "by_code" }
   ]
   ```

   A key that exists with other columns, or that the model no longer lists, is
   in `blocked`. Keys are never changed or deleted. A key that exists but whose
   index is not yet `Active` is in `unverified`.

4. To extend a local choice, add the new option to its `options` list. Against
   the synthetic fixture whose `status` choice had `Open` (1) and `Closed` (2),
   adding `Archived` (3) produced one additive operation and no blocks:

   ```json
   "operations": [
     { "kind": "add-option", "entity": "parent", "column": "status", "value": 3, "label": "Archived" }
   ]
   ```

   Relabelling `Closed` to `Done` instead left `operations` empty and put the
   column in `blocked`: every existing option must keep its value and label,
   so label changes, value changes, and removals are blocked.

## What can go wrong

Planning is informational: exit 0 does not mean every listed change can be
applied. Any non-empty `blocked` list prevents apply. Keep the full plan, not
only the operations array. Do not edit the generated plan to bypass a block.

## Next

[Apply the reviewed plan](how-to-apply-schema.md) only after explicit approval.
