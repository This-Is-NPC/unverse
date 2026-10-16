# Unverse design

Status: configuration validation, `whoami`, and the `doctor` WhoAmI probe are
implemented and tested offline. Authorized read-only DEV observations confirm
caller identity, caller role collection, account metadata, and an empty read.
Role assignment inspection, checks, table discovery, and OData query commands
also have offline evidence. Additive schema provisioning has offline and
isolated DEV evidence. The PostgreSQL adapter and modeled transfer have
synthetic integration evidence. SQL remains outside the command surface.

Unverse is a TypeScript CLI and library for repeatable Dataverse diagnostics.
Its first release answers development questions without opening a Code App:
which application identity is calling an environment, which roles a user has,
which tables exist, and whether a read-only query meets an expectation. Its
tagline is **Unslop your data.**

## 1. Scope

The first release is a headless, read-only diagnostics tool. It supports
explicit environment selection, application authentication, caller identity,
role-assignment investigation, table discovery, OData reads, and structured
checks for automation.

It does not provide a web application, long-running server, complete Power
Apps replacement, continuous synchronization, arbitrary SQL translation,
automatic impersonation, role modification, or a complete Dataverse
migration. Declarative provisioning and verified PostgreSQL transfer are
later milestones.

## 2. Users and questions

The intended users are Code Apps developers, teams validating development,
test, and production environments, and CI systems that need structured
diagnostic results. The proposed commands answer these questions:

1. Which identity is calling which environment?
2. Does a user exist, is it enabled, and does it have a specified role?
3. Was the role assigned directly or through a team?
4. What are a table's logical name, entity set, and primary key?
5. Does a read-only validation query meet its expectation?

## 3. Principles

- TypeScript uses strict public contracts and runtime validation at external
  boundaries.
- Diagnostic operations are read-only by default.
- Human output and stable JSON output are both first-class interfaces.
- Every result identifies its environment and caller when known.
- A permission failure is never interpreted as absent data or a missing role.
- Backend capabilities are declared and verified instead of inferred.
- Semantic conversion loss is reported; it is never silently discarded.
- Shared model code works without Power Apps host dependencies.

## 4. Release boundaries

Version 0.1 is the diagnostics release. SQL through the Dataverse Web API is
optional and is exposed only after an environment-specific capability check.

Version 0.2 adds a validated declarative model, metadata inspection,
compatibility reports, additive Dataverse plans, and guarded apply support.

Version 0.3 adds a PostgreSQL adapter and a verified transfer of a declared,
portable subset. It verifies identities, relations, decimals, and temporal
values rather than claiming a complete platform migration.

## 5. Architecture

The repository is an npm workspace with these packages:

| Package | Responsibility | Runtime |
| --- | --- | --- |
| `@unverse/core` | Contracts, model validation, comparison, and reports | Node.js and browser |
| `@unverse/dataverse` | Web API client, metadata, queries, and diagnostics | Transport-specific entries |
| `@unverse/cli` | Commands, profiles, headless credentials, rendering, and exits | Node.js |
| `@unverse/postgres` | PostgreSQL adapter and mappings | Later milestone |

The core package cannot import Azure packages, Power Apps APIs, filesystem
APIs, Node-only APIs, or database drivers. Dataverse logic receives transport
and credential interfaces. The Node-only entry point owns
`@azure/identity`; that dependency must not enter a browser bundle.

Code Apps and the CLI have different identity boundaries. A Code App uses its
host's user identity and connections. The CLI calls Dataverse as an
application user. Querying another user's assignments does not reproduce that
user's table, column, or record access.

## 6. Environments and authentication

Configuration is versioned and defines named environments. Each profile has a
normalized Dataverse URL and environment-variable names for tenant ID, client
ID, and client secret. Shared configuration contains no secret values.

The initial credential is `ClientSecretCredential`. An application
registration, matching Dataverse application user, and sufficient security
roles are prerequisites in every selected environment. Delegated credentials,
certificates, and managed identity are future extensions.

Environment operations require an explicit environment name. Invalid or
incomplete profiles fail before token acquisition or a network request.
`config validate` implements this preflight without acquiring a token.

## 7. Proposed command surface

