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

1. Save a reviewable plan. File paths, prefix, and solution below are
   placeholders. `mapping.json` holds the publisher prefix and the solution:

   ```json
   { "prefix": "uv", "solution": "UnverseFixture" }
   ```

   ```sh
   unverse schema plan --env dev --mapping-file mapping.json --model-file schema.json --format json > plan.json
   ```

   The installed fixture produced two `create-entity` operations and no blocks.
   The plan binds the model and mapping to the actual organization, normalized
   URL, environment name, and normalized metadata fingerprint.

2. Read `data.operations`, `data.blocked`, and `data.limitations` in `plan.json`.
   Unsupported types are rejected rather than removed. Changed types, changed
   constraints, removed fields, removed tables, and unknown definitions cannot
   reach the write transport, unless step 6 applies.

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
   in `blocked`. Keys are never changed; step 6 deletes an undeclared key. A key that exists but whose
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

5. If Dataverse has custom columns under your prefix that the model no longer
   lists, they are blocked, never removed (step 6 changes this). For each, the plan reads at most one
   row to tell you whether the column holds data. Against the synthetic fixture,
   with `amount` holding a value, `day` empty, and `count` unreadable by the
   application user:

   ```json
   "blocked": [
     {
       "path": "parent.uv_amount",
       "reason": "Removing an existing custom column is blocked.",
       "holdsData": true,
       "evidence": "Read uv_parents?$select=uv_parentid&$filter=uv_amount ne null&$top=1 returned a row for this identity."
     },
     {
       "path": "parent.uv_count",
       "reason": "Removing an existing custom column is blocked.",
       "holdsData": "unknown",
       "evidence": "Read uv_parents?$select=uv_parentid&$filter=uv_count ne null&$top=1 failed (permission): Access denied."
     },
     {
       "path": "parent.uv_day",
       "reason": "Removing an existing custom column is blocked.",
       "holdsData": false,
       "evidence": "Read uv_parents?$select=uv_parentid&$filter=uv_day ne null&$top=1 returned no rows for this identity."
     }
   ]
   ```

   Treat `"unknown"` as possibly holding data. `false` means this identity saw
   no rows; row-level security can hide rows from it. Multiline text and
   other columns that cannot be filtered are always `"unknown"`.

6. To make the model authoritative for what your prefix owns, add `--prune`.
   The plan is then destructive: its `effect` is `destructive`, and the
   removals that step 5 reports as blocked become operations. Against the
   synthetic fixture where Dataverse still had a `code` column with a
   value, the key `by_code` on it, and a `parent` lookup on `child` that the
   model no longer lists:

   ```sh
   unverse schema plan --env dev --mapping-file mapping.json --model-file schema.json --prune --format json > prune-plan.json
   ```

   ```json
   "effect": "destructive",
   "operations": [
     { "kind": "delete-key", "entity": "parent", "key": "uv_by_code" },
     { "kind": "delete-relationship", "entity": "child", "relationship": "uv_child_parent", "column": "uv_parent" },
     {
       "kind": "delete-column",
       "entity": "parent",
       "column": "uv_code",
       "holdsData": true,
       "evidence": "Read uv_parents?$select=uv_parentid&$filter=uv_code ne null&$top=1 returned a row for this identity."
     }
   ],
   "blocked": []
   ```

   The names in the three delete operations are physical names, as Dataverse
   lists them. Dataverse deletes the lookup column together with its
   relationship. Data does not block a column deletion: `holdsData` and
   `evidence` are shown so you can review them, and a deleted column loses its
   values. Without `--prune` the same fixture gives `effect: "write"`, no
   operations, and the three removals in `blocked`.

   Pruning deletes only structures whose name starts with your prefix: keys
   the model does not declare, 1:N relationships whose lookup is on a modeled
   entity and that the model does not declare, and scalar columns the model
   does not declare. It never deletes an entity, a system, virtual, or
   lookup-shadow column, or anything outside the prefix. Changed types,
   lengths, precisions, and keys with the same name stay in `blocked`, so a
   plan that has any blocked entry still cannot be applied. A key renamed in
   the model is a `delete-key` for the old name and a `create-key` for the
   new one. [Apply the destructive plan](how-to-apply-schema.md) only with
   `--destructive`.

