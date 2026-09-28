import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { DirectorInputPreparations } from '../src/server/director-input-preparations.js';

test('Prepare-Module werden ausschließlich unter projects aufgelöst', () => {
    assert.equal(
        DirectorInputPreparations.resolveModule('projects/example/prepare-input.mjs'),
        resolve('projects/example/prepare-input.mjs'),
    );
    assert.throws(
        () => DirectorInputPreparations.resolveModule('../prepare-input.mjs'),
        /below projects/u,
    );
    assert.throws(
        () => DirectorInputPreparations.resolveModule('src/server/prepare-input.mjs'),
        /below projects/u,
    );
    assert.throws(
        () => DirectorInputPreparations.resolveModule('projects/example/prepare-input.ts'),
        /\.mjs/u,
    );
});