Implemented commands are generated in [the CLI reference](cli.md).
`whoami` reports organization, caller, and business unit identifiers returned
by Dataverse. `doctor` reports configuration, token, and WhoAmI checks; it
does not probe table, role, or record access. Failed probes retain their
command and selected environment and do not report successful coverage.
The following table includes implemented preflight and identity commands and
implemented role and query commands:

| Command | Intended behaviour |
| --- | --- |
| `unverse config validate --env dev` | Validate one local profile without contacting Dataverse |
| `unverse doctor --env dev` | Report configuration, authentication, reachability, and probed permissions |
| `unverse whoami --env dev` | Report organization and application user identity |
| `unverse user roles --email user@example.com --env dev` | List direct and team-derived roles |
| `unverse check role --email user@example.com --role-id <guid> --env dev` | Check one expected role assignment |
| `unverse tables list --search account --env dev` | Find table metadata |
| `unverse query --table account --select accountid,name --filter-file filter.txt --env dev` | Run a paginated OData read |

All diagnostic commands accept `--json`. `docs/cli.md` is generated from the
implemented command definitions and is never maintained by hand.

## 8. Results and exits

JSON output is a versioned envelope with command, timestamp, selected
environment, normalized URL, caller when resolved, subject when applicable,
status, data, evidence, a coverage object with limitations, and structured
errors. The
implemented configuration command emits the fields applicable to its coverage.
With `--json`, stdout contains exactly one JSON document and all progress goes
to stderr. Tokens and secrets never appear in either stream.

| Exit | Meaning |
| --- | --- |
| 0 | Operation completed; a check expectation was met |
| 1 | A completed check expectation was not met |
| 2 | Input or configuration is invalid |
| 3 | Authentication failed |
| 4 | Permission is insufficient |
| 5 | Service or transport failed after allowed retries |
| 6 | Capability is unsupported |
| 7 | The result is inconclusive or only partially covered |

An informational, fully completed empty list is successful. A presence check
over that same list fails with exit 1.

## 9. Role diagnostics

User resolution accepts GUID, email, or domain name. Disabled users are
reported and ambiguous matches require explicit selection. Role collection
includes direct assignments, team memberships, and roles assigned to those
teams, including pagination.

Roles are deduplicated by GUID while retaining direct and team assignment
evidence, team evidence, and business-unit information when available. A
missing role is reported only after all required reads complete. Partial
visibility is inconclusive or a permission error.

Role assignment inspection does not prove effective table, column, or record
access. The initial release does not impersonate users.

The implemented commands resolve exactly one user selector (GUID, email, or
domain name). A role check accepts a GUID or resolves an exact name against
the role collection, rejecting duplicate names. All required collections
must finish before a missing assignment exits 1. Denied or failed reads
return errors, not an absence claim. A disabled subject remains visible in
the result. See [listing roles](how-to-list-user-roles.md) and
[checking an assignment](how-to-check-a-role.md).

## 10. Discovery and query behaviour

Table discovery returns logical name, entity set, primary key, display name,
and intersect-table information. OData reads support selected columns, an
explicit filter file, ordering, result limits, and pagination.

Metadata discovery fetches the selected metadata columns and searches logical
names locally, case-insensitively. The authorized DEV service rejected
`contains` on metadata entities with HTTP 501 and code `0x8006088a`; metadata
search does not send that unsupported filter. Exact table resolution for
record queries still uses the supported equality filter.

`tables list` and `query` implement these reads. Query requires explicit
selected columns and resolves the logical table through metadata before
reading its entity set. A row cap with unread results produces status
`inconclusive`, exit 7, and incomplete coverage. A failed page returns an
error, not a complete partial list. SQL is absent from the command surface.
See [discovery](how-to-discover-tables.md) and
[repeatable reads](how-to-query-records.md).

Constructed values are escaped and request parameters are encoded. Continuation
links are followed only when they remain on the authenticated environment's
origin; bearer tokens never cross origins. Capped or partially retrieved
results state their completeness.

Read retries are bounded, use service retry instructions, and are tested with
controlled clocks rather than settle sleeps. SQL remains behind an explicit
capability check and does not define the portable model.

