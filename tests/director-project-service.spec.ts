import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DirectorProjectService } from '../src/server/director-project-service.js';

test('Director-Projektservice verwaltet ausschließlich validierte Workspace-Projekte', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'director-project-service-'));
    const service = new DirectorProjectService(workspace);
    const path = 'projects/example/example.btd.json';

    try {
        const created = await service.create(path, {
            name: 'Example',
            websiteUrl: 'https://example.com',
        });
        assert.equal(created.name, 'Example');
        assert.deepEqual(await service.list(), [path]);
        assert.equal((await service.read(path)).nodes[0]?.type, 'website');
        await assert.rejects(
            () => service.create(path, { name: 'Replacement' }),
            /already exists/u,
        );

        const layer = created.nodes.find((node) => node.type === 'layer')!;
        await service.upsertNode(path, { ...layer, name: 'Updated layer' });
        assert.equal(
            (await service.read(path)).nodes.find((node) => node.id === layer.id)?.name,
            'Updated layer',
        );

        await assert.rejects(() => service.read('../outside.btd.json'), /outside/u);
        await assert.rejects(
            () => service.write(path, { invalid: true }),
            /Unsupported project format/u,
        );
    } finally {
        await rm(workspace, { recursive: true, force: true });
    }
});
