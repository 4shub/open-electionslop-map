import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSite } from '../scripts/build.mjs';
import { validateConfig } from '../scripts/validate-data.mjs';
import { pathToFileURL } from 'node:url';

test('optional locality outlines are packaged and versioned without joining precinct result IDs', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'election-localities-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'source');
    await cp(new URL('../public/examples/', import.meta.url), source, { recursive: true });
    const configFile = path.join(source, 'map-config.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    const outlines = JSON.parse(await readFile(path.join(source, config.boundaries), 'utf8'));
    outlines.features.forEach(f => { f.properties = { name: 'Example city' }; });
    config.localityBoundaries = './cities.geojson';
    await writeFile(configFile, JSON.stringify(config));
    await writeFile(path.join(source, 'cities.geojson'), JSON.stringify(outlines));
    const output = path.join(directory, 'map');
    const built = await buildSite({ outputDirectory: output, configUrl: pathToFileURL(configFile) });
    assert.match(built.config.localityBoundaries, /^\.\/data\/localities\.geojson\?v=/);
    const dataset = await validateConfig(pathToFileURL(path.join(output, 'map-config.json')));
    assert.deepEqual(dataset.localityBoundaries, outlines);
    assert.equal(dataset.geojson.features.length, 2);
    outlines.features[0].geometry.coordinates = [];
    await writeFile(path.join(source, 'cities.geojson'), JSON.stringify(outlines));
    await assert.rejects(buildSite({ outputDirectory: output, configUrl: pathToFileURL(configFile) }), /Locality boundaries/);
    assert.equal((await validateConfig(pathToFileURL(path.join(output, 'map-config.json')))).localityBoundaries.features.length, 2);
});

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

test('production URLs version CSS, module dependencies, config, fonts, and election data together', async t => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'election-cache-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const source = path.join(temporary, 'source');
    await cp(new URL('../public/examples/', import.meta.url), source, { recursive: true });
    const options = { outputDirectory: path.join(temporary, 'site'), configUrl: pathToFileURL(path.join(source, 'map-config.json')) };
    const first = await buildSite(options);
    const again = await buildSite(options);
    assert.equal(first.assetVersion, again.assetVersion, 'unchanged content has stable cache keys');
    const version = `?v=${first.assetVersion}`;
    const readOutput = name => readFile(path.join(first.outputDirectory, name), 'utf8');
    const html = await readOutput('index.html');
    assert.ok(html.includes(`./map.css${version}`));
    assert.ok(html.includes(`./map.js${version}`));
    const js = await readOutput('map.js');
    for (const file of ['dataset.js', 'viewport.js', 'gestures.js', 'view-animation.js', 'metadata.js', 'map-config.json']) assert.ok(js.includes(`./${file}${version}`));
    assert.ok((await readOutput('map.css')).includes(`.woff2${version}`));
    assert.ok(first.config.results.endsWith(version));
    assert.ok(first.config.boundaries.endsWith(version));
    await validateConfig(pathToFileURL(path.join(first.outputDirectory, 'map-config.json')));
    const csvPath = path.join(source, 'results.csv');
    await writeFile(csvPath, (await readFile(csvPath, 'utf8')).replace(',120,', ',121,'));
    const refreshed = await buildSite(options);
    assert.notEqual(refreshed.assetVersion, first.assetVersion, 'updated data changes the whole asset chain');
});

test('built headers contain final escaped metadata before JavaScript or election data loads', async t => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'election-header-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const source = path.join(temporary, 'source');
    await cp(new URL('../public/examples/', import.meta.url), source, { recursive: true });
    const configPath = path.join(source, 'map-config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.title = 'County <Election> & Results';
    config.timeZone = 'America/Los_Angeles';
    await writeFile(configPath, JSON.stringify(config));
    const build = await buildSite({ outputDirectory: path.join(temporary, 'site'), configUrl: pathToFileURL(configPath), siteLink: { label: '<My site>', href: 'https://example.org/?a=1&b=2' } });
    const html = await readFile(path.join(build.outputDirectory, 'index.html'), 'utf8');
    const header = html.match(/<header\b[\s\S]*?<\/header>/)[0];
    assert.match(header, /data-metadata-ready/);
    assert.ok(header.includes('County &lt;Election&gt; &amp; Results'));
    assert.ok(header.includes('Updated at Nov 4, 2026, 4:00 AM PST'));
    assert.ok(header.includes('&lt;My site&gt;'));
    assert.ok(header.includes('a=1&amp;b=2'));
    assert.ok(!/loading|skeleton|Updated at —/i.test(header));
    assert.ok(html.includes('<title>County &lt;Election&gt; &amp; Results</title>'));
    config.timeZone = 'invalid-zone';
    await writeFile(configPath, JSON.stringify(config));
    await assert.rejects(buildSite({ outputDirectory: path.join(temporary, 'bad'), configUrl: pathToFileURL(configPath) }), /timeZone/);
});
