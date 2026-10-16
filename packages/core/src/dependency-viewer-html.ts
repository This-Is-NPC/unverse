import type { analyzeDependencies, DependencyGraph } from "./dependencies.js";
import { viewerScript, viewerScriptHash } from "./viewer-script.js";

export function dependencyViewerHtml(payload: {
  graph: DependencyGraph;
  analysis: ReturnType<typeof analyzeDependencies>;
}): string {
  const data = JSON.stringify(payload)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${viewerScriptHash}'; style-src 'unsafe-inline'; connect-src 'none'; worker-src 'none'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"><title>Unverse · Dependency explorer</title><style>
:root{color-scheme:light dark;--bg:#fff;--island:#fff;--hover:#f1f0ff;--active:#e0dfff;--active-ink:#3d3a9e;--line:#e9e9ef;--ink:#1b1b1f;--muted:#6b6b76;--faint:#a3a3ad;--grid:#e6e6ec;--accent:#6965db;--req:#2563eb;--amber:#d97706;--ok:#16a34a;--warn:#b45309;--warn-soft:#fff7e6;--edge:#9a9aa6;--edge-soft:#d6d6de;--binding:#14b8a6;--shadow:0 0 0 1px #0000000a,0 1px 3px #0000000f,0 6px 20px #0000000d}
@media(prefers-color-scheme:dark){:root{--bg:#121212;--island:#232329;--hover:#2e2d39;--active:#403e6a;--active-ink:#e0dfff;--line:#2e2e35;--ink:#e3e3e8;--muted:#a3a3ad;--faint:#6b6b76;--grid:#232328;--accent:#a8a5ff;--req:#60a5fa;--amber:#fbbf24;--ok:#4ade80;--warn:#fbbf24;--warn-soft:#2a1f0a;--edge:#74747f;--edge-soft:#3a3a42;--binding:#2dd4bf;--shadow:0 0 0 1px #ffffff0d,0 6px 20px #00000080}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg) radial-gradient(var(--grid) 1px,transparent 1px) 0 0/22px 22px;color:var(--ink);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:inherit}
button{cursor:pointer;background:none;border:0;border-radius:8px;height:32px;padding:0 10px;white-space:nowrap}
button:hover{background:var(--hover)}
button[aria-pressed=true]{background:var(--active);color:var(--active-ink)}
:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
[hidden]{display:none!important}
#canvas{position:fixed;inset:0;outline:none}
.island{position:fixed;z-index:10;display:flex;align-items:center;gap:2px;padding:4px;background:var(--island);border-radius:10px;box-shadow:var(--shadow)}
.sep{width:1px;height:20px;background:var(--line);margin:0 4px}
.icon{width:32px;padding:0;font-size:16px;line-height:1}
#menu{top:12px;left:12px}
#tools{top:12px;left:50%;transform:translateX(-50%)}
#status{top:12px;right:12px}
#zoom{bottom:12px;left:12px}
#zoom-label{min-width:52px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
#view-summary{position:fixed;bottom:22px;left:184px;z-index:5;font-size:11px;color:var(--faint);pointer-events:none}
.search-wrap{position:relative}
#search{width:240px;height:32px;border:0;border-radius:8px;background:var(--hover);padding:0 28px 0 10px;outline:none}
#search:focus{box-shadow:0 0 0 2px var(--accent)}
#search::placeholder{color:var(--faint)}
.search-wrap kbd{position:absolute;right:8px;top:7px;font:11px/16px ui-monospace,monospace;color:var(--faint);border:1px solid var(--line);border-radius:4px;padding:0 4px;pointer-events:none}
#search:focus+kbd{display:none}
#search-results{position:absolute;top:42px;right:-4px;width:360px;max-height:60vh;overflow:auto;padding:4px;background:var(--island);border-radius:10px;box-shadow:var(--shadow)}
#search-results:empty{display:none}
#search-results p{margin:8px 10px}
.search-result{display:grid;grid-template-columns:8px 1fr;column-gap:10px;align-items:center;width:100%;height:auto;padding:7px 10px;text-align:left;white-space:normal}
.search-result small{grid-column:2}
.search-result small,.relation-row small{display:block;font-size:11px;color:var(--muted);overflow-wrap:anywhere}
#coverage-status{display:flex;align-items:center;gap:7px;font-size:12px}
#coverage-status::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ok)}
#coverage-status.warning::before{background:var(--warn)}
.panel{position:fixed;z-index:20;top:60px;max-height:calc(100% - 120px);overflow:auto;background:var(--island);border-radius:12px;box-shadow:var(--shadow);padding:16px}
#filters-panel{left:12px;width:248px}
#details-panel{right:12px;width:340px;padding:20px;max-height:calc(100% - 196px)}
.close{position:absolute;top:10px;right:10px;width:28px;height:28px;padding:0;color:var(--muted);font-size:16px}
h2{font-size:16px;font-weight:600;line-height:1.35;margin:4px 28px 14px 0;overflow-wrap:anywhere}
h3{font-size:11px;font-weight:500;color:var(--muted);margin:20px 0 6px;display:flex;justify-content:space-between}
#filters-panel h3{margin:16px 6px 4px}
#filters-panel h3:first-child{margin-top:0}
p{margin:0 0 10px}
.eyebrow{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);margin:0}
.muted{color:var(--muted);font-size:12px}
.warning{color:var(--warn)}
.callout{background:var(--warn-soft);color:var(--warn);border-radius:8px;padding:8px 10px;font-size:12px}
.filter{display:flex;align-items:center;gap:9px;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12.5px}
.filter:hover{background:var(--hover)}
.filter input{appearance:none;margin:0;width:14px;height:14px;border:1.5px solid var(--faint);border-radius:4px;display:grid;place-content:center;flex-shrink:0;cursor:pointer}
.filter input:checked{background:var(--accent);border-color:var(--accent)}
.filter input:checked::after{content:"";width:6px;height:3px;border:solid var(--island);border-width:0 0 1.5px 1.5px;transform:translateY(-1px) rotate(-45deg)}
.filter small{margin-left:auto;color:var(--faint);font-variant-numeric:tabular-nums}
.filter:has(input:not(:checked)) :is(span,.swatch,.dot){opacity:.4}
.dot{width:8px;height:8px;display:inline-block;border-radius:50%;flex-shrink:0}
.swatch{margin-left:auto;width:18px;border-top:1.5px solid var(--edge)}
.swatch.dashed{border-top-style:dashed}
.swatch.binding{border-top-color:var(--binding)}
.legend{list-style:none;padding:0 6px;margin:0;font-size:12px;color:var(--muted)}
.legend li{display:flex;align-items:center;gap:9px;padding:3px 0}
.legend b{width:14px;height:10px;border-radius:3px;border:1.5px solid var(--faint);flex-shrink:0}
.legend .req{border-color:var(--req)}
.legend .con{border-color:var(--amber)}
.legend .cyc{border:3px double var(--muted)}
.legend-note{font-size:11px;color:var(--faint);margin:12px 6px 0}
.minimap-wrap{position:fixed;bottom:12px;right:12px;z-index:10;padding:4px;background:var(--island);border-radius:10px;box-shadow:var(--shadow)}
#minimap{display:block;width:168px;height:101px;touch-action:none;cursor:crosshair}
#mini-viewport{fill:var(--accent);fill-opacity:.06;stroke:var(--accent);stroke-width:1}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}
.stats div{background:var(--hover);border-radius:8px;padding:8px 10px}
.stats strong{display:block;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
.stats span{font-size:11px;color:var(--muted)}
details{margin-top:16px;border-top:1px solid var(--line);padding-top:10px}
summary{cursor:pointer;font-size:12px;color:var(--muted)}
details p{font-size:12px;color:var(--muted);margin:8px 0 0}
dl{display:grid;grid-template-columns:96px 1fr;gap:6px 12px;font-size:12px;margin:14px 0 4px}
dt{color:var(--muted)}
dd{margin:0;overflow-wrap:anywhere;font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.primary-button{display:block;width:100%;background:var(--accent);color:var(--bg);font-weight:500}
.primary-button:hover{background:var(--accent);opacity:.9}
.relation-row{position:relative;display:block;width:100%;height:auto;margin:0 0 2px;padding:6px 24px 6px 8px;text-align:left;white-space:normal;overflow-wrap:anywhere}
.relation-row::after{content:"›";position:absolute;right:8px;top:50%;transform:translateY(-50%);color:var(--faint);font-size:16px}
noscript{display:block;position:fixed;inset:auto 12px 12px;padding:12px 16px;border-radius:10px;background:var(--warn-soft);color:var(--warn)}
@media(max-width:900px){#tools{left:56px;right:12px;transform:none;overflow-x:auto}#status,#view-summary,.minimap-wrap{display:none}#search{width:160px}#details-panel{left:12px;width:auto;top:auto;bottom:60px;max-height:50%}}
</style></head><body data-ready="false"><noscript>The offline canvas requires JavaScript. Use JSON or Mermaid output if scripts are disabled.</noscript><div id="canvas" role="img" aria-label="Navigable dependency canvas" tabindex="0"></div><div class="island" id="menu"><button id="filters-toggle" class="icon" aria-label="Filters and legend" aria-pressed="false" aria-controls="filters-panel">☰</button></div><div class="island" id="tools"><button id="overview" aria-pressed="true" title="Collapse artifacts into type groups">Grouped overview</button><button id="expand-all" aria-pressed="false" title="Show every captured artifact">Show all artifacts</button><span class="sep"></span><button id="fit" title="Fit visible nodes (0)">Fit view</button><button id="arrange" title="Rerun the layout">Arrange</button><button id="root" title="Select the starting artifact">Go to root</button><span class="sep"></span><div class="search-wrap"><input id="search" type="search" aria-label="Search artifacts" placeholder="Search artifacts…" autocomplete="off"><kbd>/</kbd><div id="search-results" role="region" aria-label="Search results"></div></div></div><div class="island" id="status"><button id="coverage-status" title="Snapshot summary"></button></div><div class="island" id="zoom"><button id="zoom-out" class="icon" aria-label="Zoom out">−</button><button id="zoom-label" title="Fit view"></button><button id="zoom-in" class="icon" aria-label="Zoom in">+</button></div><div id="view-summary" role="status">Preparing offline canvas…</div><aside class="panel" id="filters-panel" aria-label="Filters and legend" hidden><h3>Artifact types</h3><div id="filters"></div><h3>Relations</h3><label class="filter"><input id="edge-requires" type="checkbox" checked><span>Declared dependencies</span><i class="swatch"></i></label><label class="filter"><input id="edge-contains" type="checkbox" checked><span>Solution membership</span><i class="swatch dashed"></i></label><label class="filter"><input id="edge-uses-connector" type="checkbox" checked><span>Connector bindings</span><i class="swatch dashed binding"></i></label><label class="filter"><input id="edge-binds-to" type="checkbox" checked><span>Connection bindings</span><i class="swatch dashed binding"></i></label><h3>Legend</h3><ul class="legend"><li><b class="req"></b>Requirement</li><li><b class="con"></b>Consumer</li><li><b class="cyc"></b>Observed cycle</li></ul><p class="legend-note">Arrows point from consumer to requirement. Expanding uses captured data only: no credentials or live queries.</p></aside><aside class="panel" id="details-panel" aria-label="Artifact details" hidden><button id="details-close" class="close" aria-label="Close details">×</button><div id="inspector"></div></aside><div class="minimap-wrap" title="Minimap · click or drag to navigate"><svg id="minimap" viewBox="0 0 200 120" aria-label="Graph minimap"></svg></div><script type="application/json" id="graph-data">${data}</script><script>${viewerScript}</script></body></html>\n`;
}
