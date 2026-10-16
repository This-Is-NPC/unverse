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

1. Create a local, ignored `unverse.config.json`:

   ```json
   {
     "configVersion": 1,
     "environments": {
       "dev": {
         "url": "https://example-dev.crm.dynamics.com",
         "tenantIdEnv": "UNVERSE_TENANT_ID",
         "clientIdEnv": "UNVERSE_CLIENT_ID",
         "clientSecretEnv": "UNVERSE_CLIENT_SECRET"
       }
     }
   }
   ```

2. Set the three referenced variables through your secret manager or CI
   secret configuration. Their names may differ, but the profile must use the
   actual variable names. Missing values fail before requesting a token.

3. Validate the profile without acquiring a token:

   ```sh
   unverse config validate --env dev --json
   ```

   Offline tests observed a single JSON document with `status: "ok"`,
   `data.configVersion: 1`, and the normalized selected environment. This
   checks references and URL syntax, not credential values or reachability.

4. Run the opt-in read-only identity probe against your selected environment:

   ```sh
   unverse whoami --env dev --json
   unverse doctor --env dev --json
   ```

   The authorized DEV check observed WhoAmI organization, user, and
   business-unit IDs without logging their values. Synthetic tests verify
   that these IDs populate the result.
   `doctor` uses the same WhoAmI operation and reports its limited coverage.
   A successful probe proves only that the selected application user can
   complete WhoAmI; it does not establish privileges for other commands.

## What can go wrong

Invalid profiles exit 2, authentication failures exit 3, denied requests exit
4, and service or exhausted transport failures exit 5. Inspect `error.code`
and `coverage` in JSON. A failed doctor probe marks later checks as not run
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
