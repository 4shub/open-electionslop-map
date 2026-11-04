# RDH imports
Choose an election on [RDH](https://redistrictingdatahub.org/data/download-data/)
and look for a GeoJSON; the
[California 2024 file](https://redistrictingdatahub.org/dataset/california-2024-general-election-precinct-level-results-and-boundaries/)
is a GeoJSON ZIP with vote counts in feature properties.

RDH's download link may require a free account. Download through your account,
then use the saved file. Direct URLs work when they return file bytes without
an interactive login (including an authorized file URL). Dataset pages and login
pages are not files. The importer does not log in or request account credentials.
RDH's bulk API requires [designated API access](https://github.com/nonpartisan-redistricting-datahub/api).

Shapefile-only ZIPs are not supported: export them to WGS84 GeoJSON first.
Standard stored/deflated ZIPs up to 512 MB are supported; extract ZIP64 or other
archive types before importing. Use `--entry path/file.geojson` if a ZIP contains
multiple JSON files.

## Inspect

```sh
npm run import:rdh -- --input ~/Downloads/ca_2024_gen_prec.zip --inspect
```

Reports the feature count and first feature's properties. Check ID, county, and
vote fields against the dataset's metadata; do not guess candidate names from
abbreviated column codes.

## Map fields and import

The included `imports/rdh-ca-2024-sacramento.json` selects county FIPS `067`,
uses `UNIQUE_ID`, and maps US Senate and Proposition 2 columns documented in
[RDH's California 2024 metadata](https://redistrictingdatahub.org/wp-content/uploads/2025/12/readme_ca_2024_gen_prec.txt).
It is a mapping example, not a bundled RDH download.

```sh
npm run import:rdh -- --input ~/Downloads/ca_2024_gen_prec.zip --mapping imports/rdh-ca-2024-sacramento.json --output public/data/sacramento-2024
npm run validate -- public/data/sacramento-2024/map-config.json
npm run dev
```

Preview http://127.0.0.1:8000/?config=./data/sacramento-2024/map-config.json.
To make it the default, copy the generated config to `public/map-config.json`
and update its paths to `./data/sacramento-2024/results.json` and
`./data/sacramento-2024/precincts.geojson`.

Use `--input 'https://…/file.zip'` for a direct download. Keep signed URLs out of
tracked mapping files; the importer does not save the input URL in output data.
Existing output directories are rejected.

## Mapping fields

| Field | Meaning |
| --- | --- |
| `title`, `countyName`, `election`, `sources`, `note` | Output metadata; same as map config. |
| `filter` | Exact property matches, e.g. `{ "COUNTYFP": "067" }`. Omit for all features. |
| `precinctIdProperty` | Unique ID property; `null` uses feature `id`. |
| `precinctIdPadding` | Optional numeric ID width, 0–32. |
| `missingValues` | Optional source-documented missing-count codes, e.g. `[-999]`. |
| `contests` | Array of `{ id, name, type?, shortName?, filter?, choices }`. |
| `choices` | Array of `{ field, name, party?, color? }`; `field` is the source vote column. |

Contest filters restrict district races to their participating precincts.
Candidate names, parties, and contest scope must come from the source metadata.
Countywide totals sum disclosed precinct counts. Blank/null/withheld counts stay
unavailable; zero stays zero. Duplicate IDs, missing vote fields, invalid counts,
and invalid geometry fail validation. Precinct splits or unmatched geographies
must be reconciled before importing. Output geometry retains only its precinct
ID property; statewide vote columns are not duplicated into the boundary file.

Tests cover synthetic records matching the documented California column names,
local/direct inputs, ZIP decoding, filtering, missing values, and output safety.
The gated California archive has not been used as an end-to-end test fixture.
