import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { ProjectNodes } from '../../src/ui/client/core/project-nodes.js';
import { playGraphNode, selectGraphNode } from '../support/director-ui.js';
import { exampleSiteUrl, outputDirectory } from '../support/ui-verification-context.js';

export async function verifyPlayback(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create('Playback');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = exampleSiteUrl;
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
    website.url = exampleSiteUrl;
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.name = 'Execution state test';
    layer.source.html = '<div id="execution-state-test">Running</div>';
    layer.source.css = '#execution-state-test { padding: 2rem; background: white; color: black; }';
    layer.source.javascript = `
director.root.querySelector('#execution-state-test').dataset.started = 'true';
await director.wait(3000);
director.root.querySelector('#execution-state-test').dataset.completed = 'true';`;
    const parallel = ProjectNodes.createJavaScript(project, 'Parallel step');
    parallel.source = 'await director.wait(3000);';
    project.nodes.push(parallel);
    const merge = ProjectNodes.createMerge(project, 'Join parallel steps');
    project.nodes.push(merge);
    const future = ProjectNodes.createJavaScript(project, 'Future step');
    project.nodes.push(future);
    project.connections.push({
        id: `${website.id}--${parallel.id}`,
        source: website.id,
        target: parallel.id,
    });
    project.connections.push({
        id: `${layer.id}--${merge.id}`,
        source: layer.id,
        target: merge.id,
    });
    project.connections.push({
        id: `${parallel.id}--${merge.id}`,
        source: parallel.id,
        target: merge.id,
    });
    project.connections.push({
        id: `${merge.id}--${future.id}`,
        source: merge.id,
        target: future.id,
    });
    const projectPath = join(outputDirectory, 'execution-state.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'Execution controls', 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 5, 5_000);
    await selectGraphNode(session, 'layer-1');

    await playGraphNode(session, 'layer-1');
    await session.waitForCount('[data-testid="stop-workflow"]', 1, 5_000);
    await session.waitForElement('[model-id="layer-1"]', 5_000);
    const running = await session.evaluate<{
        animation: string;
        editorLocked: boolean;
        nameDisabled: boolean;
        opacity: number;
        playIcon: string;
        ring: string;
    }>(`
        const node = document.querySelector('[model-id="layer-1"]');
        const ring = node.querySelector('circle.graph-node-status');
        return {
            animation: ring ? getComputedStyle(ring).animationName : 'missing',
            editorLocked: document.querySelector('[data-testid="editor-properties-scroll"]')
                ?.hasAttribute('inert') ?? false,
            nameDisabled: document.querySelector('[data-testid="node-name"]')?.disabled ?? false,
            opacity: Number(node.getAttribute('opacity') || getComputedStyle(node).opacity),
            playIcon: node.querySelector('[joint-selector="playIcon"]')?.getAttribute('d') || '',
            ring: node.outerHTML,
        };
    `);
    assert.match(running.ring, /is-running/u, 'execution: active node needs a running state.');
    assert.notEqual(
        running.animation,
        'none',
        'execution: active node needs an animated throbber.',
    );
    assert.equal(running.editorLocked, true, 'execution: participating properties must lock.');
    assert.equal(running.nameDisabled, true, 'execution: the participating node name must lock.');
    assert.ok(running.opacity < 1, 'execution: participating graph nodes must be translucent.');
    assert.equal(
        running.playIcon,
        'M5 5h6v6H5z',
        'execution: the triggering node must expose a stop button.',
    );
    await session.screenshot(join(outputDirectory, 'execution-running.png'), true);
    await playGraphNode(session, 'layer-1');
    await session.waitForElement(
        '[model-id="layer-1"] [joint-selector="statusRing"].is-cancelled',
        5_000,
    );
    await session.waitForCount('[data-testid="play-workflow"]', 1, 5_000);
    const stable = await session.evaluate<{
        editorLocked: boolean;
        nameDisabled: boolean;
        playIcon: string;
    }>(`
        const node = document.querySelector('[model-id="layer-1"]');
        return {
            editorLocked: document.querySelector('[data-testid="editor-properties-scroll"]')
                ?.hasAttribute('inert') ?? false,
            nameDisabled: document.querySelector('[data-testid="node-name"]')?.disabled ?? false,
            playIcon: node.querySelector('[joint-selector="playIcon"]')?.getAttribute('d') || '',
        };
    `);
    assert.equal(stable.editorLocked, false, 'execution: properties must unlock after stopping.');
    assert.equal(
        stable.nameDisabled,
        false,
        'execution: the node name must unlock after stopping.',
    );
    assert.notEqual(stable.playIcon, 'M5 5h6v6H5z');

    await session.click('[data-testid="play-workflow"]');
    await session.waitForElement(
        `[model-id="${future.id}"] [joint-selector="statusRing"].is-pending`,
        5_000,
    );
    const progress = await session.evaluate<{
        completed: string;
        pendingColor: string;
        parallelRunning: string;
        pendingDisplay: string;
        pendingIconDisplay: string;
        runningColor: string;
        running: string;
    }>(`
        const completed = document.querySelector(
            '[model-id="website-root"] [joint-selector="statusText"]'
        );
        const running = document.querySelector(
            '[model-id="${layer.id}"] [joint-selector="statusRing"]'
        );
        const parallelRunning = document.querySelector(
            '[model-id="${parallel.id}"] [joint-selector="statusRing"]'
        );
        const pending = document.querySelector(
            '[model-id="${future.id}"] [joint-selector="statusRing"]'
        );
        const pendingIcon = document.querySelector(
            '[model-id="${future.id}"] [joint-selector="statusIcon"]'
        );
        return {
            completed: completed?.textContent ?? '',
            pendingColor: pending ? getComputedStyle(pending).stroke : '',
            parallelRunning: parallelRunning?.getAttribute('class') ?? '',
            pendingDisplay: pending ? getComputedStyle(pending).display : 'missing',
            pendingIconDisplay: pendingIcon ? getComputedStyle(pendingIcon).display : 'missing',
            runningColor: running ? getComputedStyle(running).stroke : '',
            running: running?.getAttribute('class') ?? '',
        };
    `);
    assert.equal(progress.completed, '✓');
    assert.match(progress.running, /is-running/u);
    assert.match(
        progress.parallelRunning,
        /is-running/u,
        'execution: every concurrently running branch needs a throbber.',
    );
    assert.equal(progress.pendingDisplay, 'block');
    assert.equal(progress.pendingIconDisplay, 'block');
    assert.equal(
        progress.pendingColor,
        progress.runningColor,
        'execution: pending and running indicators must use the same visible status color.',
    );
    await session.click('[data-testid="stop-workflow"]');
    await session.waitForCount('[data-testid="play-workflow"]', 1, 5_000);
    await session.waitForElement(`[model-id="${future.id}"]`, 5_000);
    const pendingAfterStop = await session.evaluate<string>(`
        const pending = document.querySelector(
            '[model-id="${future.id}"] [joint-selector="statusRing"]'
        );
        return pending ? getComputedStyle(pending).display : 'missing';
    `);
    assert.equal(pendingAfterStop, 'none');

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
