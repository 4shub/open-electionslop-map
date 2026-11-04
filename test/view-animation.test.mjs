import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewAnimator } from '../public/view-animation.js';

function harness(reduced = false) {
    let view = { x: 0, y: 0, width: 100, height: 62 };
    let time = 0, nextId = 0;
    const frames = new Map();
    const animator = createViewAnimator({
        getView: () => view,
        render: next => { view = { ...next }; },
        now: () => time,
        reducedMotion: () => reduced,
        requestFrame: callback => { frames.set(++nextId, callback); return nextId; },
        cancelFrame: id => frames.delete(id),
    });
    return { animator, get view() { return view; }, get pending() { return frames.size; },
        advance(timestamp) { time = timestamp; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); } };
}

test('views animate through intermediate frames and land exactly at the destination', () => {
    const map = harness();
    const target = { x: 500, y: 100, width: 100, height: 62 };
    map.animator.move(target, { duration: 400 });
    map.advance(200);
    assert.ok(map.view.x + map.view.width / 2 > 50 && map.view.x + map.view.width / 2 < 550);
    assert.ok(map.view.width > 100, 'distant regions briefly zoom out for context');
    map.advance(400);
    assert.deepEqual(map.view, target);
    assert.equal(map.pending, 0);
    assert.equal(map.animator.getDestination(), null);
});

test('rapid view changes start from the current frame; user input cancels pending motion', () => {
    const map = harness();
    map.animator.move({ x: 300, y: 200, width: 10, height: 6.2 });
    map.advance(100);
    const intermediate = { ...map.view };
    const next = { x: -100, y: 20, width: 80, height: 49.6 };
    map.animator.move(next);
    assert.deepEqual(map.view, intermediate);
    assert.deepEqual(map.animator.getDestination(), next);
    map.advance(200);
    map.animator.cancel();
    const cancelled = { ...map.view };
    map.advance(1000);
    assert.deepEqual(map.view, cancelled);
    assert.equal(map.pending, 0);
});

test('reduced motion and initial positioning render immediately without scheduling animation', () => {
    for (const reduced of [false, true]) {
        const map = harness(reduced);
        const target = { x: 20, y: 30, width: 50, height: 31 };
        map.animator.move(target, { duration: reduced ? 450 : 0 });
        assert.deepEqual(map.view, target);
        assert.equal(map.pending, 0);
    }
});
