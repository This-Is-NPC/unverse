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
   unverse solution list --env dev --search fixture --format json
   unverse solution show 00000000-0000-0000-0000-000000000011 --env dev --format json
   ```

   The GUID is a placeholder. The installed fixture returned `CommunityFixture`
   and one component with `componentType: 80`. Component object IDs are not
   resolved into a complete dependency graph. Use the returned solution ID,
   not a guessed ID from another environment.

2. Find apps and flows:

   ```sh
   unverse app list --env dev --search synthetic --format json
   unverse app list --env dev --kind model-driven --format json
   unverse flow list --env dev --search synthetic --format json
   ```

   The fixture returned one canvas app, one model-driven app, and one cloud
   flow. Apps are read from `canvasapps` and `appmodules`; flows are workflows
   with category 5. These commands never retrieve app contents, flow definitions,
   connections, or executable artifacts. Non-solution apps or flows not exposed
   by Dataverse are outside this inventory.

3. Find apps and flows that Dataverse tables do not list, with the Power
   Platform API source. First set the profile's `platformEnvironmentId` to the
   Power Platform environment ID (a lowercase GUID, not the Dataverse
   organization ID; `1111aaaa-2222-3333-4444-55555555bbbb` is a placeholder),
   register the application with Power Platform, and give it an RBAC role
   ([design §20](design.md#20-power-platform-api-source)):

   ```sh
   unverse app list --env dev --source platform --search canvas --format json
   unverse flow list --env dev --source platform --format json
   ```

   Against a fake transport returning the documented shapes, the first command
   followed `nextLink` across two pages and returned
   `{"id":"00000000-0000-0000-0000-000000000001","name":"Fixture Canvas","source":"platform"}`
   and a second app, sorted by name, with exit 0. The flow command returned
   `{"id":"00000000-0000-0000-0000-000000000007","name":"Synthetic Flow","source":"platform","kind":"cloud-flow","state":1}`.
   Fields the API does not provide are absent, not guessed. **This source was
   read in the documentation, not observed running against a real tenant;
   whether flows and apps outside Dataverse tables appear must be verified in a
   real environment.** `--kind` is not accepted with this source.

4. Find a table by logical name, displayed label, or entity set:

   ```sh
   unverse table list --env dev --search accounts --format json
   ```

   The fixture resolves `accounts` to logical table `account`. Continue with
   [table discovery](how-to-discover-tables.md) and [record reads](how-to-query-records.md).

5. Resolve a user before investigating roles:

   ```sh
   unverse user list --env dev --search synthetic --format json
   unverse user show --env dev --name "Synthetic User" --format json
   unverse user show --env dev --caller --format json
   ```

   The fixture returned one deduplicated role with direct and team sources.
   `--name` matches an exact full name and rejects ambiguity. `--caller` uses
   the application user returned by WhoAmI, not the person running the shell.

## What can go wrong

With `--source platform`, a profile without `platformEnvironmentId` exits 2
(`--source platform requires platformEnvironmentId in the selected environment
profile.`). A caller without a Power Platform role exits 4 (`The caller has no
Power Platform role.` in the fake run); an invalid token exits 3. Service
principals can read flows only where no license is required. Neither failure
becomes an empty list.

An unavailable or denied resource kind fails instead of becoming an empty
inventory. Request one app kind if the other is outside your permissions;
the default `all` does not hide a failed half of the investigation. User lists
contain personal data; keep exports private. Role assignments do not prove
effective record, field, or table access or transitive Entra group membership.

## Next

[Compare environment configuration](how-to-compare-environments.md) or
[check an expected role](how-to-check-a-role.md).
