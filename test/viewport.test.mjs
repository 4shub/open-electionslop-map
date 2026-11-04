import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultViewBox, votingAreaViewBox } from '../public/viewport.js';

test('reporting bounds remain fully visible on tall phones and short landscape maps', () => {
    const ring = [[20,30],[40,30],[40,50],[20,50],[20,30]];
    const features = [{ geometry: { type: 'Polygon', coordinates: [ring] } }];
    for (const aspect of [1.6, 0.62, 0.01]) {
        const view = votingAreaViewBox(features, point => point, aspect);
        assert.equal(view.height, view.width * aspect);
        for (const [x,y] of ring) {
            assert.ok(x >= view.x && x <= view.x + view.width);
            assert.ok(y >= view.y && y <= view.y + view.height);
        }
        assert.ok(Math.max(20 / view.width, 20 / view.height) > 0.8);
    }
    assert.equal(votingAreaViewBox([], point => point), null);
    assert.deepEqual(defaultViewBox(), { x: 0, y: 0, width: 1000, height: 620 });
});
