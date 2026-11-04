<img width="1658" height="1010" alt="cover2-1658w" src="https://github.com/user-attachments/assets/208445f0-615a-459b-8334-8a3bc0b699d4" />

# Open ElectionSlop Map

> **Using AI? Tell your agent to read [agents_read_here_first.md](agents_read_here_first.md) for them to guide you through this.**

Open ElectonSlop Map is a template for you to build your own interactive personal election results maps. I use it myself on my personal site [shub.club](https://shub.club/sacramento-2026-election/) for the Sacramento County Races, but you can use it for any race in America (or maybe the world, I haven't tried)

## Demo
[Sacramento 2026 Election](https://shub.club/sacramento-2026-election/) 

## Setup Instructions
First, you need to get a precinct map, the [Redistricting Data Hub](https://redistrictingdatahub.org/data/download-data/) has good sources, though might be missing 2026 exact precinct information. [California](https://statewidedatabase.org/) has their own site, as well as each county sometime will just release their own like [Sacramento](https://data-sacramentocounty.opendata.arcgis.com/maps/255dd4348bd045cea5c7c4ea949a5b4a)'s. Just make sure it conforms with our  [data format guide](DATA_FORMAT.md).

1. Put your precinct GeoJSON and results CSV/JSON in `public/data/`.
2. Set their paths, the map title, and the precinct ID property in `public/map-config.json`.
3. Run `npm run validate`, then serve `public/`.

RDH GeoJSON/ZIP files can be converted with the optional [RDH importer](RDH_IMPORT.md), using a local download or direct file URL.


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

Build a separate dataset with `npm run build -- --config path/to/map-config.json`.
Its data files are packaged into `dist/data/`.

The Node build validates the default dataset, then copies `public/` to `dist/`.
It stops before replacing an existing build if validation fails. The build versions asset and data URLs together to prevent stale cached files from mixing across deployments.
Publish `dist/` with any static host. Both servers bind to `127.0.0.1`; `npm start` also accepts
`-- --port 8001`. All asset and data URLs are relative, so the map works at a
site's root or inside a subdirectory. You can also serve `public/` directly.


## Site link

The map has no site branding by default. Set `siteLink` in the map config, or inject it only into a build:

```sh
MAP_SITE_LABEL="[My site]" MAP_SITE_URL="https://example.org/" npm run build
```

This writes branding to `dist/map-config.json`; source data and config stay unchanged.

## Sources

- [Sacramento County official results](https://results.saccounty.gov/results/public/sacramento-county-ca/69)
- [Sacramento County consolidated precinct boundaries](https://data-sacramentocounty.opendata.arcgis.com/maps/255dd4348bd045cea5c7c4ea949a5b4a)

This is an independent visualization, not an official county publication. Data
files come from those sources and are provided with their source URLs and
snapshot metadata; the MIT code license does not relicense third-party data.

## License

Code is [MIT licensed](LICENSE), copyright 2026 Shubham Naik. The bundled Rethink
Sans font is distributed under its [SIL Open Font License](public/fonts/OFL.txt).
