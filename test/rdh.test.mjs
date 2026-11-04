import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';
import { convertRdh, readRdhInput, readZipGeojson } from '../scripts/rdh-data.mjs';
import { writeRdhDataset } from '../scripts/import-rdh.mjs';
import { prepareDataset } from '../public/dataset.js';

const mapping = JSON.parse(await readFile(new URL('../imports/rdh-ca-2024-sacramento.json', import.meta.url), 'utf8'));
const geometry = { type: 'Polygon', coordinates: [[[-121.5, 38.5], [-121.4, 38.5], [-121.4, 38.6], [-121.5, 38.6], [-121.5, 38.5]]] };
// Synthetic records using the field names in RDH's California 2024 metadata.
const input = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', geometry, properties: { UNIQUE_ID: '067-001', COUNTYFP: '067', G24USSDSCH: 120, G24USSRGAR: 80, G24PRO02YES: 110, G24PRO02NO: 90 } },
        { type: 'Feature', geometry, properties: { UNIQUE_ID: '067-002', COUNTYFP: '067', G24USSDSCH: 70, G24USSRGAR: 130, G24PRO02YES: null, G24PRO02NO: 0 } },
        { type: 'Feature', geometry, properties: { UNIQUE_ID: '003-001', COUNTYFP: '003', G24USSDSCH: 1, G24USSRGAR: 2, G24PRO02YES: 1, G24PRO02NO: 2 } },
    ],
};
function zip(entries, method = 8) {
    const locals = [], central = [];
    let offset = 0;
    for (const [name, text] of entries) {
        const filename = Buffer.from(name), data = Buffer.from(text);
        const compressed = method === 8 ? deflateRawSync(data) : data;
        let crc = 0xffffffff;
        for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
        crc = (crc ^ 0xffffffff) >>> 0;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
        locals.push(local, filename, compressed);
        const directory = Buffer.alloc(46);
        directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(method, 10);
        directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
        central.push(directory, filename);
        offset += local.length + filename.length + compressed.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

test('RDH mapping filters the county, translates vote columns, and preserves null versus zero', () => {
    const dataset = convertRdh(input, mapping);
    assert.equal(dataset.boundaries.features.length, 2);
    assert.deepEqual(dataset.results.contests[0].choices.map(choice => choice.votes), [190, 210]);
    assert.deepEqual(dataset.results.contests[1].precincts['067-002'], [null, 0]);
    assert.deepEqual(dataset.boundaries.features[0].properties, { precinct: '067-001' });
    assert.equal(dataset.config.sources.results, mapping.sources.results);
    assert.equal(dataset.config.election.lastUpdated, undefined);
    prepareDataset(dataset.config, dataset.results, dataset.boundaries);
});

test('RDH mapping rejects wrong fields, empty filters, duplicate IDs, and invalid counts', () => {
    assert.throws(() => convertRdh(input, { ...mapping, filter: { typo: '067' } }), /filter field/);
    assert.throws(() => convertRdh(input, { ...mapping, filter: { COUNTYFP: '999' } }), /no features/);
    const missing = structuredClone(input); delete missing.features[0].properties.G24USSDSCH;
    assert.throws(() => convertRdh(missing, mapping), /Vote column/);
    const duplicates = structuredClone(input); duplicates.features[1].properties.UNIQUE_ID = '067-001';
    assert.throws(() => convertRdh(duplicates, mapping), /not unique/);
    const negative = structuredClone(input); negative.features[0].properties.G24USSDSCH = -999;
    assert.throws(() => convertRdh(negative, mapping), /Invalid count/);
    assert.equal(convertRdh(negative, { ...mapping, missingValues: [-999] }).results.contests[0].precincts['067-001'][0], null);
});

test('stored and deflated ZIP GeoJSON files convert without extracting paths', () => {
    for (const method of [0, 8]) assert.deepEqual(readZipGeojson(zip([['county/precincts.geojson', JSON.stringify(input)]], method)), input);
    const multiple = zip([['a.geojson', JSON.stringify(input)], ['b.geojson', JSON.stringify(input)]]);
    assert.throws(() => readZipGeojson(multiple), /--entry/);
    assert.deepEqual(readZipGeojson(multiple, 'b.geojson'), input);
    assert.throws(() => readZipGeojson(zip([['precincts.shp', 'shapefile']])), /Shapefile-only/);
    assert.throws(() => readZipGeojson(Buffer.from('not a zip')), /Invalid ZIP/);
});

test('a direct file URL is supported, while login pages and failed downloads are reported', async () => {
    const bytes = zip([['precincts.geojson', JSON.stringify(input)]]);
    const geojson = await readRdhInput('https://example.org/file.zip', { fetchImpl: async () => new Response(bytes) });
    assert.deepEqual(geojson, input);
    await assert.rejects(readRdhInput('https://example.org/file', { fetchImpl: async () => new Response('<html>Log in</html>', { headers: { 'content-type': 'text/html' } }) }), /login page/);
    await assert.rejects(readRdhInput('https://example.org/file', { fetchImpl: async () => new Response('Denied', { status: 403 }) }), /HTTP 403/);
});

test('local imports write a validated dataset without overwriting an existing directory', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'rdh-map-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const local = path.join(directory, 'source.zip');
    await writeFile(local, zip([['precincts.geojson', JSON.stringify(input)]]));
    const dataset = convertRdh(await readRdhInput(local), mapping);
    const output = path.join(directory, 'output');
    await writeRdhDataset(output, dataset);
    const config = JSON.parse(await readFile(path.join(output, 'map-config.json'), 'utf8'));
    const results = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
    const boundaries = JSON.parse(await readFile(path.join(output, 'precincts.geojson'), 'utf8'));
    prepareDataset(config, results, boundaries);
    await assert.rejects(writeRdhDataset(output, dataset), /already exists/);
    assert.equal(results.contests[0].choices[0].votes, 190);
});
