# Connect a development environment

**The question:** How do I configure application authentication and identify
the caller in a Dataverse development environment?

This page needs the [installed local release candidate](../README.md#install).
No npm release has been published. It is enough for the implemented identity
probe, not for validating table or record permissions.

## Before you start

- Use a dedicated development environment, not production.
- Register an application in Microsoft Entra ID. Record its tenant ID and
  client ID, and create a client secret. Keep the secret in an approved secret
  store; do not put it in a command argument, a transcript, or this repository.
- In the Power Platform admin center, add an application user for that
  registration to the target environment. Assign only the security roles
  approved by your environment administrator. Unverse does not create or
  assign security roles.
- Confirm your actual Dataverse HTTPS origin with the administrator. The
  hostname below is a synthetic placeholder, not a working environment.

## Steps

1. In the root of your project, create `.unverse/config.json`. `your-org`
   in `url` is a placeholder for your Dataverse HTTPS origin, and the three
   `...Env` fields name the variables of step 2:

   ```json
   {
     "configVersion": 1,
     "environments": {
       "dev": {
         "url": "https://your-org.crm.dynamics.com",
         "tenantIdEnv": "UNVERSE_TENANT_ID",
         "clientIdEnv": "UNVERSE_CLIENT_ID",
         "clientSecretEnv": "UNVERSE_CLIENT_SECRET"
       }
     }
   }
   ```

   The file holds names of variables, never secret values, so it can be
   committed. Every command finds it from the directory you run it in, then
   its parents, up to the filesystem root. `--config <path>` or
   `UNVERSE_CONFIG` names another file instead.

2. Set the three referenced variables through your secret manager or CI
   secret configuration. Their names may differ, but the profile must use the
   actual variable names. Missing values fail before requesting a token.

3. Validate the profile without acquiring a token:

   ```sh
   unverse config check --env dev --format json
   ```

   `--env` names the environment. `UNVERSE_ENV=dev` does the same and `--env`
   wins when both are set. The name is never read from a file: without
   `--env` or `UNVERSE_ENV` the command exits 2. Every result records where
   the configuration and the environment name came from in `evidence`, run
   from a subdirectory of the project (the paths are from a temporary
   directory):

   ```text
   Configuration /tmp/app/.unverse/config.json found by searching up from /tmp/app/src.
   Environment dev from --env.
   ```

   `data.configuration` carries the same path and origin for `config check`
   and `env list`.

   Offline tests observed a single JSON document with `status: "ok"`,
   `data.configVersion: 1`, and the normalized selected environment. This
   checks references and URL syntax, not credential values or reachability.

   To see which profiles a configuration file defines, run `unverse env list`.
   It reads only the file. Run against the synthetic fixture configuration, it
   returned `data.environments` as
   `[{"name":"test","url":"https://synthetic-test.crm.dynamics.com"},{"name":"dev","url":"https://synthetic.crm.dynamics.com"}]`.
   Credential variable names are not printed.

4. Run the opt-in read-only identity probe against your selected environment:

   ```sh
   unverse env whoami --env dev --format json
   unverse env doctor --env dev --format json
   ```

   The authorized DEV check observed WhoAmI organization, user, and
   business-unit IDs without logging their values. Synthetic tests verify
   that these IDs populate the result.
   `env doctor` uses the same WhoAmI operation and reports its limited coverage.
   A successful probe proves only that the selected application user can
   complete WhoAmI; it does not establish privileges for other commands.

5. Pin the profile to its organization, so a swapped or edited
   configuration cannot reach another environment. Read `organizationId` from
   the `env whoami` output (the IDs below are synthetic):

   ```json
   "data": {
     "organizationId": "0a1b2c3d-1111-4222-8333-444455556666",
     "applicationUserId": "00000000-0000-4000-8000-000000000001",
     "businessUnitId": "00000000-0000-4000-8000-000000000002"
   }
   ```

   Copy that value, in lowercase, into the profile as
   `"expectedOrganizationId": "0a1b2c3d-1111-4222-8333-444455556666"`.
   `config check` rejects a value that is not a lowercase GUID, without
   contacting Dataverse. From then on every command that contacts the
   environment first checks that WhoAmI returns this organization, and
   `env whoami` and `env doctor` add the match to `evidence`:

   ```text
   Organization 0a1b2c3d-1111-4222-8333-444455556666 matches expectedOrganizationId 0a1b2c3d-1111-4222-8333-444455556666.
   ```

   A different organization fails with exit 2 and no other request is sent
   (output from the built CLI against a synthetic transport):

   ```json
   "error": {
     "code": "invalid-input",
     "message": "Environment \"dev\" expects organization ffffffff-1111-4222-8333-444455556666 but https://example-dev.crm.dynamics.com is organization 0a1b2c3d-1111-4222-8333-444455556666."
   }
   ```

   Commands that use two profiles check each profile that sets the field.
   The field is optional; profiles without it are not checked.

## What can go wrong

No `.unverse/config.json` from the current directory up to the root, no
environment name, invalid profiles, and an organization that differs from
`expectedOrganizationId` exit 2, authentication failures exit 3, denied requests exit
4, and service or exhausted transport failures exit 5. Inspect `error.code`
and `coverage` in JSON. A failed `env doctor` probe marks later checks as not run
or unknown, rather than successful. No table, role, or record privilege is
inferred from WhoAmI.

The CLI uses an application identity. A Code App uses host-provided user
identity and connections. These sessions are not interchangeable, and this
command does not impersonate a Code App user.

Microsoft Entra error `AADSTS7000112` means the application is disabled. An
administrator must enable the intended application or provide another
approved application credential. Unverse cannot repair that identity setting.
The first opt-in DEV attempt observed this error before any Dataverse
request. A later user-supplied application credential authenticated
successfully; the earlier error is not a current blocker for that credential.

For an explicitly approved local credential file using `DATAVERSE_DEV_URL`,
`DATAVERSE_TENANT_ID`, `DATAVERSE_CLIENT_ID`, and `DATAVERSE_CLIENT_SECRET`, the
read-only verification entry point is:

```sh
UNVERSE_LIVE_ENV_FILE=/path/to/approved/.env mise run live-check
```

The path is a placeholder. This task refuses fallback to TEST or PROD and
refuses a DEV origin that matches another configured environment. It logs
only summary evidence and public diagnostic codes, never credential values
or record contents. It is excluded from the offline check.

## Next

Read the [CLI reference](cli.md) for implemented arguments and
[identity boundaries](design.md#5-architecture) before investigating access.
