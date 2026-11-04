> **Using AI? Tell your agent to read [agents_read_here_first.md](agents_read_here_first.md) for them to guide you through this.**

# open-electionslop-map

A configurable precinct election map. Supply a county's GeoJSON boundaries and
CSV or JSON results; keep the same UI. Built with HTML, CSS, JavaScript, and SVG;
no framework, API keys, or npm dependencies. Node.js 22 or newer runs the
preview server, validator, optional static build, and data scripts.

Sacramento County's November 3, 2026 general election is the bundled default
example, embedded on [shub.club](https://shub.club/sacramento-2026-election/).

## Use another county

1. Put your precinct GeoJSON and results CSV/JSON in `public/data/`.
2. Set their paths, the map title, and the precinct ID property in `public/map-config.json`.
3. Run `npm run validate`, then serve `public/`.

No HTML, CSS, or renderer changes are needed. The [data format guide](DATA_FORMAT.md)
includes the CSV columns, JSON shape, ID matching rules, and a complete fictional
example in `public/examples/`. A county's raw export may need a small adapter to
match this format; the Sacramento downloader is one such adapter. There is no
upload or drag-and-drop interface.

## Run locally

Clone this repository and serve its `public` directory:

```sh
git clone https://github.com/4shub/open-electionslop-map.git
cd open-electionslop-map
npm run dev
```

Open http://127.0.0.1:8000/. No Python or `npm install` is needed. To choose
another port, run `npm run dev -- --port 8001`. Opening the HTML directly as a
`file://` URL will not work because the map fetches its data files.

## Build and preview production files

```sh
npm run build
npm start
```

The Node build validates the default dataset, then copies `public/` to `dist/`.
It stops before replacing an existing build if validation fails. Publish `dist/`
with any static host. Both servers bind to `127.0.0.1`; `npm start` also accepts
`-- --port 8001`. All asset and data URLs are relative, so the map works at a
site's root or inside a subdirectory. You can also serve `public/` directly.

## Refresh the Sacramento example

A checked-in snapshot lets the map run without calling county services from the
browser. It is **not a live feed**. The displayed update time comes from that
snapshot. Results may change during the canvass; use the official sources for
the latest information.

With Node.js 22 or newer:

```sh
npm run data:refresh
npm test
```

No `npm install` is needed. The downloader fetches statewide offices and
propositions, verifies that all 719 result precincts match the official boundary
layer, and writes both files into `public/data/`. Review and commit those files
to publish a new snapshot. Do not infer missing or withheld vote totals; the map
preserves them as unavailable.

## Sources

- [Sacramento County official results](https://results.saccounty.gov/results/public/sacramento-county-ca/69)
- [Sacramento County consolidated precinct boundaries](https://data-sacramentocounty.opendata.arcgis.com/maps/255dd4348bd045cea5c7c4ea949a5b4a)

This is an independent visualization, not an official county publication. Data
files come from those sources and are provided with their source URLs and
snapshot metadata; the MIT code license does not relicense third-party data.

## Files

- `public/index.html`: page structure and accessibility labels.
- `public/map.css`: responsive layout and themes.
- `public/map.js`: county-independent rendering, contest selection, and map interactions.
- `public/dataset.js`: shared CSV parsing, validation, and precinct joins.
- `public/map-config.json`: the default county configuration.
- `public/examples/`: a second county configuration with fictional CSV and GeoJSON.
- `DATA_FORMAT.md`: the developer data contract and adaptation guide.
- `agents_read_here_first.md`: how an agent should gather requirements and adapt a county.
- `scripts/serve.mjs`: dependency-free Node static server.
- `scripts/build.mjs`: validates and packages the static site into `dist/`.
- `scripts/validate-data.mjs`: validates any local county configuration.
- `public/data/`: results and precinct geometry snapshots.
- `scripts/download-sacramento-election.mjs`: refreshes the snapshots.
- `test/`: Sacramento regression checks, another county, and invalid-data cases.

The map follows the system color scheme. When embedded on the same origin, it
also follows shub.club's theme cookie and parent page theme.

## Working with shub.club

The parent repository includes this project as a Git submodule at
`sites/shub.club/vendor/electionslopmap`. Eleventy copies only its `public/`
directory to `/sacramento-2026-election/`.

After cloning the parent repository:

```sh
git submodule update --init --recursive
```

To bring a published change into the parent repository:

```sh
git -C sites/shub.club/vendor/electionslopmap pull --ff-only origin main
git add sites/shub.club/vendor/electionslopmap
git commit -m "Update electionslopmap"
```

Make map changes in this repository, commit and push them here, then commit the
updated submodule pointer in the parent. The parent intentionally pins a commit
so its builds stay reproducible.

## License

Code is [MIT licensed](LICENSE), copyright 2026 Shubham Naik. The bundled Rethink
Sans font is distributed under its [SIL Open Font License](public/fonts/OFL.txt).
