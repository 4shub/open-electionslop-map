import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSite } from '../scripts/build.mjs';
import { validateConfig } from '../scripts/validate-data.mjs';
import { pathToFileURL } from 'node:url';

test('external CSV datasets are packaged as JSON with self-contained paths', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'election-external-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = path.join(directory, 'map');
    await buildSite({ outputDirectory: output, configUrl: new URL('../public/examples/map-config.json', import.meta.url) });
    const dataset = await validateConfig(pathToFileURL(path.join(output, 'map-config.json')));
    assert.equal(dataset.geojson.features.length, 2);
    assert.equal(dataset.results.contests[0].choices[0].votes, 190);
    await assert.rejects(readFile(path.join(output, 'data/sacramento-2026-results.json')), { code: 'ENOENT' });
});

test('default builds are unbranded; host branding is injected only into that build', async t => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'election-branding-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const original = await readFile(new URL('../public/map-config.json', import.meta.url), 'utf8');
    const unbranded = await buildSite({ outputDirectory: path.join(temporary, 'plain') });
    const branded = await buildSite({ outputDirectory: path.join(temporary, 'host'), siteLink: { label: '[Example]', href: 'https://example.org/' } });
    const readConfig = directory => readFile(path.join(directory, 'map-config.json'), 'utf8').then(JSON.parse);
    assert.equal((await readConfig(unbranded.outputDirectory)).siteLink, undefined);
    assert.deepEqual((await readConfig(branded.outputDirectory)).siteLink, { label: '[Example]', href: 'https://example.org/' });
    assert.equal(await readFile(new URL('../public/map-config.json', import.meta.url), 'utf8'), original);
    const html = await readFile(path.join(unbranded.outputDirectory, 'index.html'), 'utf8');
    assert.ok(!html.includes('shub.club'));
    assert.match(html, /data-site-link[^>]*hidden/);
    await assert.rejects(buildSite({ outputDirectory: branded.outputDirectory, siteLink: { label: 'Bad', href: 'javascript:alert(1)' } }), /HTTP\(S\)/);
    assert.deepEqual((await readConfig(branded.outputDirectory)).siteLink, { label: '[Example]', href: 'https://example.org/' });
});

test('build outputs cannot replace repository sources or their ancestors', async () => {
    for (const directory of [new URL('../', import.meta.url), new URL('../public/', import.meta.url), new URL('../public/output/', import.meta.url), new URL('file:///')]) {
        await assert.rejects(buildSite({ outputDirectory: fileURLToPath(directory) }), /separate from the source/);
    }
});
