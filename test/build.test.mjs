import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSite } from '../scripts/build.mjs';

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
