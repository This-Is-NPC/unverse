# Explore and visualize artifact dependencies

**The question:** What does this artifact depend on, and which declared
relationships connect the surrounding artifacts?

This page builds on [resource discovery](how-to-discover-resources.md) and
[connection reference inspection](how-to-inspect-connections.md).

## Before you start

Choose one scope: a solution ID, a reference ID, or an underlying component
object ID together with its component type. Object IDs are not solution
membership IDs. Reference component types are resolved from current environment
metadata, not hardcoded or assumed portable between environments.

All GUIDs and paths below are placeholders. The graph includes only metadata
visible to the authenticated application user. No artifact is modified.

## Steps

1. Read direct requirements or consumers:

   ```sh
   unverse dependencies list --env dev --reference-id 00000000-0000-0000-0000-000000000101 --direction dependent --json
   ```

   The installed fixture observed a flow requiring that reference. Each solid
   dependency points **from consumer to requirement**, regardless of traversal
   direction. `required` follows requirements, `dependent` follows consumers,
   and `both` explores the bounded connected neighborhood. Direct list defaults
   to `required`; graph defaults to `both`.

2. Build a transitive graph:

   ```sh
   unverse dependencies graph --env dev --reference-id 00000000-0000-0000-0000-000000000101 --depth 6 --json
   ```

   The synthetic graph contains flows, a canvas app, a custom connector, an
   opaque connection, an API binding, and an unresolved typed component.
   It preserves a flow cycle and distinguishes equal GUIDs of different types.
   A component can remain named only by type/ID without losing observed edges.

   To start from a solution, use `--solution-id` instead. Membership creates
   `contains` edges and seeds traversal; it never invents dependencies between
   members. For another component, use `--object-id` and `--component-type`
   together, with the pair returned by solution component inventory.

3. Export an actual visual graph:

   ```sh
   unverse dependencies graph --env dev --reference-id 00000000-0000-0000-0000-000000000101 --depth 6 --html > dependencies.html
   ```

   Open the file in a browser with JavaScript enabled. The canvas fills the
   window and starts with artifacts grouped by type, laid out in layers from
   consumers on the left to requirements on the right and fitted to the
   window. An expanded type becomes a labelled box of its artifacts in the
   same place; click the box, then **Collapse group**, to fold it again.
   Arrows join types and carry counts; selecting an artifact draws its own
   arrows. Unresolved artifacts show `#` and the first eight characters of
   their object ID. Click a group, then **Expand group**, or use
   **Show all artifacts**. Drag the background to pan; use the wheel to zoom
   around the cursor. Drag nodes to adjust their positions. **Fit view** fits
   the visible nodes, **Arrange** reruns the layout, and **Go to root** selects
   the starting artifact. Click or drag the minimap to move the viewport.

   Search by name, logical name, object ID, or component type. Select a result
   to reveal it and read full identifiers and relation evidence in the details
   panel; `×`, `Escape` or a click on the background closes it. **Focus
   neighbors** isolates its captured neighborhood. `☰` opens the type and
   relation checkboxes that filter the view, and the legend. The coverage
   status at the top right opens the snapshot summary. **Grouped overview**
   restores the type overview. `/` focuses search and `Escape` clears it. With the canvas
   focused, arrow keys pan, `+` and `-` zoom, and `0` fits the view. The page
   follows the browser's light or dark color setting.

   Arrows point from consumer to requirement. Blue outlines mark requirements;
   amber outlines mark consumers. Double borders mark observed cycles.
   Dashed lines are membership or explicit bindings, not platform dependency
   evidence. Expanding groups only reveals captured data; it makes no live
   queries and cannot complete missing coverage. Unknown connection endpoints
   are not health-tested nodes. The file embeds Cytoscape.js and its MIT
   license, with no external fonts, assets, remote renderer, or network requests.

4. For Markdown-compatible tooling, replace `--html` with `--mermaid` and save
   a `.mmd` file. Metadata labels are escaped rather than treated as diagram
   directives or HTML.

5. For a picture to embed in a page or a pull request, replace `--html` with
   `--svg` and save a `.svg` file. The same Mermaid graph is drawn locally by
   Pele. The title says whether the graph is complete and counts its frontier
   and issues. The file follows the viewer's light or dark setting and has no
   scripts or external assets.

   ![Static SVG dependency graph](img/28-dependency-svg.png)

   Select one output format; JSON retains the complete versioned result, while
   HTML, Mermaid, and SVG are visual projections.

## What can go wrong

The default bounds are depth 3, 200 nodes, 1000 edges, and 100 logical collection
queries. `--depth` supports 0–10; `--max-nodes`, `--max-edges`, and `--max-queries`
adjust the documented bounds in [the CLI reference](cli.md#dependencies-graph).
The query budget excludes WhoAmI, HTTP pagination, and safe-read retries.

Graph and impact exit 7 when traversal has failures, limits, or a depth frontier.
They retain the partial graph and show an incomplete warning. Direct list can
exit 0 when its one-hop investigation completed, even though transitive closure
was not requested or proven. JSON separates `complete` (requested reads) from
`closureComplete` (no unexplored frontier). A failed read never proves no usage.

`--no-bindings` omits connection enrichment without changing official edges.
Dynamic URLs, resources outside solutions, API permissions, runtime calls,
and external systems are outside the declared graph. Reads are not a transaction
snapshot. HTML, Mermaid, and SVG include environment names and resource identifiers;
share only after reviewing their contents.

## Next

[Assess potential impact](how-to-assess-dependency-impact.md). The graph is
not an authorization to delete or uninstall anything.