The current read transport permits three attempts for network failures and
HTTP 429, 502, 503, and 504. It accepts numeric or HTTP-date `Retry-After`
headers. A delay above 30 seconds stops retries instead of retrying earlier
than requested. Each Node HTTP attempt has a 30-second deadline; redirects
are rejected. Structured Dataverse permission errors are recognized even in
an HTTP-success response. Errors keep service context but redact tokens.

## 11. Declarative model and provisioning

The persisted model is versioned JSON. It represents entities,
fields, keys, nullability, constraints, and 1:N relations independently of
Dataverse publisher prefixes, solution names, and physical names. Decimal
precision and temporal semantics are explicit.

Choices, money, files, and polymorphic lookups are classified before mappings
are introduced. Unknown or unsupported capabilities remain visible in reports;
they do not disappear or become strings silently.

`schema inspect`, `schema plan`, and `schema apply` inspect
metadata, compare normalized snapshots, and apply only supported additive
changes. Applying requires confirmation, an exact environment binding, and a
fresh observed-state fingerprint. Destructive changes stay blocked.

## 12. PostgreSQL and transfer

The PostgreSQL workspace is created only with a real adapter. It reuses the
model and report contracts. Transfer uses an explicit manifest, records ID
mappings when source IDs cannot be preserved, orders related rows, describes
cycle handling, and supports defined checkpoints and resume behaviour.

Verification compares row counts, identity mappings, referential integrity,
decimals, and temporal values. Unsupported application behaviours, such as
workflows and access policies, remain in the report.

## 13. Development contract

Node.js 24 LTS and npm workspaces are the supported development runtime.
`mise.toml` owns the pinned toolchain and every project command. Run
`mise install`, then `mise run setup`. The full offline verification command
is `mise run check`.

Tasks live in executable files under `scripts/`; npm package metadata does
not define a second task runner. Checks use disposable HOME, XDG, and temporary
directories. Documentation link checks run with the same verification entry
point. Behaviour tests require targeted mutation evidence as described in
`AGENTS.md`.

`mise run setup` also populates the ignored `.cache/npm` dependency cache.
`package-check` copies that cache into its disposable environment and uses a
consumer lock derived from the committed graph to install packed workspaces
with `npm ci --offline`. It executes the installed `unverse` binary, checks
installed exports, builds the installed core for the browser with esbuild,
and evaluates the browser bundle in actual headless Chromium. It also runs
every installed diagnostic against boundary-injected versioned synthetic
fixtures. This is not a live Dataverse observation. Source maps include original source text;
test files, build-info files, and source directories are excluded from packs.

There is no hosted CI. `mise run setup` points `core.hooksPath` at
`scripts/hooks`, whose `pre-push` hook runs `mise run check` and stops the push
when it fails.

The project is licensed under [MIT](../LICENSE). The shared build script
copies the authoritative license into each package's output; package checks
require the notice in every tarball.

`mise run live-check` is an opt-in real DEV-session check, excluded from
offline verification. It uses an explicitly provided local environment file,
refuses environment fallbacks, and emits non-sensitive summaries. The first
authorized attempt failed before Dataverse access because the Entra
application was disabled.

The local candidate version is `0.5.0-rc.1`. After `mise run check`, run
`mise run release` to prepare tarballs, the MIT notice, and `SHA256SUMS` under
ignored `release/0.5.0-rc.1/`. The release task verifies an installed consumer;
it does not publish or push. The public npm scope remains a proposed name,
not a claim of ownership. Setup pins Playwright's Chromium download in
`.cache/playwright`; user installation does not require a browser.

`mise run screens` renders actual output from installed packages using
synthetic credential/HTTP boundaries. See [screens](screens.md) for fixture,
font, and renderer details. Images must be inspected before merge.

## 14. Schema model and safety

The implemented model is versioned JSON with named entities, an explicit UUID
primary key, a required text primary name, columns, and optional UUID references
to other modeled entities. Names are logical identifiers independent of the
Dataverse publisher prefix and solution. The mapping translates primary keys
to `<prefix>_<entity>id` and other columns to `<prefix>_<column>`. Relationships
are created after all referenced entities exist.

