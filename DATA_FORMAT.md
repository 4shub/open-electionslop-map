# Data formats

Three files: config JSON, precinct GeoJSON, and results CSV or JSON.
[Complete example](public/examples/).

## Config: `public/map-config.json`

```json
{
  "title": "Your County - Election Map",
  "results": "./data/results.csv",
  "boundaries": "./data/precincts.geojson",
  "precinctIdProperty": "PRECINCT"
}
```

Paths are relative to the config file.

| Optional field | Value |
| --- | --- |
| `precinctIdProperty` | ID property name; defaults to `"precinct"`. `null` uses feature `id`. |
| `precinctIdPadding` | Numeric ID width, 0–32; defaults to 0. `3` matches `1` with `"001"`. |
| `resultsFormat` | `"csv"` or `"json"`; defaults to the file extension. |
| `election.lastUpdated` | ISO timestamp. |
| `timeZone` | IANA time zone for the update timestamp, e.g. `"America/Los_Angeles"`. Default `"UTC"`. |
| `siteLink` | Optional `{ "label": "[My site]", "href": "https://example.org/" }`; omitted by default. |
| `sources` | `{ "results": "https://…", "boundaries": "https://…" }` |
| `countyName`, `description`, `note`, `boundariesLabel` | Text. |
| `contestGroups` | `{ "offices": "Offices", "measures": "Ballot measures" }` |
| `geography` | Mixed layers: `{ "typeProperty": "unitType", "parentProperty": "city", "nameProperty": "name", "baseType": "City" }`. |
| `defaultZoomOverride` | `{ "bounds": [west, south, east, north] }` in longitude/latitude. Sets the initial and reset view; omitted fits all boundaries. |
| `autoMoveToVotingArea` | `true` fits each selected contest's result boundaries, including zero/withheld counts. Reset restores that contest's view. Falls back to `defaultZoomOverride` when no reporting boundaries exist. Default `false`. |

## Boundaries: GeoJSON

WGS84 longitude/latitude `FeatureCollection` with `Polygon` or `MultiPolygon` features:

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": { "PRECINCT": "001" },
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[-100,40],[-99.9,40],[-99.9,40.1],[-100,40.1],[-100,40]]]
    }
  }]
}
```

IDs must be unique. Every result precinct needs a matching boundary;
boundaries without results are allowed. IDs become strings; leading zeros
are preserved. Numeric IDs are padded when `precinctIdPadding` is set.

## Results: CSV

One row per precinct/contest/candidate:

```csv
precinct,contest,candidate,votes,party,type
001,Mayor,Alex Rivera,120,IND,Candidate
001,Mayor,Sam Lee,80,IND,Candidate
001,Library bond,Yes,110,,BallotMeasure
001,Library bond,No,90,,BallotMeasure
```

- Required columns: `precinct,contest,candidate,votes`.
- Optional: `party`, `type` (`Candidate` by default; `BallotMeasure` for questions), `color` (hex).
- Keep candidate metadata and contest type consistent across rows.
- Votes: nonnegative integers. Blank, `null`, `withheld`, or missing candidate rows mean unavailable; `0` means zero.
- Duplicate rows are rejected. Aggregate voting methods first; exclude countywide total rows.
- Countywide totals sum disclosed votes. Use JSON for separately published totals.
- Standard quoted CSV, UTF-8 BOMs, and CRLF are supported.

## Results: JSON

```json
{
  "contests": [{
    "id": "mayor",
    "name": "Mayor",
    "choices": [
      { "name": "Alex Rivera", "votes": 120 },
      { "name": "Sam Lee", "votes": 80 }
    ],
    "precincts": { "001": [120, 80] }
  }]
}
```

- Contest fields: `id`, `name`, `choices`, `precincts`. IDs and choices must be unique.
- Choice fields: `name`, `votes` (countywide total).
- Precinct vote arrays follow `choices` order. All counts are nonnegative integers or `null`.
- Optional: contest `shortName` and `type`; choice `id`, `party`, and hex `color`.
- Optional contest `group`: selector group; `reportingAreaLabel`: total scope, e.g. `"citywide"`.
- With `geography`: contest `geographyType` selects a layer. Optional `geographyParent` replaces only that parent's base feature; other base features remain visible. Feature names come from `nameProperty`.
- Optional top-level `precincts`: unique ID array covering every contest precinct.
- Optional `election` and `sources`: same format as config; config values take precedence.

Validate with `npm run validate` or `npm run validate -- path/to/map-config.json`.

RDH downloads: [import reference](RDH_IMPORT.md).
