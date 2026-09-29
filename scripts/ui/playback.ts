import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { playGraphNode, selectGraphNode } from '../support/director-ui.js';
import { applicationUrl, outputDirectory } from '../support/ui-verification-context.js';

export async function verifyPlayback(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create('Playback');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = `${applicationUrl}example-site.html`;
    const projectPath = join(outputDirectory, 'playback.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 5_000);
    await playGraphNode(session, 'website-root');
    await session.waitForScript(
        `const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
        const website = preview?.querySelector('.director-website')?.contentDocument;
        return Boolean(
            website?.querySelector('#example-website') &&
            document.querySelector(
                '[model-id="website-root"] [joint-selector="statusText"]'
            )?.textContent === '✓'
        );`,
        [],
        5_000,
    );
    await playGraphNode(session, 'layer-1');
    await session.switchFrame('.preview-viewport iframe');
    await session.waitForElement('.director-layer', 5_000);
    await session.switchFrame();
    await session.waitForCount('[data-testid="play-workflow"]', 1, 10_000);
}

export async function verifyExecutionControls(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create('Execution controls');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = `${applicationUrl}example-site.html`;
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.name = 'Execution state test';
    layer.source.html = '<div id="execution-state-test">Running</div>';
    layer.source.css = '#execution-state-test { padding: 2rem; background: white; color: black; }';
    layer.source.javascript = `
director.root.querySelector('#execution-state-test').dataset.started = 'true';
await director.wait(3000);
director.root.querySelector('#execution-state-test').dataset.completed = 'true';`;
    const projectPath = join(outputDirectory, 'execution-state.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'Execution controls', 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 5_000);
    await selectGraphNode(session, 'layer-1');

    await playGraphNode(session, 'layer-1');
    await session.waitForCount('[data-testid="stop-workflow"]', 1, 5_000);
    await session.waitForElement('[model-id="layer-1"]', 5_000);
    const running = await session.evaluate<{
        animation: string;
        ring: string;
    }>(`
        const node = document.querySelector('[model-id="layer-1"]');
        const ring = node.querySelector('circle.graph-node-status');
        return {
            animation: ring ? getComputedStyle(ring).animationName : 'missing',
            ring: node.outerHTML,
        };
    `);
    assert.match(running.ring, /is-running/u, 'execution: active node needs a running state.');
    assert.notEqual(
        running.animation,
        'none',
        'execution: active node needs an animated throbber.',
    );
    await session.screenshot(join(outputDirectory, 'execution-running.png'), true);
    await session.click('[data-testid="stop-preview-execution"]');
    await session.waitForElement(
        '[model-id="layer-1"] [joint-selector="statusRing"].is-cancelled',
        5_000,
    );
    await session.waitForCount('[data-testid="play-workflow"]', 1, 5_000);

    await session.click('#source-tab-javascript');
    await session.evaluate(`
        const editor = document.querySelector('.source-editor textarea');
        editor.value = "await director.wait(200); throw new Error('Expected execution failure');";
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await playGraphNode(session, 'layer-1');
    await session.waitForCount('[data-testid="stop-workflow"]', 1, 5_000);
    await session.waitForCount('[data-testid="play-workflow"]', 1, 5_000);
    await session.waitForElement('[model-id="layer-1"]', 5_000);
    const failedNode = await session.evaluate<string>(`
        return document.querySelector('[model-id="layer-1"]').outerHTML;
    `);
    assert.match(failedNode, /is-error/u, 'execution: a failure must stay attached to its node.');
    await session.waitForText('Expected execution failure', 5_000);

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}
