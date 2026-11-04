# Bring another county's data

The UI stays the same. To change the county, supply a config file, precinct
boundaries, and results. No changes to `index.html`, CSS, or rendering code are
needed. See the complete fictional example in `public/examples/`.

## 1. Configure the map

Edit `public/map-config.json`:

```json
{
  "title": "Your County - Election Map",
  "countyName": "Your County",
  "results": "./data/results.csv",
  "boundaries": "./data/precincts.geojson",
  "precinctIdProperty": "PRECINCT",
  "precinctIdPadding": 0,
  "election": { "lastUpdated": "2026-11-04T12:00:00Z" },
  "sources": {
    "results": "https://your-county.gov/election-results",
    "boundaries": "https://your-county.gov/precinct-boundaries"
  },
  "note": "Describe the election, snapshot date, and any limitations."
}
```

Use your actual source URLs; omit `sources` when you do not have them. These
populate the existing official-source links. Optional `note` supplies the second
paragraph of the existing About section. Paths are **relative to the config
file**, not the HTML page, so you can keep each county in its own directory.

`election.lastUpdated` is optional; the map shows that no snapshot date was
provided if it is absent. Do not use an invented timestamp.

Optional settings:

- `description`: accessible description of the map.
- `boundariesLabel`: label after the precinct count; defaults to "precinct boundaries".
- `contestGroups`: `{ "offices": "Local offices", "measures": "Ballot measures" }`.
- `resultsFormat`: `"csv"` or `"json"`; otherwise inferred from the results path.

## 2. Add precinct boundaries

Save a WGS84 longitude/latitude GeoJSON `FeatureCollection` containing `Polygon`
or `MultiPolygon` features. Each feature needs a unique precinct ID:

```json
{
  "type": "Feature",
  "properties": { "PRECINCT": "001" },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-100,40],[-99.9,40],[-99.9,40.1],[-100,40.1],[-100,40]]]
  }
}
```

Set `precinctIdProperty` to the property containing that ID. Set it to `null` to
use the GeoJSON feature's top-level `id` instead. No property names are tied to
Sacramento. Numeric IDs become strings; strings retain leading zeros. If the
results use `001` but geometry stores numeric `1`, set `precinctIdPadding` to `3`
to pad numeric IDs on **both** sides. Alphanumeric IDs are preserved.

Each boundary ID must be unique. Every result precinct must have a boundary.
Boundaries without results are allowed and display as unavailable for that
contest. If a county splits or combines precincts between files, reconcile those
geographies in your adapter before importing; the renderer does not guess joins.

## 3. Add results: CSV is the shortest route

Use one row per precinct, contest, and candidate (or ballot choice):

```csv
precinct,contest,candidate,votes,party,type
001,Mayor,Alex Rivera,120,IND,Candidate
001,Mayor,Sam Lee,80,IND,Candidate
002,Mayor,Alex Rivera,70,IND,Candidate
002,Mayor,Sam Lee,130,IND,Candidate
001,Library bond,Yes,110,,BallotMeasure
001,Library bond,No,90,,BallotMeasure
002,Library bond,Yes,60,,BallotMeasure
002,Library bond,No,140,,BallotMeasure
```

Only `precinct,contest,candidate,votes` are required. Optional `party` is a display
abbreviation; optional `type` is `BallotMeasure` for ballot questions and defaults
to `Candidate`. Optional `color` is a hex color used by the existing color palette
when applicable. Use the same candidate metadata and contest type in every row.
UTF-8 BOMs, CRLF, and standard quoted CSV fields are supported.

Counts must be nonnegative whole numbers. Zero means zero. Blank, `null`, or
`withheld` vote values stay unavailable. Missing candidate rows in a precinct
also stay unavailable; they are not filled with zero. Supply explicit zero rows
when the reporting authority actually reported zero.

Countywide CSV totals sum only disclosed rows; withheld votes are not estimated.
Use JSON if you have separate published countywide totals that differ from the
sum of disclosed precinct totals. Do not include countywide total rows in the
CSV. If exports have separate Election Day / mail / early rows, aggregate those
to one precinct/contest/candidate row first. Duplicate rows fail validation.

This is a normalized interface, not a universal parser for every county's raw
export. Transform the county's column names and layout into these columns, or
write a small adapter that emits the JSON below. The Sacramento downloader is
one example of an adapter for a particular reporting vendor.

## Or supply JSON

The existing Sacramento snapshot uses this format. `votes` arrays use the same
order as `choices`; `null` means unavailable. Countywide choice totals are
provided separately, so published totals can include ballots withheld at the
precinct level.

```json
{
  "election": { "lastUpdated": "2026-11-04T12:00:00Z" },
  "contests": [{
    "id": "mayor",
    "name": "Mayor",
    "shortName": "Mayor",
    "type": "Candidate",
    "choices": [
      { "id": "alex", "name": "Alex Rivera", "party": "IND", "votes": 190 },
      { "id": "sam", "name": "Sam Lee", "party": "IND", "votes": 210 }
    ],
    "precincts": { "001": [120, 80], "002": [70, 130] }
  }]
}
```

Contest IDs and choices must be unique. Choice totals and precinct array entries
must be nonnegative integers or `null`. `shortName`, `type`, and `party` are
optional. An optional top-level `precincts` array declares available result IDs;
if supplied it must cover every contest precinct. Optional `sources` uses the
same object as the config. Config election metadata and sources override the
corresponding JSON values.

## 4. Validate, preview, and publish

From this repository:

```sh
npm run validate
npm test
npm run dev
```

Validation uses the same code as the browser and reports missing precincts,
duplicate rows or IDs, malformed geometry, and invalid vote arrays before you
publish. No dependency installation is needed.

To preview another config without replacing the default:

```sh
npm run validate -- public/examples/map-config.json
```

Then visit http://127.0.0.1:8000/?config=./examples/map-config.json. That sample
uses two fictional precincts, a different ID field, a mayoral race, and a ballot
measure. It uses the existing map UI with no data-loading controls.

For a permanent county change, replace the default config and data, then publish
`public/`. Updating data files does not require a build. The checked-in Sacramento
snapshot remains the default example until you change the config.