Text requires a maximum length (1–4000; primary names at most 850). Integer is
signed 32-bit. Decimal requires total precision and scale; the verified
Dataverse subset has at most 14 total digits, at most 10 fractional digits,
and at most 11 integer digits. UUID is supported for primary keys and 1:N
lookups, not standalone custom Dataverse UUID fields. Date maps to DateOnly;
instant requires explicit `utc` semantics and `resolution: "second"`, and maps
to UserLocal stored UTC. Fractional-second values are outside the verified
portable subset and fail validation rather than being rounded.
Money, files, polymorphic lookups, alternate keys, and unknown model
properties are rejected rather than silently converted or discarded.

Normalized metadata preserves unknown provider types as unknown. Plans report
blocked removals and changed constraints. Dataverse RequiredLevel is an
application-level rule, not an SQL NOT NULL guarantee. That limitation appears
in plan and apply results. SQL schema inference is not used.

Apply requires explicit confirmation and an independently resolved current
environment. It re-inspects metadata, deterministically rebuilds the plan,
compares the whole reviewed document, checks the solution's publisher, and
rejects stale, foreign, modified, or blocked plans before writes. It creates
entities, adds supported columns, and creates 1:N relationships only. It does
not remove structures or retry writes. Requests are not an atomic transaction.

The opt-in command below creates and removes only an empty, randomly named
DEV fixture namespace; the environment-file path is a placeholder:

```sh
UNVERSE_ALLOW_FIXTURE_WRITES=1 UNVERSE_LIVE_ENV_FILE=/path/to/approved/.env mise run schema-live-check
```

The task owns its publisher, solution, and exact fixture tables. No pre-existing
objects may be deleted. Failed cleanup is reported separately from verification.

Multiline text has an explicit maximum length of at most 1,048,576 characters.
Local single-select choices have explicit non-negative int32 values and English
(LCID 1033) labels. Duplicate values/labels and unknown options are rejected.
Inspection expands local OptionSet metadata; missing, global, multiselect, or
otherwise unknown semantics remain incompatible. Changes to an existing option
list are blocked rather than silently editing or dropping options.

A UUID column may alternatively declare `externalReference: {table, primaryKey}`
using physical logical names outside the managed prefix. Inspection and apply
verify that target's actual primary key before creating an owned lookup.
External targets are read, not provisioned or modified. An external relationship
is metadata-only: seed, portable export/import, and equivalence checks reject
external references. Model related entities explicitly for portable datasets.

## 15. Transfer contract and PostgreSQL

The original portable direction is Dataverse → PostgreSQL; Dataverse targets
use the create-only extension in §16. A versioned manifest binds
the validated model, source environment identity, explicit physical mapping,
canonical rows, and transfer policy with SHA-256. It is not a digital signature.
All modeled columns must be present; unknown entities or columns are rejected.
Row IDs are unique canonical UUIDs and relationships must resolve within the
modeled dataset. Decimal strings retain fixed scale; non-representable values
fail rather than round. Dates are calendar dates; instants are canonical UTC
with explicitly declared second resolution. Export checks metadata compatibility first.

The PostgreSQL adapter maps text to bounded varchar, integer to signed int32,
decimal to numeric(precision, scale), UUID to uuid, date to date, and instant
to timestamp(0) with time zone. It creates a new dedicated schema, all tables,
initially deferred foreign keys, then rows in deterministic entity order.
Deferred constraints permit cycles with preserved IDs. Dataverse fixture
seeding uses a separate entities-then-links sequence; it is not a public
reverse-import command.

PostgreSQL import obtains a transaction-scoped namespace advisory lock and
refuses pre-existing schemas without a matching ownership checkpoint. Schema,
rows, verification, and a manifest-bound identity checkpoint commit atomically.
On failure they roll back. Retrying an identical manifest after a committed
checkpoint verifies and returns a no-op. A changed manifest or changed
committed target is rejected instead of overwritten. There is no automatic
write retry or per-row checkpointing. A lost connection may make the commit
outcome unknown; a fresh invocation resolves it through the checkpoint.

Verification compares row counts, IDs and identity maps, references, decimal
and temporal values, SQL types, text lengths, decimal precision/scale,
nullability, timestamp precision, and relationship definitions. Read-only
verification across tables is not a transaction snapshot. Reports explicitly
exclude workflows, plugins, auditing, policies, files, and unmodeled semantics.
This is not a complete Power Platform migration or continuous synchronization.

