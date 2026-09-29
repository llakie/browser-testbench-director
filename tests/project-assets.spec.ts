import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { ProjectAssets } from '../src/ui/client/core/project-assets.js';

test('Projekt-Assets leiten die Prüfsumme aus der Content-Adresse ab', async () => {
    const content = new TextEncoder().encode('persistent input');
    const digest = createHash('sha256').update(content).digest('hex');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
        assert.equal(String(input), `/director-api/assets/${digest}/input.txt`);
        return new Response(content);
    };

    try {
        const file = await ProjectAssets.load({
            asset: `${digest}/input.txt`,
            name: 'input.txt',
            type: 'text/plain',
            size: content.byteLength,
        });
        assert.equal(file.name, 'input.txt');
        assert.equal(file.type, 'text/plain');
        assert.equal(await file.text(), 'persistent input');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
