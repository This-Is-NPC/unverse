# Terminal views

Unverse has no TUI, interactive forms, or persistent screens. Every diagnostic
prints output and exits. `--help` displays help; `Ctrl-C` interrupts a running
command. Credential acquisition has no interactive login screen.

## How pictures are made

The dependency visual scene renders the installed command's actual `--html`
output instead of wrapping stdout in a terminal view. It is a real canvas page
rendered in the pinned Chromium revision. Its layout, synthetic metadata,
colors, and viewport are pinned; its browser system fonts are not portable
pixel-identical across operating systems. It loads no external assets or scripts.
The static SVG scene places the installed command's actual `--svg` output in
the same Chromium page and captures only the drawing. Pele measures text with
its own estimate, so the layout is pinned; the browser's sans-serif font is not.

Use `mise run screens --only 01-help,12-solutions` to redraw only named changed
scenes. The command without a selection redraws all scenes before merge.

`mise run screens` installs packed workspaces in a disposable consumer and
executes the installed `unverse` binary. Versioned fixtures in
`packages/cli/test/fixtures/installed.mjs` replace Azure token acquisition and
HTTP at the boundary. No real account, data, or credential is used.

The generator renders captured stdout in a browser terminal-style text view;
these are not screenshots of a native terminal emulator. The prompt is a
caption of the executed command. Timestamps, GUIDs, fixtures, viewport,
Chromium revision, font version, and colours are pinned. The renderer waits
for font readiness rather than sleeping. The images show actual output, not
handwritten results. JSON mode uses the same command behaviour but has no
separate screen. Live checks, packaging, and CI have no persistent UI.

## 1. Help

`unverse --help` lists the implemented command definitions and arguments.

![Help](img/01-help.png)

## 2. Configuration

`unverse config validate --env dev` validates only the local profile.

![Configuration](img/02-config.png)

## 3. Caller identity

`unverse whoami --env dev` reports returned organization and caller evidence.

![WhoAmI](img/03-whoami.png)

## 4. Environment probe

`unverse doctor --env dev` reports the limited WhoAmI probe.

![Doctor](img/04-doctor.png)

## 5. User roles

`user roles` retains direct and retrieved-team assignment sources.

![Role inspection](img/05-user-roles.png)

## 6. Expected assignment

`check role` distinguishes a completed missing expectation from failed reads.

![Role check](img/06-check-role.png)

## 7. Discovery

`tables list` reports metadata without guessing physical names.

![Tables](img/07-tables.png)

## 8. Read query

`query` prints selected columns and explicit coverage.

![Query](img/08-query.png)

## 9. Schema inspection

An empty synthetic namespace has no managed entities.

![Schema inspection](img/09-schema-inspect.png)

## 10. Schema plan

The read-only fixture plans two entities, explicit mappings, and a relationship.

![Schema plan](img/10-schema-plan.png)

## 11. Schema apply

There is no persistent apply screen or confirmation dialog. The operator must
pass `--confirm` explicitly; the one-shot JSON result reports the re-inspected
plan. The picture task does not perform schema writes. The dedicated DEV
fixture check exercises apply, an additive field, and idempotence separately.

## 12. Transfer export

The installed fixture emits a versioned, fingerprinted manifest for two
related synthetic rows. It contains values and IDs and should be kept private
when used with real data.

![Transfer export](img/11-transfer-export.png)

## 13. Transfer import and verification

These commands have no persistent screens or interactive dialogs. Import
requires `--confirm`. Both print the same versioned result envelope, containing
counts, identity maps, differences, and checkpoint status. The package check
executes both installed commands against a disposable PostgreSQL instance;
the picture renderer does not connect to a user's PostgreSQL database.

## 14. Solutions

Display-name and unique-name searches return IDs for the next command.

![Solutions](img/12-solutions.png)

## 15. Component membership

An explicit solution ID selects typed component object IDs, not a complete
dependency graph.

![Components](img/13-components.png)

## 16. Apps

Canvas and model-driven resources remain distinguishable.

![Apps](img/14-apps.png)

## 17. Cloud flows

Only metadata is returned; definitions and connections are not exported.

![Flows](img/15-flows.png)

## 18. Users

Use these explicit identifiers with the existing role investigator.

![Users](img/16-users.png)

## 19. Variables

Values are masked even in synthetic screenshots.

![Variables](img/17-variables.png)

## 20. Environment comparison

The synthetic profiles match. Real differences report field names, never values.

![Comparison](img/18-comparison.png)

## 21. Seed planning

Deterministic fixture IDs and create-only operations are reviewed before apply.

![Seed plan](img/19-seed-plan.png)

## 22. Dataverse transfer planning

The installed fixture's target is already satisfied, so no creates are needed.

![Transfer plan](img/20-transfer-plan.png)

## 23. Seed and Dataverse transfer apply

Neither has a persistent screen or interactive confirmation dialog. Both
require `--confirm` and print verification with a changeset checkpoint. The
picture renderer does not issue writes. Installed-package checks exercise
satisfied-plan resume, while synthetic integration exercises creates and links.
CSV is an output format for these same commands, not another screen.

## 24. Solution-aware connectors

Only connector metadata is returned, not its OpenAPI, code, or credentials.

![Connectors](img/21-connectors.png)

## 25. Connection references

Linked does not mean healthy or usable by the current flow owner.

![References](img/22-connection-references.png)

## 26. One reference

An explicit reference ID selects its metadata without testing the connection.

![Reference inspection](img/23-reference-inspection.png)

## 27. Direct dependencies

The one-hop result separates official dependencies from explicit binding evidence.

![Direct dependencies](img/24-dependencies.png)

## 28. Graph evidence

Typed nodes, edges, scope, frontier, query count, and issues remain in JSON.

![Dependency graph evidence](img/25-dependency-graph.png)

## 29. Potential impact

Incoming paths identify consumers to review, not guaranteed runtime breakage.

![Potential impact](img/26-dependency-impact.png)

## 30. Visual dependency graph

The installed `--html` output is opened in Chromium after its layout finishes.
The canvas fills the window; small floating toolbars sit on top of it. The
initial view groups artifacts by type in layers, consumers left of their
requirements, and fits them to the window. Expanding a type turns it into a
labelled box of its artifacts in the same place; arrows join types, and
selecting an artifact draws its own arrows. Drag to pan, use the wheel to zoom,
and click the minimap to navigate. `/` focuses search; search reveals a captured
artifact, and selecting it opens identifiers and evidence in a details panel
that closes with `×`, `Escape` or a click on the background. `☰` opens type
and relation filters and the legend; the coverage status opens the snapshot
summary. The page follows the browser's light or dark setting; the picture
shows light. Blue outlines indicate
requirements, amber outlines consumers, and double borders observed cycles.
Arrows point from consumer to requirement. Dashed edges are membership or
explicit bindings, not invented platform dependencies. Filters, group expansion
and neighborhood focus do not fetch more data. Arrow keys pan a focused canvas;
`+` and `-` zoom and `0` fits it. There is no server, login window, or callback.

![HTML dependency graph](img/27-dependency-visual.png)

Mermaid is another representation of the same graph, not a separate persistent
screen. Incomplete graphs have explicit visual warnings in every format.

## 31. Static SVG dependency graph

`--svg` writes the Mermaid graph drawn by Pele as one SVG file. It has no keys
and no interaction. The title states complete or incomplete, the frontier and
the issue count. The root has a blue outline; solid arrows are declared
dependencies and dashed arrows are membership or bindings. The file follows the
viewer's light or dark setting; the picture shows light.

![Static SVG dependency graph](img/28-dependency-svg.png)