Offline PostgreSQL checks use the mise-pinned server in a fresh private data
directory and Unix socket with no TCP listener. They wait for the server's
readiness output, stop its owned process, and remove the directory on exit.
The optional `transfer-live-check` combines the same disposable server with
the dedicated DEV fixture namespace; it is excluded from offline verification.

Multiline text maps to bounded varchar. Choices map to integer plus a validated
local-value CHECK constraint; the manifest preserves option labels. Verification
checks the expected constraint expression as well as actual values. External
reference semantics are rejected instead of losing foreign-key integrity.

## 16. Community development workflow

Discovery uses the existing paginated read client. Solutions match display and
unique names; component membership retains component type and object IDs.
Canvas and model-driven apps use separate resource sets. Cloud flows select
workflow category 5 and omit definitions and connections. User discovery feeds
the same role investigator: name selectors reject ambiguity and `--caller`
resolves the authenticated application user. Table search includes labels and
entity sets without unsupported metadata `contains` filters.

Environment comparison authenticates both explicit profiles. Solution names
are stable comparison keys; versions and managed state are compared, not
application equivalence. A named component solution additionally compares
typed object identity and root behavior, not environment-local membership IDs
or semantic dependencies. Recreated equivalent objects can have different IDs.
Variable values are compared only in memory.
The public result exposes neither values nor hashes. Secret defaults/overrides
are not fetched; secret and ambiguous values keep equality unknown. Only active
overrides participate, and they take precedence over defaults, even when empty.

`--csv` shares one implementation across commands. Results with one resource
array expand into rows; other results retain nested JSON cells. All fields are
quoted, records use CRLF, and formula-prefixed cells receive an apostrophe.
JSON remains the lossless artifact format. CSV does not anonymize personal data.

Seed specs bind a logical model, physical mapping, namespace, and keyed rows.
IDs are deterministic SHA-256-derived UUIDv8 values from namespace/entity/key.
References resolve through keyed rows, including cycles; duplicate or unresolved
keys fail before writes. No internal SLB model or real reference data is bundled.

Dataverse transfer consumes a canonical source manifest and a complete field
policy: every non-identity, non-relationship field is explicitly copied or
replaced by a valid constant. IDs remain unchanged and may still identify
people. The feature is not an automatic anonymizer. Source and target
organizations must differ; source rereading and continuous sync are not implied.

Both use one data plan/executor. Plans bind transformed data, target identity,
current target fingerprint, proposed creates, conflicts, and policy fingerprint.
Apply requires confirmation, validates plan integrity, re-authenticates the
target and rechecks current state. Existing differing rows are blocked. A
satisfied plan is verified without writes; an unsatisfied stale plan is rejected.

All creates and then links go in one bounded multipart changeset. Conditional
create requests use `If-None-Match: *`; link updates affect only IDs created in
that same changeset. No pre-existing row is modified. Every operation must
confirm success before post-write equivalence can report success. The unit of
commit/resume is one changeset (at most 1000 operations and a 4 MB request), not
a row checkpoint. A lost response remains unknown until inspection; re-plan
the immutable desired data, accept only exact matches as no-ops, and block
conflicts. Writes are never automatically retried. Reads surrounding a changeset
are not a transactional snapshot, and concurrent changes may fail verification.

`mise run discovery-live-check` performs only approved DEV reads. The opt-in
fixture task below uses the same namespace ownership rules as §14; the path
is a placeholder:

```sh
UNVERSE_ALLOW_FIXTURE_WRITES=1 UNVERSE_LIVE_ENV_FILE=/path/to/approved/.env mise run community-live-check
```

It probes extended schema, a deliberately failed atomic changeset, deterministic
seed, and an owned lookup to an existing table without modifying its records.

## 17. Dependency evidence and visualization

`packages/core/src/dependencies.ts` owns browser-safe graph contracts, incoming
impact paths, strongly connected groups, and visual projections. The Dataverse
adapter in `packages/dataverse/src/dependencies.ts` collects a bounded graph
using `RetrieveRequiredComponents` and `RetrieveDependentComponents`. These
read-only functions are platform-declared dependency evidence, not a runtime
trace. Graphs do not replace delete/uninstall checks or authorize writes.

