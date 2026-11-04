import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { precinctId, prepareDataset } from '../public/dataset.js';

const MAX_BYTES = 512 * 1024 * 1024;
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

// Read standard ZIP entries in memory; never extract paths onto the filesystem.
export function readZipGeojson(buffer, requestedEntry) {
    let end = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
    }
    requireValue(end >= 0, 'Invalid ZIP. Download the complete archive or supply an extracted GeoJSON file.');
    requireValue(buffer.readUInt16LE(end + 4) === 0 && buffer.readUInt16LE(end + 6) === 0, 'Multi-disk ZIP is unsupported; extract the GeoJSON first.');
    const count = buffer.readUInt16LE(end + 10);
    let offset = buffer.readUInt32LE(end + 16);
    requireValue(count !== 65535 && offset !== 0xffffffff, 'ZIP64 is unsupported; extract the GeoJSON first.');
    const entries = [];
    for (let i = 0; i < count; i++) {
        requireValue(offset + 46 <= end && buffer.readUInt32LE(offset) === 0x02014b50, 'Invalid ZIP directory.');
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const size = buffer.readUInt32LE(offset + 24);
        const length = buffer.readUInt16LE(offset + 28);
        const extra = buffer.readUInt16LE(offset + 30);
        const comment = buffer.readUInt16LE(offset + 32);
        const local = buffer.readUInt32LE(offset + 42);
        requireValue(offset + 46 + length + extra + comment <= end, 'Truncated ZIP directory.');
        const name = buffer.toString('utf8', offset + 46, offset + 46 + length);
        if (!name.startsWith('__MACOSX/') && /\.(geojson|json)$/i.test(name)) entries.push({ name, flags, method, compressedSize, size, local });
        offset += 46 + length + extra + comment;
    }
    const selected = requestedEntry ? entries.filter(entry => entry.name === requestedEntry) : entries;
    requireValue(selected.length, 'No matching GeoJSON entry in ZIP. Shapefile-only ZIPs must first be exported to WGS84 GeoJSON.');
    requireValue(selected.length === 1, `Multiple JSON files in ZIP; choose one with --entry: ${selected.map(entry => entry.name).join(', ')}`);
    const entry = selected[0];
    requireValue(!(entry.flags & 1) && [0, 8].includes(entry.method), 'Encrypted ZIP or unsupported compression; extract the GeoJSON first.');
    requireValue(entry.size <= MAX_BYTES && entry.local + 30 <= buffer.length, 'ZIP entry is too large or invalid.');
    requireValue(buffer.readUInt32LE(entry.local) === 0x04034b50, 'Invalid ZIP entry header.');
    const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28);
    requireValue(start + entry.compressedSize <= buffer.length, 'Truncated ZIP entry.');
    const compressed = buffer.subarray(start, start + entry.compressedSize);
    const data = entry.method === 8 ? inflateRawSync(compressed, { maxOutputLength: MAX_BYTES }) : compressed;
    requireValue(data.length === entry.size, 'ZIP entry size does not match its contents.');
    return JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''));
}

export async function readRdhInput(input, { entry, fetchImpl = fetch } = {}) {
    let buffer;
    if (/^https?:\/\//i.test(input)) {
        const response = await fetchImpl(input, { signal: AbortSignal.timeout(120000) });
        requireValue(response.ok, `Download failed (HTTP ${response.status}). Use a saved RDH download or an authorized direct file URL.`);
        requireValue(!response.headers.get('content-type')?.includes('text/html'), 'The URL returned a web/login page. Sign in to RDH and download the file, then use its local path.');
        requireValue(Number(response.headers.get('content-length') || 0) <= MAX_BYTES, 'Download exceeds 512 MB; supply a county-level file.');
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            requireValue(size <= MAX_BYTES, 'Download exceeds 512 MB; supply a county-level file.');
            chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
    } else buffer = await readFile(input);
    requireValue(buffer.length <= MAX_BYTES, 'Input exceeds 512 MB; supply a county-level file.');
    requireValue(buffer.length >= 2, 'Input is empty or truncated.');
    const start = buffer.subarray(0, 200).toString('utf8').trimStart();
    requireValue(!/^<(?:!doctype|html)/i.test(start), 'Input is an HTML page, not a dataset. Supply the downloaded ZIP or GeoJSON.');
    return buffer.readUInt16LE(0) === 0x4b50 ? readZipGeojson(buffer, entry) : JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
}

