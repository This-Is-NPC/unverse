# Check an expected role assignment

**The question:** Can CI fail when a completed investigation finds no expected
security-role assignment?

This page builds on [listing user roles](how-to-list-user-roles.md).

## Before you start

The user selector also accepts exact `--name` or `--caller`. Use
[user discovery](how-to-discover-resources.md) to disambiguate; the latter is
the application's authenticated user, not the interactive shell user.

Use the same connected development profile and read permissions as the list
command. The GUID and email below are synthetic placeholders. Prefer a role
GUID: role names are not unique across business units.

## Steps

1. Select a user and exactly one of `--role-id` or `--role`:

   ```sh
   unverse check role --env dev --email synthetic@example.invalid --role-id 00000000-0000-0000-0000-000000000002 --json
   ```

   Synthetic CLI tests observed exit 1 and `data.assigned: false` for a
   complete empty investigation; the informational list over the same
   fixture exited 0. This is offline evidence, not a live observation.

2. Read both the JSON status and the process exit. An assigned role exits 0.
   A completed missing expectation exits 1. A permission error exits 4; it
   cannot become a failed expectation. The JSON retains evidence, selected
   environment, caller, subject, and coverage limitations.

## What can go wrong

An ambiguous role name exits 2 and requires `--role-id`. A disabled user may
still have assignments. A successful assignment check does not prove that
user can access a record or use a Code App. Transitive group membership is
not inferred beyond the retrieved teams.

## Next

Read [the CLI reference](cli.md#check-role) and the
[result contract](design.md#8-results-and-exits) when integrating with CI.
