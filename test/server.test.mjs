import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticServer } from '../scripts/serve.mjs';

test('Node static server serves map assets and confines requests to the site directory', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'election-map-server-'));
    const root = path.join(directory, 'public');
    await mkdir(path.join(root, 'nested'), { recursive: true });
    await Promise.all([
        writeFile(path.join(root, 'index.html'), '<h1>Map</h1>'),
        writeFile(path.join(root, 'map.js'), 'export const map = true;'),
        writeFile(path.join(root, 'boundaries.geojson'), '{"type":"FeatureCollection"}'),
        writeFile(path.join(root, 'my results.csv'), 'precinct,votes\n1,42\n'),
        writeFile(path.join(root, 'nested/index.html'), 'Nested map'),
        writeFile(path.join(root, '.env'), 'not public'),
        writeFile(path.join(directory, 'private.txt'), 'not in public'),
    ]);
    await symlink(path.join(directory, 'private.txt'), path.join(root, 'outside.txt'));
    const server = await createStaticServer(root);
    t.after(async () => {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await rm(directory, { recursive: true, force: true });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;

    await t.test('serves root HTML and query-based county configs without changing the path', async () => {
        const response = await fetch(`${base}/?config=./examples/map-config.json`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.equal(await response.text(), '<h1>Map</h1>');
    });
    await t.test('sets browser-compatible module and GeoJSON types, and supports encoded filenames', async () => {
        const js = await fetch(`${base}/map.js`);
        assert.match(js.headers.get('content-type'), /text\/javascript/);
        const geo = await fetch(`${base}/boundaries.geojson`);
        assert.match(geo.headers.get('content-type'), /application\/geo\+json/);
        const csv = await fetch(`${base}/my%20results.csv`);
        assert.equal(await csv.text(), 'precinct,votes\n1,42\n');
        const head = await fetch(`${base}/map.js`, { method: 'HEAD' });
        assert.equal(head.status, 200);
        assert.equal(Number(head.headers.get('content-length')), (await readFile(path.join(root, 'map.js'))).length);
        assert.equal(await head.text(), '');
    });
    await t.test('redirects directory paths while preserving the config query', async () => {
        const response = await fetch(`${base}/nested?config=local.json`, { redirect: 'manual' });
        assert.equal(response.status, 301);
        assert.equal(response.headers.get('location'), '/nested/?config=local.json');
        assert.equal(await (await fetch(`${base}/nested/`)).text(), 'Nested map');
    });
    await t.test('rejects traversal, hidden files, and symlinks outside the site', async () => {
        for (const pathname of ['/%2e%2e%2fprivate.txt', '/.env', '/outside.txt']) {
            const response = await fetch(base + pathname);
            assert.equal(response.status, 403, pathname);
            assert.ok(!(await response.text()).includes('not public'));
        }
    });
    await t.test('reports missing or malformed paths and rejects mutations', async () => {
        assert.equal((await fetch(`${base}/missing`)).status, 404);
        assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
        const response = await fetch(`${base}/map.js`, { method: 'POST', body: 'change' });
        assert.equal(response.status, 405);
        assert.equal(response.headers.get('allow'), 'GET, HEAD');
        assert.equal(await readFile(path.join(root, 'map.js'), 'utf8'), 'export const map = true;');
    });
});
