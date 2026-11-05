import assert from 'node:assert/strict';
import test from 'node:test';
import { contestForHash, contestUrl } from '../public/contest-links.js';

const contests = [{ id: 'governor' }, { id: 'rtm-precincts' }, { id: 'City / District #1' }];

test('contest links preserve the page and config query and round-trip special contest IDs', () => {
    const url = new URL(contestUrl('https://example.com/elections/?config=other.json#governor', contests[2].id));
    assert.equal(url.pathname, '/elections/');
    assert.equal(url.search, '?config=other.json');
    assert.equal(contestForHash(contests, url.hash), contests[2]);
    assert.equal(contestUrl('https://example.com/elections/', 'rtm-precincts'), 'https://example.com/elections/#rtm-precincts');
});

test('direct links choose their contest and absent, stale, or malformed fragments use the default', () => {
    assert.equal(contestForHash(contests, '#rtm-precincts'), contests[1]);
    for (const hash of ['', '#missing', '#%E0%A4']) assert.equal(contestForHash(contests, hash), contests[0]);
    assert.equal(contestForHash([], '#governor'), undefined);
});