7. Optionally declare solution components in the same `mapping.json` (see
   [the design](design.md#14-schema-model-and-safety)): text environment
   variable definitions (`environmentVariables`) and connection references
   (`connectionReferences`):

   ```json
   {
     "prefix": "uv",
     "solution": "UnverseFixture",
     "environmentVariables": [
       {
         "schemaName": "uv_ApiUrl",
         "displayName": "API URL",
         "type": "text",
         "defaultValue": "https://api.example.test"
       }
     ],
     "connectionReferences": [
       { "displayName": "Office 365-Users", "connector": "shared_office365users" }
     ]
   }
   ```

   Planning with the command from step 1 against a synthetic environment
   where neither exists listed, besides the entity operations:

   ```json
   {
     "operations": [
       { "kind": "create-environment-variable", "schemaName": "uv_ApiUrl" },
       { "kind": "create-connection-reference", "logicalName": "uv_Office365Users" }
     ],
     "blocked": []
   }
   ```

   Where a definition already exists with another display name, type or
   default value, the plan blocks it and never shows the existing default
   value:

   ```json
   {
     "path": "environmentVariables.uv_ApiUrl",
     "reason": "Existing environment variable definition differs in display name, type or default value; definitions are never modified."
   }
   ```

   A reference with the same connector is satisfied; one with another
   connector is blocked. Variable values and connections are never read or
   changed.

8. Optionally declare security roles in the mapping document under
   `securityRoles` (see [the design](design.md#14-schema-model-and-safety)).
   `sr-Example-Users` is a placeholder role name and `parent` a modeled
   entity:

   ```json
   {
     "prefix": "uv",
     "solution": "UnverseFixture",
     "securityRoles": [
       {
         "name": "sr-Example-Users",
         "preset": "code-app-base",
         "privileges": { "prvReadAccount": "global" },
         "tables": {
           "parent": { "read": "global", "write": "global", "appendTo": "global" }
         }
       }
     ]
   }
   ```

   Against a synthetic environment (read through the built CLI with
   `--mapping-file`) where neither the role nor the tables exist, planning
   exited 0 and listed the role, then one privilege operation. Privileges of
   tables the same plan creates are `pending`; the plan has no blocks, and
   the privilege list is shortened here:

   ```json
   "operations": [
     { "kind": "create-security-role", "role": "sr-Example-Users" },
     {
       "kind": "add-role-privileges",
       "role": "sr-Example-Users",
       "privileges": [
         { "name": "prvActivateSynchronousWorkflow", "depth": "basic" },
         { "name": "prvAppendTouv_parent", "depth": "global", "pending": true },
         { "name": "prvReadAccount", "depth": "global" },
         { "name": "prvReaduv_parent", "depth": "global", "pending": true },
         { "name": "prvWriteuv_parent", "depth": "global", "pending": true }
       ]
     }
   ]
   ```

   The role is looked up by name in the root business unit. A privilege the
   role already holds at the same or a higher depth is left alone, one at a
   lower depth is raised, and privileges the role holds beyond the mapping are
   never changed or listed. A privilege name that does not exist is blocked,
   for example:

   ```json
   {
     "path": "securityRoles.sr-Example-Users.privileges.prvReadNothing",
     "reason": "The privilege does not exist in this environment."
   }
   ```

   Roles are not assigned to users or teams.

## What can go wrong

Planning is informational: exit 0 does not mean every listed change can be
applied. Any non-empty `blocked` list prevents apply. Keep the full plan, not
only the operations array. Do not edit the generated plan to bypass a block.

## Next

[Apply the reviewed plan](how-to-apply-schema.md) only after explicit approval.
