import assert from 'node:assert/strict';
import { test } from 'node:test';

import { flyoutShift } from '../src/ui/client/core/flyout-position.js';

const viewport = { width: 390, height: 844 };

test('Flyout bleibt unverändert, wenn es vollständig sichtbar ist', () => {
    assert.deepEqual(
        flyoutShift({ left: 20, top: 20, right: 220, bottom: 320 }, viewport),
        { x: 0, y: 0 },
    );
});

test('Flyout wird an allen Viewport-Rändern in den sichtbaren Bereich geschoben', () => {
    assert.deepEqual(
        flyoutShift({ left: -160, top: 700, right: 50, bottom: 900 }, viewport),
        { x: 168, y: -64 },
    );
    assert.deepEqual(
        flyoutShift({ left: 300, top: -12, right: 430, bottom: 100 }, viewport),
        { x: -48, y: 20 },
    );
});

test('Ein größeres Flyout richtet seine Startkante am Viewport aus', () => {
    assert.deepEqual(
        flyoutShift({ left: -50, top: -30, right: 450, bottom: 900 }, viewport),
        { x: 58, y: 38 },
    );
});
