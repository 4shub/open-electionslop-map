import assert from 'node:assert/strict';
import test from 'node:test';
import { contestMetadata } from '../public/metadata.js';

test('county snapshots override their source and timestamp without leaking into the next contest', () => {
    const config = { note: 'Preliminary results.' };
    const results = { election: { lastUpdated: '2026-11-04T10:00:00-08:00' }, sources: { results: 'https://regional.example/', boundaries: 'https://boundaries.example/' } };
    const metadata = contestMetadata(config, results, { note: 'County totals only.', lastUpdated: '2026-11-04T02:00:00-08:00', sources: { results: 'https://county.example/' } });
    assert.equal(metadata.note, 'Preliminary results. County totals only.');
    assert.equal(metadata.sources.results, 'https://county.example/');
    assert.equal(metadata.sources.boundaries, results.sources.boundaries);
    assert.equal(metadata.lastUpdated, '2026-11-04T02:00:00-08:00');
    assert.deepEqual(contestMetadata(config, results), { note: config.note, sources: results.sources, lastUpdated: results.election.lastUpdated });
});
