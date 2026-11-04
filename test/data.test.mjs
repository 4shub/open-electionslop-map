import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
const results = JSON.parse(await read('data/sacramento-2026-results.json'));
const boundaries = JSON.parse(await read('data/sacramento-2026-precincts.geojson'));

test('results and geometry identify the same 719 unique precincts', () => {
    const resultIds = new Set(results.precincts);
    const boundaryIds = new Set(boundaries.features.map(feature =>
        String(feature.properties.VPrecinct).padStart(7, '0')));
    assert.equal(resultIds.size, 719);
    assert.equal(results.precincts.length, 719);
    assert.equal(boundaries.features.length, 719);
    assert.deepEqual(resultIds, boundaryIds);
    assert.equal(boundaries.type, 'FeatureCollection');
    assert.ok(boundaries.features.every(feature =>
        ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)));
});

test('each contest has valid choices and aligned precinct vote arrays', () => {
    const precinctIds = new Set(results.precincts);
    assert.ok(results.contests.length > 0);
    assert.equal(new Set(results.contests.map(contest => contest.id)).size, results.contests.length);
    for (const contest of results.contests) {
        assert.ok(contest.name && contest.choices.length);
        assert.equal(new Set(contest.choices.map(choice => choice.id)).size, contest.choices.length);
        for (const [precinct, votes] of Object.entries(contest.precincts)) {
            assert.ok(precinctIds.has(precinct), `Unknown precinct ${precinct}`);
            assert.equal(votes.length, contest.choices.length);
            assert.ok(votes.every(value => value === null ||
                (Number.isInteger(value) && value >= 0)));
        }
    }
    assert.ok(Number.isFinite(Date.parse(results.election.lastUpdated)));
    assert.ok(results.sources.results && results.sources.boundaries);
});

test('the standalone page uses portable asset paths and exposes its source', async () => {
    const html = await read('index.html');
    const js = await read('map.js');
    assert.ok(!html.includes('webc:'));
    assert.ok(!html.startsWith('---'));
    assert.ok(html.includes('https://github.com/4shub/open-electionslop-map'));
    for (const path of ['map.css', 'map.js', 'data/sacramento-2026-results.json',
        'data/sacramento-2026-precincts.geojson']) {
        assert.ok((html + js).includes(`./${path}`));
        assert.ok((await read(path)).length);
    }
    assert.ok(!js.includes('/public/data/'));
});
