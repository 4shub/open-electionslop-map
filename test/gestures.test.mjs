import assert from 'node:assert/strict';
import test from 'node:test';
import { attachMapGestures } from '../public/gestures.js';

function harness(aspect = 0.62) {
    const svg = new EventTarget();
    const captured = new Set();
    svg.hasPointerCapture = id => captured.has(id);
    svg.setPointerCapture = id => captured.add(id);
    svg.releasePointerCapture = id => captured.delete(id);
    svg.classList = { add() {}, remove() {} };
    svg.clientHeight = 500 * aspect;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 * aspect });
    let view = { x: 0, y: 0, width: 1000, height: 1000 * aspect };
    const toMapPoint = (x, y) => ({ x: view.x + x / 500 * view.width, y: view.y + y / (500 * aspect) * view.height });
    const gestures = attachMapGestures(svg, {
        getViewBox: () => view, toMapPoint, getAspectRatio: () => aspect,
        clampWidth: width => Math.max(1, Math.min(1300, width)),
        setViewBox: next => { view = { ...next, height: next.width * aspect }; },
    });
    function send(type, properties = {}) {
        const event = new Event(type, { cancelable: true });
        Object.assign(event, { button: 0, pointerId: 1, clientX: 100, clientY: 100, ...properties });
        svg.dispatchEvent(event);
        return event;
    }
    return { send, gestures, toMapPoint, get view() { return view; }, captured };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('two fingers zoom in and out around their midpoint and continue panning without a jump', () => {
    const map = harness();
    map.send('pointerdown');
    map.send('pointerdown', { pointerId: 2, clientX: 200 });
    const anchor = map.toMapPoint(150, 100);
    map.send('pointermove', { pointerId: 2, clientX: 300 });
    near(map.view.width, 500);
    near(map.toMapPoint(200, 100).x, anchor.x);
    near(map.toMapPoint(200, 100).y, anchor.y);
    assert.equal(map.captured.size, 2);
    map.send('pointermove', { pointerId: 2, clientX: 150 });
    near(map.view.width, 1300);
    near(map.toMapPoint(125, 100).x, anchor.x);
    map.send('pointerup', { pointerId: 2, clientX: 150 });
    const before = map.view.x;
    map.send('pointermove', { clientX: 110 });
    near(map.view.x, before - 10 / 500 * map.view.width);
    map.send('pointerup', { clientX: 110 });
    assert.ok(map.gestures.isClickSuppressed());
    assert.equal(map.captured.size, 0);
});

test('a tap still selects, while dragging and cancelled gestures suppress clicks', () => {
    const tap = harness();
    tap.send('pointerdown'); tap.send('pointerup');
    assert.equal(tap.gestures.isClickSuppressed(), false);
    const map = harness();
    map.send('pointerdown');
    map.send('pointermove', { clientX: 125 });
    map.send('pointercancel');
    assert.ok(map.gestures.isClickSuppressed());
    const view = { ...map.view };
    map.send('pointermove', { clientX: 400 });
    assert.deepEqual(map.view, view);
});

test('trackpad Ctrl+wheel zooms in both directions and prevents browser zoom', () => {
    const map = harness();
    const anchor = map.toMapPoint(100, 100);
    assert.equal(map.send('wheel', { ctrlKey: true, deltaY: -10, deltaMode: 0 }).defaultPrevented, true);
    assert.ok(map.view.width < 1000);
    near(map.toMapPoint(100, 100).x, anchor.x);
    map.send('wheel', { ctrlKey: true, deltaY: 10, deltaMode: 0 });
    near(map.view.width, 1000);
});

test('Safari pinch events zoom without also applying wheel events', () => {
    const map = harness();
    map.send('gesturestart', { scale: 1 });
    map.send('gesturechange', { scale: 2 });
    near(map.view.width, 500);
    map.send('wheel', { ctrlKey: true, deltaY: -10, deltaMode: 0 });
    near(map.view.width, 500);
    map.send('gesturechange', { scale: 0.8 });
    near(map.view.width, 1250);
    map.send('gestureend');
});


test('pinch anchors both axes in a tall phone map', () => {
    const map = harness(1.6);
    map.send('pointerdown');
    map.send('pointerdown', { pointerId: 2, clientX: 200, clientY: 200 });
    const anchor = map.toMapPoint(150, 150);
    map.send('pointermove', { pointerId: 2, clientX: 300, clientY: 300 });
    near(map.view.width, 500);
    near(map.view.height, 800);
    near(map.toMapPoint(200, 200).x, anchor.x);
    near(map.toMapPoint(200, 200).y, anchor.y);
});
