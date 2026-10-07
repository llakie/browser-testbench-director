import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    flyoutAlignment,
    flyoutArrowX,
    flyoutPlacement,
    flyoutShift,
} from '../src/ui/client/core/flyout-position.js';

const viewport = { width: 390, height: 844 };

test('Flyout bleibt unverändert, wenn es vollständig sichtbar ist', () => {
    assert.deepEqual(flyoutShift({ left: 20, top: 20, right: 220, bottom: 320 }, viewport), {
        x: 0,
        y: 0,
    });
});

test('Flyout wird an allen Viewport-Rändern in den sichtbaren Bereich geschoben', () => {
    assert.deepEqual(flyoutShift({ left: -160, top: 700, right: 50, bottom: 900 }, viewport), {
        x: 168,
        y: -64,
    });
    assert.deepEqual(flyoutShift({ left: 300, top: -12, right: 430, bottom: 100 }, viewport), {
        x: -48,
        y: 20,
    });
});

test('Ein größeres Flyout richtet seine Startkante am Viewport aus', () => {
    assert.deepEqual(flyoutShift({ left: -50, top: -30, right: 450, bottom: 900 }, viewport), {
        x: 58,
        y: 38,
    });
});

test('Der Flyout-Pfeil bleibt am auslösenden Element ausgerichtet', () => {
    assert.equal(
        flyoutArrowX(
            { left: 300, top: 20, right: 500, bottom: 120 },
            { left: 370, top: 0, right: 410, bottom: 20 },
            { x: -48, y: 0 },
        ),
        138,
    );
});

test('Flyouts klappen bei mangelndem Platz auf die Gegenseite', () => {
    assert.equal(
        flyoutPlacement(
            { left: 40, top: 780, right: 240, bottom: 920 },
            { left: 80, top: 740, right: 120, bottom: 780 },
            viewport,
            'below',
        ),
        'above',
    );
    assert.equal(
        flyoutAlignment(
            { left: 300, top: 80, right: 440, bottom: 180 },
            viewport,
            'left',
        ),
        'right',
    );
});
