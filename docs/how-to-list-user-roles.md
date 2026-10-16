# List a user's role assignments

**The question:** Which security roles are assigned directly or through
retrieved teams to a selected user?

This page needs [a connected development environment](how-to-connect-an-environment.md).
It does not establish effective access.

## Before you start

Use [user discovery](how-to-discover-resources.md) to find the correct ID.
Besides existing ID, email, and domain selectors, `--name` accepts an exact
full name and `--caller` uses the authenticated application user. Select one;
ambiguous names still fail. No selector implies effective access.

Install the [local candidate](../README.md#install).
Ask the administrator to grant the application user read access to users,
teams, roles, and their association collections. WhoAmI alone does not prove
these reads are permitted. The email below is a synthetic placeholder.

## Steps

1. Select exactly one of `--email`, `--domain`, or `--user-id`:

   ```sh
   unverse user roles --env dev --email synthetic@example.invalid --json
   ```

   The authorized DEV check completed the caller's investigation with one
   deduplicated role, without logging user IDs or assignment names.
   Versioned synthetic fixtures at
   `packages/dataverse/test/fixtures/roles.mjs` produce a single deduplicated
   `Reader` role with both `direct` and `team` assignment sources. The user
   result includes `disabled` and business-unit information when returned.

2. Inspect `roles[].sources` and `coverage` in the result. Direct assignments,
   retrieved team memberships, and each team's roles are paginated. A fully
   completed empty assignment list exits 0. A denied or failed collection
   returns an error, never a successful empty list.

## What can go wrong

Missing or ambiguous user matches exit 2. Use a GUID to disambiguate. A
disabled user is reported as disabled; listing assignments does not claim
that user can log in. Denied reads exit 4. A later-page failure exits with its
error instead of reporting absence.

Retrieved team membership does not prove complete transitive Entra group
resolution. Role assignments do not prove table, column, or record access.
The command does not impersonate the subject.

## Next

[Check an expected assignment](how-to-check-a-role.md) for a CI-friendly exit.
