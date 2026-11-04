import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { boundaryId, parseCsv, parseResults, prepareDataset, resultsFromCsv } from '../public/dataset.js';

const read = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
const config = JSON.parse(await read('examples/map-config.json'));
const csv = await read('examples/results.csv');
const boundaries = JSON.parse(await read('examples/precincts.geojson'));
const results = resultsFromCsv(csv, config);
const clone = value => structuredClone(value);

test('another county works with CSV, alphanumeric IDs, a custom property, and local contests', () => {
    const dataset = prepareDataset(config, parseResults(csv, config), boundaries);
    assert.equal(dataset.geojson.features.length, 2);
    assert.equal(boundaryId(boundaries.features[0], dataset.config), 'north');
    assert.equal(dataset.results.contests[0].choices[0].name, 'Rivera, Alex');
    assert.equal(dataset.results.contests[0].choices[0].votes, 190);
    assert.deepEqual(dataset.results.contests[0].precincts.south, [70, 130]);
    assert.equal(dataset.results.contests[1].type, 'BallotMeasure');
    assert.equal(dataset.results.election.lastUpdated, config.election.lastUpdated);
    assert.deepEqual(dataset.results.sources, {});
});

test('the same interface loads the existing Sacramento snapshot', async () => {
    const sacConfig = JSON.parse(await read('map-config.json'));
    const dataset = prepareDataset(sacConfig,
        parseResults(await read(sacConfig.results), sacConfig),
        JSON.parse(await read(sacConfig.boundaries)));
    assert.equal(dataset.geojson.features.length, 719);
    assert.equal(boundaryId(dataset.geojson.features[0], dataset.config), '0011267');
    assert.equal(dataset.results.contests[0].choices[0].votes, 97424);
});

test('CSV supports BOM, CRLF, quoted commas, escaped quotes, and multiline names', () => {
    const text = '\uFEFFprecinct,contest,candidate,votes\r\nnorth,Mayor,"Alex, \"\"A\"\"\nRivera",0\r\n';
    assert.equal(parseCsv(text)[0].candidate, 'Alex, "A"\nRivera');
    assert.throws(() => parseCsv('precinct,contest,candidate,votes\nx,Mayor,"Alex,1'), /Unclosed quote/);
    assert.throws(() => parseCsv('precinct,contest,candidate,votes\nx,Mayor,Alex'), /number of columns/);
});

test('missing and withheld counts remain null, while zero remains zero', () => {
    const data = resultsFromCsv('precinct,contest,candidate,votes\nnorth,Mayor,A,0\nnorth,Mayor,B,withheld\nsouth,Mayor,A,\n');
    assert.deepEqual(data.contests[0].precincts.north, [0, null]);
    assert.deepEqual(data.contests[0].precincts.south, [null, null]);
    assert.deepEqual(data.contests[0].choices.map(choice => choice.votes), [0, null]);
});

test('IDs can use feature.id and configurable numeric zero padding', () => {
    const geo = clone(boundaries);
    geo.features.forEach((feature, index) => { feature.id = index + 1; });
    const data = resultsFromCsv('precinct,contest,candidate,votes\n001,Mayor,A,3\n002,Mayor,A,4\n');
    const prepared = prepareDataset({ ...config, precinctIdProperty: null, precinctIdPadding: 3 }, data, geo);
    assert.equal(boundaryId(geo.features[0], prepared.config), '001');
});

test('bad joins, duplicate boundaries, and malformed geometry fail before rendering', () => {
    const bad = clone(results);
    bad.contests[0].precincts.unknown = [1, 2];
    assert.throws(() => prepareDataset(config, bad, boundaries), /no boundary/);
    assert.throws(() => prepareDataset({ ...config, precinctIdProperty: 'wrong' }, results, boundaries), /precinct ID is missing/);
    const duplicate = clone(boundaries);
    duplicate.features[1].properties.code = 'north';
    assert.throws(() => prepareDataset(config, results, duplicate), /Duplicate boundary/);
    const projected = clone(boundaries);
    projected.features[0].geometry.coordinates[0][0] = [600000, 4400000];
    assert.throws(() => prepareDataset(config, results, projected), /WGS84/);
    const unsupported = clone(boundaries);
    unsupported.features[0].geometry.type = 'Point';
    assert.throws(() => prepareDataset(config, results, unsupported), /Polygon or MultiPolygon/);
});

test('duplicate CSV rows, negative counts, and invalid vote arrays are rejected', () => {
    assert.throws(() => resultsFromCsv(csv + 'north,Mayor,"Rivera, Alex",120,IND,Candidate,#e3b505\n'), /repeats a precinct/);
    assert.throws(() => resultsFromCsv('precinct,contest,candidate,votes\nnorth,Mayor,A,-1\n'), /nonnegative integer/);
    const bad = clone(results);
    bad.contests[0].precincts.north = [1];
    assert.throws(() => prepareDataset(config, bad, boundaries), /align with choices/);
    const invalid = clone(results);
    invalid.contests[0].choices[0].votes = -1;
    assert.throws(() => prepareDataset(config, invalid, boundaries), /invalid choice/);
});

test('source links must be HTTP URLs and metadata must have a valid update time', () => {
    assert.throws(() => prepareDataset({ ...config, sources: { results: 'javascript:alert(1)' } }, results, boundaries), /HTTP or HTTPS/);
    assert.throws(() => prepareDataset({ ...config, election: { lastUpdated: 'yesterday-ish' } }, results, boundaries), /valid date/);
});

test('jurisdiction layers replace a parent with its districts and reject hidden vote areas', async () => {
    const { visibleBoundaries, boundaryLabel } = await import('../public/dataset.js');
    const geo = clone(boundaries);
    geo.features = [
        { ...clone(geo.features[0]), properties: { code: 'city-a', unit: 'City', parent: 'a', name: 'City A' } },
        { ...clone(geo.features[1]), properties: { code: 'city-b', unit: 'City', parent: 'b', name: 'City B' } },
        { ...clone(geo.features[0]), properties: { code: 'district-a', unit: 'District', parent: 'a', name: 'City A District 1' } },
        { ...clone(geo.features[1]), properties: { code: 'district-b', unit: 'District', parent: 'b', name: 'City B District 1' } },
    ];
    const settings = { ...config, geography: { typeProperty: 'unit', parentProperty: 'parent', nameProperty: 'name', baseType: 'City' } };
    const contest = { id: 'council', name: 'Council', geographyType: 'District', geographyParent: 'a', choices: [{ name: 'Alex', votes: 8 }], precincts: { 'district-a': [8] } };
    assert.deepEqual(visibleBoundaries(geo, settings).map(f => f.properties.code), ['city-a', 'city-b']);
    assert.deepEqual(visibleBoundaries(geo, settings, contest).map(f => f.properties.code), ['city-b', 'district-a']);
    const wholeLayer = { ...contest, geographyParent: undefined };
    assert.deepEqual(visibleBoundaries(geo, settings, wholeLayer).map(f => f.properties.code), ['district-a', 'district-b']);
    assert.equal(prepareDataset(settings, { contests: [wholeLayer] }, geo).results.contests.length, 1);
    assert.equal(boundaryLabel(geo.features[2], settings), 'City A District 1');
    assert.equal(prepareDataset(settings, { contests: [contest] }, geo).results.contests[0].choices[0].votes, 8);
    assert.throws(() => prepareDataset(settings, { contests: [{ ...contest, precincts: { 'city-a': [8] } }] }, geo), /geography layer/);
    assert.deepEqual(visibleBoundaries(geo, config), geo.features);
});
