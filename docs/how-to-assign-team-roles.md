# Assign security roles to teams

**The question:** How do I give existing teams the security roles they need,
through a plan I review first?

This page is enough on its own for adding roles. It does not create roles or
teams, remove roles, or assign roles to users. To create roles see
[the schema design](design.md#14-schema-model-and-safety).

## Before you start

- [Connect an environment](how-to-connect-an-environment.md). The application
  user needs permission to read teams and roles and to assign roles.
- The teams and roles already exist. A role is found by name in the team's own
  business unit. A role of the root business unit has a copy in each child
  business unit; the team gets the copy of its own unit, because Dataverse
  rejects a role from another unit.
- Write an access document. `access.json` and the names in it are placeholders:

  ```json
  {
    "accessVersion": 1,
    "teams": [
      { "team": { "name": "Child Team" }, "roles": ["sr-Example-Users"] }
    ]
  }
  ```

  A team is given by exactly one of `{ "id": "<guid>" }`, `{ "name": "<team
  name>" }` (it must match one team), or `{ "environmentVariable": "<schema
  name>" }`. The variable holds the team ID: its current value is used, else
  its default value. A secret or unset variable exits 2.

## Steps

1. Plan. This only reads:

   ```sh
   unverse access plan --env dev --access-file access.json --format json > access-plan.json
   ```

   The result (exit 0; envelope trimmed) has `kind` `access`, `effect`
   `write` and:

   ```json
   "satisfied": [],
   "operations": [
     {
       "kind": "assign-team-role",
       "teamId": "00000000-0000-0000-0000-0000000000b1",
       "teamName": "Child Team",
       "roleName": "sr-Example-Users",
       "roleId": "00000000-0000-0000-0000-0000000000c2"
     }
   ],
   "blocked": []
   ```

   A role the team already has is listed under `satisfied`. A role that is
   missing or ambiguous in the team's business unit is listed under `blocked`
   with a `reason`, and the plan cannot be applied until you fix the document
   or the environment.

2. Check without writing:

   ```sh
   unverse verify access-plan.json --env dev --format json
   ```

   Before applying, this exits 1 with `"satisfied": false` and the remaining
   operations.

3. Review the plan, then apply it:

   ```sh
   unverse apply access-plan.json --env dev --confirm --format json
   ```

   Apply checks the plan and environment, re-reads the state and rejects a
   plan that no longer matches. It sends one association per operation and
   reads the state again. The result has `"verified": true` and the
   `assigned` operations, and exits 0.

4. Verify again. It exits 0 with `"satisfied": true`.

The outputs above come from the built CLI against synthetic fixtures.

## What can go wrong

- Exit 2: the team name matches several teams or none, the variable is secret
  or unset, or the document is invalid. Select the team by `id`.
- A stale plan is rejected without writes: plan again.
- Roles are never removed from a team. Remove them in Dataverse.
- Effective access to records is not checked.

## Next

[List the roles a user receives](how-to-list-user-roles.md), or
[check one assignment](how-to-check-a-role.md).