Graph identity is scoped to the recorded environment and organization. A
component key contains its component type and underlying object UUID, never
its solution membership UUID. Connection reference types are resolved from
current `EntityDefinitions.ObjectTypeCode`; the authorized DEV probe observed
10089, not a universally hardcoded constant. Unknown component types retain
their typed IDs and observed edges, even when labels cannot be resolved.
Opaque connection keys are qualified by their connector binding.

Official arrows point from consumer to requirement and retain dependency type
numbers, including published, unpublished, and internal evidence. Solution
membership is a separate `contains` relation. Whitelisted reference metadata
adds separate `binds-to` and `uses-connector` edges. No speculative dependency
is created between solution members. Labels are resolved from known metadata
sets; app bodies, flow definitions, connector code, OpenAPI, connection parameter
configuration, and credential values are never selected. Binding endpoints
are opaque; their health, sharing, DLP, and effective permissions are not tested.

Breadth-first traversal deduplicates typed nodes and edge evidence and handles
cycles. Defaults are three hops, 200 nodes, 1000 edges, and 100 logical collection
queries, excluding identity calls, pagination, and read retries. User bounds
remain finite. Depth leaves a frontier; caps and failed or malformed reads
produce explicit issues. Authentication failure stops the operation. An unknown
root with no existence evidence cannot become a verified empty dependency set.
`complete` describes requested collection work; `closureComplete` also requires
no unexplored frontier. Direct list reports one-hop coverage; graph and impact
exit inconclusive when closure is incomplete. None proves absence of dynamic,
external, invisible, or non-solution consumers. Reads are not a transaction snapshot.

Impact follows incoming non-membership edges, returning shortest observed
paths and distances. It reports potential review targets, not guaranteed
breakage. Cycles are strongly connected groups in the retained graph. A
bidirectional graph explores a neighborhood; it is not itself an impact claim.

HTML output embeds a Cytoscape.js canvas and its MIT license. The viewer bundle
is built by `mise run build-viewer`; the browser-safe core consumes it as text.
It needs JavaScript but no external assets, fonts, callbacks, or remote
renderers. A hash-based script CSP permits only the embedded bundle and denies
network connections. JSON metadata escapes less-than signs before embedding;
labels and evidence use text nodes, not markup. The view initially groups
artifacts by type. Each type is one unit: a collapsed card, or a labelled box
holding its artifacts in a grid. Units are placed by a deterministic layered
layout, consumers left of requirements, so overview, expansion and focus keep
the same map. Arrows are drawn between units with counts; selecting an
artifact adds its own arrows. Unresolved labels show the first eight object ID
characters inside their type box. It supports pan, cursor-centered zoom, minimap navigation,
search, filters, neighborhood focus and evidence inspection. Group expansion
only reveals captured data. It does not query Dataverse. An incomplete graph
is visibly marked. Mermaid uses generated
node identifiers and escaped labels, not user-provided directives. The SVG
export renders that same Mermaid text with Pele in `@unverse/core`: synchronous,
no runtime dependencies, browser-safe. A title states coverage, and an embedded
style sets light and dark palettes matching the canvas. Pele's default source,
edge, and output limits are lifted because graph budgets already bound the
input; a 1000-node, 10000-edge graph rendered in about 430 ms when measured.
Node measures label widths with Pele's built-in font metrics, so CLI output is
deterministic; in a browser Pele measures with canvas, so coordinates differ
while labels and structure match.
All three are projections; JSON preserves the full evidence, paths, query counts, issues,
scope, environment, and caller result. The installed-package check executes
the renderer and analyzer in actual Chromium, checks canvas navigation,
group expansion, search, selection and filters, and observes
zero document network requests. These files still contain organizational
metadata and must be reviewed before sharing.

`mise run dependencies-live-check` is an opt-in read-only DEV probe using the
same explicit environment-file boundary as other live checks. It records only
counts and public issue codes, never resource names, IDs, or connection bindings.

API contracts: [dependency functions](https://learn.microsoft.com/en-us/power-platform/alm/check-solution-dependencies),
[dependency entity](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/dependency),
[connection references](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/connectionreference),
and [connectors](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/connector).
