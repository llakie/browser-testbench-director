import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RemoteTestbench, type RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../src/ui/client/core/project-format.js';
import { playGraphNode, selectGraphNode } from './support/director-ui.js';

const applicationUrl = process.env['DIRECTOR_UI_URL'] ?? 'http://127.0.0.1:5173/';
const server = process.env['BROWSER_TESTBENCH_URL'] ?? 'http://127.0.0.1:55808';
const controllerTarget = process.env['DIRECTOR_CONTROLLER_TARGET'] ?? 'firefox';
const previewTarget = process.env['DIRECTOR_PREVIEW_TARGET'] ?? 'chrome';
const testbench = new RemoteTestbench({ server, requestTimeoutMs: 30_000 });
const controller = await testbench.open({
    target: controllerTarget,
    url: applicationUrl,
    headless: true,
    ...(applicationUrl.startsWith('https://')
        ? { capabilities: { acceptInsecureCerts: true } }
        : {}),
});
let preview: RemoteSession | undefined;

try {
    await controller.setViewport(1440, 1000);
    await controller.waitForElement('.workspace', 10_000);
    const project = ProjectFormat.create('Remote workflow');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = new URL('/example-site.html', applicationUrl).toString();
    website.position = { x: 32, y: 8 };
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.position = { x: 1_056, y: 8 };
    layer.playback = { durationMs: 50, removeAfter: true };
    layer.source.javascript += `
const cardName = director.results['wait-for-action'].cardName;
director.root.dataset.cardName = cardName;
return { cardName };`;
    project.nodes.splice(1, 0, {
        id: 'prepare-website',
        type: 'javascript',
        name: 'Prepare website',
        position: { x: 288, y: 8 },
        source: `const root = await director.waitFor('body');
root.dataset.remoteRuns = String(Number(root.dataset.remoteRuns || 0) + 1);
root.dataset.remoteSpeed = director.speed;
document.querySelector('[data-director-test-action]')?.remove();
const button = document.createElement('button');
button.dataset.directorTestAction = '';
button.addEventListener('click', () => { root.dataset.remoteAction = 'clicked'; });
root.append(button);`,
    });
    project.nodes.splice(
        2,
        0,
        {
            id: 'wait-for-action',
            type: 'browser-wait',
            name: 'Wait for action',
            position: { x: 544, y: 8 },
            condition: 'script',
            script: `const button = document.querySelector('[data-director-test-action]');
return button ? { cardName: 'Pikachu' } : false;`,
            timeoutMs: 10_000,
            omitFromRecording: true,
        },
        {
            id: 'click-action',
            type: 'browser-action',
            name: 'Click action',
            position: { x: 800, y: 8 },
            selector: '[data-director-test-action]',
        },
    );
    project.nodes.push({
        id: 'verify-layer-result',
        type: 'javascript',
        name: 'Verify layer result',
        position: { x: 1_312, y: 8 },
        source: `document.body.dataset.remoteLayerResult =
    director.results['layer-1'].cardName;`,
    });
    project.connections = [
        {
            id: 'website-root--prepare-website',
            source: 'website-root',
            target: 'prepare-website',
        },
        {
            id: 'prepare-website--wait-for-action',
            source: 'prepare-website',
            target: 'wait-for-action',
        },
        {
            id: 'wait-for-action--click-action',
            source: 'wait-for-action',
            target: 'click-action',
        },
        {
            id: 'click-action--layer-1',
            source: 'click-action',
            target: 'layer-1',
        },
        {
            id: 'layer-1--verify-layer-result',
            source: 'layer-1',
            target: 'verify-layer-result',
        },
    ];
    const directory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-remote-'));
    const projectPath = join(directory, 'remote-workflow.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await controller.upload('[data-testid="project-file-input"]', projectPath);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await controller.waitForCount('[data-testid="graph-canvas"] .joint-element', 6, 5_000);
    await selectGraphNode(controller, 'website-root');
    const existing = new Set((await testbench.sessions()).map((session) => session.id));
    await controller.click('[data-testid="viewport-device-trigger"]');
    await controller.waitForElement(`[data-testid="remote-target-${previewTarget}"]`, 10_000);
    await controller.click(`[data-testid="remote-target-${previewTarget}"]`);
    preview = await findNewSession(testbench, existing);
    await controller.waitForScript(
        `return /geöffnet|Opened preview|konnte nicht|could not be opened/u.test(
            document.querySelector('.notice')?.textContent || ''
        );`,
        [],
        60_000,
    );
    const notice = await controller.evaluate<string>(
        `return document.querySelector('.notice')?.textContent?.trim() || '';`,
    );
    assert.match(notice, /geöffnet|Opened preview/u, `Remote preview failed: ${notice}`);
    const previewUrl = new URL(await preview.url());
    assert.equal(
        previewUrl.protocol,
        'http:',
        'Remote previews must not require trusting the Director development certificate.',
    );
    assert.match(
        previewUrl.pathname,
        /\/director-preview\/nodes\/preview-state\//u,
        'The remote preview must run inside the Director player shell.',
    );
    await controller.click('[data-testid="play-workflow"]');
    await preview.waitForScript(
        `const body = document.querySelector('.director-website')?.contentDocument?.body;
        return body?.dataset.remoteLayerResult === 'Pikachu';`,
        [],
        10_000,
    );
    await preview.waitForState('[data-director-node="layer-1"]', 'absent', 10_000);
    await preview.waitForScript(
        `const body = document.querySelector('.director-website')?.contentDocument?.body;
        return body?.dataset.remoteRuns === '1' &&
            body.dataset.remoteSpeed === 'live' &&
            body.dataset.remoteAction === 'clicked';`,
        [],
        10_000,
    );
    await playGraphNode(controller, 'prepare-website');
    await preview.waitForScript(
        `const body = document.querySelector('.director-website')?.contentDocument?.body;
        return body?.dataset.remoteRuns === '1' && body.dataset.remoteSpeed === 'live';`,
        [],
        10_000,
    );
    await controller.waitForScript(
        `return !document.querySelector('[joint-selector="statusRing"].is-running');`,
        [],
        10_000,
    );
    const state = await preview.evaluate<{ runs: string; speed: string }>(`
        const root = document.querySelector('.director-website').contentDocument.body;
        return { runs: root.dataset.remoteRuns, speed: root.dataset.remoteSpeed };
    `);
    assert.deepEqual(state, { runs: '1', speed: 'live' });
    await controller.waitForState('.notice', 'absent', 5_000);
    const graphNodeIds = await controller.evaluate<string[]>(`
        return [...document.querySelectorAll('[data-testid="graph-canvas"] .joint-element')]
            .map(node => node.getAttribute('model-id'));
    `);
    assert.ok(
        graphNodeIds.includes('layer-1'),
        `Layer node disappeared: ${graphNodeIds.join(', ')}`,
    );
    await playGraphNode(controller, 'layer-1');
    await controller.waitForScript(
        `return /Ausführung abgeschlossen|Execution completed|Ausführung fehlgeschlagen|Execution failed/u.test(
            document.querySelector('.notice')?.textContent || ''
        );`,
        [],
        30_000,
    );
    const playbackNotice = await controller.evaluate<string>(
        `return document.querySelector('.notice')?.textContent?.trim() || '';`,
    );
    assert.doesNotMatch(
        playbackNotice,
        /fehlgeschlagen|failed/iu,
        `Remote catch-up failed: ${playbackNotice}`,
    );
    await preview.waitForScript(
        `const body = document.querySelector('.director-website')?.contentDocument?.body;
        return body?.dataset.remoteRuns === '1' && body.dataset.remoteSpeed === 'live';`,
        [],
        10_000,
    );

    process.stdout.write(
        `Remote workflow verification passed (${controllerTarget} → ${previewTarget}).\n`,
    );
} finally {
    await preview?.close().catch(() => undefined);
    await controller.close().catch(() => undefined);
}

async function findNewSession(
    remote: RemoteTestbench,
    existing: ReadonlySet<string>,
): Promise<RemoteSession> {
    const deadline = Date.now() + 60_000;

    while (Date.now() < deadline) {
        const match = (await remote.sessions()).find((session) => !existing.has(session.id));

        if (match) {
            return match;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error('The remote preview session was not created.');
}
