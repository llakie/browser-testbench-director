import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StagePanGesture, StageZoomGesture } from '../src/ui/client/core/stage-zoom-gesture.js';

test('Pan-Geste liefert die Bewegung eines einzelnen Pointers', () => {
    const gesture = new StagePanGesture();
    gesture.begin(1, 100, 80);

    assert.deepEqual(gesture.move(1, 130, 65, true), { x: 30, y: -15 });
    assert.equal(gesture.move(1, 140, 60, false), null);
    assert.deepEqual(gesture.move(1, 145, 55, true), { x: 5, y: -5 });
});

test('Pinch-Geste skaliert relativ zum Abstand der beiden Finger', () => {
    const gesture = new StageZoomGesture();
    gesture.begin(1, 100, 100, 1);
    gesture.begin(2, 200, 100, 1);

    assert.deepEqual(gesture.move(2, 250, 100), {
        zoom: Math.pow(1.5, 1.35),
        previousCenter: { x: 150, y: 100 },
        center: { x: 175, y: 100 },
    });
    assert.deepEqual(gesture.move(2, 150, 100), {
        zoom: Math.pow(0.5, 1.35),
        previousCenter: { x: 175, y: 100 },
        center: { x: 125, y: 100 },
    });
});

test('Pinch-Geste beginnt nach dem Abheben eines Fingers sauber neu', () => {
    const gesture = new StageZoomGesture();
    gesture.begin(1, 0, 0, 1);
    gesture.begin(2, 100, 0, 1);
    gesture.end(2);

    assert.equal(gesture.move(1, 10, 0), null);
    gesture.begin(3, 110, 0, 1.25);
    assert.deepEqual(gesture.move(3, 210, 0), {
        zoom: 1.25 * Math.pow(2, 1.35),
        previousCenter: { x: 60, y: 0 },
        center: { x: 110, y: 0 },
    });
});