function matches(properties, filter = {}) {
    return Object.entries(filter).every(([field, value]) => String(properties[field]) === String(value));
}

export function convertRdh(geojson, mapping) {
    requireValue(geojson.type === 'FeatureCollection' && Array.isArray(geojson.features), 'Input must be a GeoJSON FeatureCollection.');
    requireValue(mapping.precinctIdProperty === null || typeof mapping.precinctIdProperty === 'string', 'Mapping needs precinctIdProperty, or null for feature.id.');
    requireValue(mapping.precinctIdPadding === undefined || (Number.isInteger(mapping.precinctIdPadding) && mapping.precinctIdPadding >= 0 && mapping.precinctIdPadding <= 32), 'precinctIdPadding must be between 0 and 32.');
    requireValue(Array.isArray(mapping.contests) && mapping.contests.length, 'Mapping needs at least one contest and its vote columns.');
    for (const field of Object.keys(mapping.filter || {})) {
        requireValue(geojson.features.some(feature => Object.hasOwn(feature.properties || {}, field)), `County filter field "${field}" is missing.`);
    }
    const features = geojson.features.filter(feature => matches(feature.properties || {}, mapping.filter));
    requireValue(features.length, 'County filter matched no features. Check field names, values, and leading zeros.');
    const idOf = feature => precinctId(mapping.precinctIdProperty === null ? feature.id : feature.properties?.[mapping.precinctIdProperty], mapping.precinctIdPadding);
    const ids = features.map(idOf);
    requireValue(new Set(ids).size === ids.length, 'Precinct IDs are not unique. Use a unique reporting-unit ID or reconcile split precincts before importing.');
    const missingValues = new Set(['', 'null', 'withheld', 'na', 'n/a', ...(mapping.missingValues || []).map(value => String(value).toLowerCase())]);
    const count = (value, field, id) => {
        if (value === null || value === undefined || missingValues.has(String(value).trim().toLowerCase())) return null;
        requireValue(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim())), `Invalid count in ${field}, precinct ${id}. Declare source-documented missingValues for suppression codes.`);
        const number = Number(value);
        requireValue(Number.isSafeInteger(number) && number >= 0, `Invalid count in ${field}, precinct ${id}.`);
        return number;
    };
    const contests = mapping.contests.map(contest => {
        requireValue(contest.id && contest.name && Array.isArray(contest.choices) && contest.choices.length, 'Each contest needs id, name, and choices.');
        const choices = contest.choices.map(choice => {
            requireValue(typeof choice.field === 'string' && choice.field && choice.name, `Contest ${contest.id} needs a field and name for every choice.`);
            return { id: choice.field, name: choice.name, party: choice.party || '', color: choice.color || null, votes: null };
        });
        const participating = features.filter(feature => matches(feature.properties || {}, contest.filter));
        requireValue(participating.length, `Contest ${contest.id} filter matched no precincts.`);
        const precincts = Object.fromEntries(participating.map(feature => {
            const id = idOf(feature);
            return [id, contest.choices.map((choice, index) => {
                requireValue(Object.hasOwn(feature.properties || {}, choice.field), `Vote column "${choice.field}" is missing from precinct ${id}. Check the dataset metadata.`);
                const votes = count(feature.properties[choice.field], choice.field, id);
                if (votes !== null) choices[index].votes = (choices[index].votes ?? 0) + votes;
                return votes;
            })];
        }));
        return { id: contest.id, name: contest.name, shortName: contest.shortName || contest.name, type: contest.type || 'Candidate', choices, precincts };
    });
    const boundaries = {
        type: 'FeatureCollection',
        features: features.map((feature, index) => ({ type: 'Feature', properties: { precinct: ids[index] }, geometry: feature.geometry })),
    };
    const config = {
        title: mapping.title,
        countyName: mapping.countyName,
        results: './results.json', boundaries: './precincts.geojson', precinctIdProperty: 'precinct',
        election: mapping.election || {}, sources: mapping.sources || {},
        note: mapping.note || '',
    };
    const results = { election: config.election, sources: config.sources, precincts: ids, contests };
    prepareDataset(config, results, boundaries);
    return { config, results, boundaries };
}
