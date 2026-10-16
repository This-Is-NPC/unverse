# Find applications, flows, solutions, and users

**The question:** How do I find the identifiers needed to develop and diagnose
a Dataverse application without knowing its internal names?

This page needs [a connected environment](how-to-connect-an-environment.md).

## Before you start

Install the candidate. The application user needs read permissions for the
resource kinds selected. Search is case-insensitive and runs locally after
all visible pages have been collected. Inventory is not a cross-resource
transactional snapshot or a proof that the caller can see everything.

## Steps

1. Find solutions and inspect their membership:

   ```sh
   unverse solutions list --env dev --search fixture --json
   unverse solution components --env dev --solution-id 00000000-0000-0000-0000-000000000011 --json
   ```

   The GUID is a placeholder. The installed fixture returned `CommunityFixture`
   and one component with `componentType: 80`. Component object IDs are not
   resolved into a complete dependency graph. Use the returned solution ID,
   not a guessed ID from another environment.

2. Find apps and flows:

   ```sh
   unverse apps list --env dev --search synthetic --json
   unverse apps list --env dev --kind model-driven --json
   unverse flows list --env dev --search synthetic --json
   ```

   The fixture returned one canvas app, one model-driven app, and one cloud
   flow. Apps are read from `canvasapps` and `appmodules`; flows are workflows
   with category 5. These commands never retrieve app contents, flow definitions,
   connections, or executable artifacts. Non-solution apps or flows not exposed
   by Dataverse are outside this inventory.

3. Find a table by logical name, displayed label, or entity set:

   ```sh
   unverse tables list --env dev --search accounts --json
   ```

   The fixture resolves `accounts` to logical table `account`. Continue with
   [table discovery](how-to-discover-tables.md) and [record reads](how-to-query-records.md).

4. Resolve a user before investigating roles:

   ```sh
   unverse users list --env dev --search synthetic --json
   unverse user roles --env dev --name "Synthetic User" --json
   unverse user roles --env dev --caller --json
   ```

   The fixture returned one deduplicated role with direct and team sources.
   `--name` matches an exact full name and rejects ambiguity. `--caller` uses
   the application user returned by WhoAmI, not the person running the shell.

## What can go wrong

An unavailable or denied resource kind fails instead of becoming an empty
inventory. Request one app kind if the other is outside your permissions;
the default `all` does not hide a failed half of the investigation. User lists
contain personal data; keep exports private. Role assignments do not prove
effective record, field, or table access or transitive Entra group membership.

## Next

[Compare environment configuration](how-to-compare-environments.md) or
[check an expected role](how-to-check-a-role.md).
