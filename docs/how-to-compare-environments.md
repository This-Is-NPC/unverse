# Compare environment configuration

**The question:** Which solution versions and environment variable settings
differ between two explicitly selected environments?

This page requires [connected profiles](how-to-connect-an-environment.md) for
both environments. It never writes configuration.

## Before you start

Configure separate profile names and URLs. The names below are placeholders
for those profiles. Both environments authenticate independently; the result
records source and target caller evidence. A source permission failure is not
treated as an empty source, and a target failure is not a missing target item.

## Steps

1. Inspect masked variable configuration:

   ```sh
   unverse variables list --env dev --json
   ```

   The installed fixture returned `fixture_endpoint`, `configured: true`,
   `source: "default"`, and `value: "[MASKED]"`. Secret definitions report
   `source: "secret"` and unknown configuration; secret defaults and overrides
   are not fetched. More than one active override is reported as ambiguous.

2. Compare the profiles:

   ```sh
   unverse environment compare --env dev --target-env test --scope all --component-solution CommunityFixture --json
   ```

   The solution name is also a placeholder. The fixture reported `equal: true`.
   Scope can be `solutions`, `variables`, `components`, or `all`. Solutions are matched by unique name and compare version and
   managed state. Variables are matched by schema name and compare type,
   configured state, and effective value in memory. Overrides take precedence
   over defaults, including explicitly empty values.

   Component comparison requires the same unique solution name in both
   profiles. It compares component type, object ID, and root behavior, not
   environment-local membership IDs. With scope `all`, component membership
   participates only when `--component-solution` is supplied. Without it,
   the report explicitly says component membership was not compared.

3. Read the result, not only its exit:

   - Exit 0: selected comparisons completed and matched.
   - Exit 1: completed comparisons found differences.
   - Exit 7: secret or ambiguous values prevent a complete equality claim.
   - Other errors: the investigation failed, rather than establishing a difference.

## What can go wrong

Values, defaults, override contents, and their hashes are never emitted by
these commands. Non-secret strings can still contain credentials, so there
is no option to reveal values. Unknown values do not become equal merely
because both are masked. A difference report names only the variable and
field, not the before/after value. No comparison is a transactional snapshot.

Matching solution versions or typed membership do not establish application
equivalence. Independently recreated equivalent objects can have different
IDs. [Inspect component membership](how-to-discover-resources.md)
to investigate differences; this command does not claim a semantic dependency diff.

## Next

Use [CSV output](how-to-export-csv.md) for review, or investigate the differing
resource in the selected environment. There is no automatic configuration sync.
