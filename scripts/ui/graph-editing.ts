import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { ProjectNodes } from '../../src/ui/client/core/project-nodes.js';
import { WorkflowGraph } from '../../src/ui/client/core/workflow-graph.js';
import { playGraphNode, selectGraphNode } from '../support/director-ui.js';
import { outputDirectory } from '../support/ui-verification-context.js';

export async function verifyEditableConnections(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-link', 1, 10_000);
    await session.waitForState(
        '[data-testid="graph-canvas"] .joint-link [joint-selector="connectionHandle"]',
        'absent',
        5_000,
    );
    await session.evaluate(`
        const line = document.querySelector(
            '[data-testid="graph-canvas"] .joint-link [joint-selector="line"]',
        );
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent;
            line.dispatchEvent(new EventType(type, { bubbles: true, button: 0 }));
        }
    `);
    await session.waitForElement('[data-testid="delete-connection"]', 5_000);
    await session.click('[data-testid="delete-connection"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-link', 0, 5_000);
    await session.waitForState('[data-testid="delete-connection"]', 'absent', 5_000);
    const disconnected = await session.evaluate<boolean>(`
        return document.querySelector(
            '[model-id="layer-1"] [joint-selector="outline"]',
        ).getAttribute('stroke-dasharray') === '5 4';
    `);
    assert.equal(disconnected, true, 'graph: disconnected nodes must be visibly marked.');

    await session.drag(
        '[model-id="website-root"] [port="out"]',
        '[model-id="layer-1"] [port="in"]',
    );
    await session.waitForCount('[data-testid="graph-canvas"] .joint-link', 1, 5_000);
    await session.waitForElement(
        '[model-id="layer-1"] [joint-selector="outline"][stroke-dasharray="none"]',
        5_000,
    );
    const connectionState = await session.evaluate<{ dirty: boolean; solidNodes: boolean }>(`
        return {
            dirty: document.querySelector('.status-dot').classList.contains('is-dirty'),
            solidNodes: [...document.querySelectorAll('[data-testid="graph-canvas"] [joint-selector="outline"]')]
                .every((outline) => outline.getAttribute('stroke-dasharray') === 'none'),
        };
    `);
    assert.equal(
        connectionState.dirty,
        true,
        'graph: editing a connection must mark the project dirty.',
    );
    assert.equal(
        connectionState.solidNodes,
        true,
        'graph: reconnected nodes must lose the warning style.',
    );
    await session.screenshot(join(outputDirectory, 'editable-connections.png'), true);

    const audioProject = ProjectFormat.create('Audio inputs');
    const input = ProjectNodes.createInput(audioProject, 'Audio file');
    input.accept = 'audio/*';
    const delay = ProjectNodes.createDelay(audioProject, 'Delay');
    const audio = ProjectNodes.createAudio(audioProject, 'Audio');
    audioProject.nodes.push(input, delay, audio);
    audioProject.connections = [
        WorkflowGraph.createConnection(audioProject, 'website-root', delay.id),
        WorkflowGraph.createConnection(audioProject, input.id, audio.id),
    ];
    const audioProjectPath = join(outputDirectory, 'audio-input-connections.btd.json');
    await writeFile(audioProjectPath, ProjectFormat.stringify(audioProject), 'utf8');
    await session.upload('[data-testid="project-file-input"]', audioProjectPath);
    await session.waitForValue('.project-title input', 'Audio inputs', 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-link', 2, 5_000);
    await session.drag(
        `[model-id="${delay.id}"] [port="out"]`,
        `[model-id="${audio.id}"] [port="flow"]`,
    );
    await session.waitForCount('[data-testid="graph-canvas"] .joint-link', 3, 5_000);
    await session.waitForCount(
        `[model-id="${audio.id}"] [port="asset"], [model-id="${audio.id}"] [port="flow"]`,
        2,
        5_000,
    );
}

export async function verifyJavaScriptNode(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    const project = ProjectFormat.create('JavaScript node');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = '/example-site.html';
    website.position = { x: 32, y: 8 };
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.position = { x: 544, y: 8 };
    layer.source.html = '<div id="test-layer"></div>';
    project.nodes.splice(1, 0, {
        id: 'prepare-website',
        type: 'javascript',
        name: 'Prepare website',
        position: { x: 288, y: 8 },
        source: `const root = await director.waitFor('#example-website');
root.dataset.runs = String(Number(root.dataset.runs || 0) + 1);
root.dataset.speed = director.speed;`,
    });
    project.connections = [
        {
            id: 'website-root--prepare-website',
            source: 'website-root',
            target: 'prepare-website',
        },
        {
            id: 'prepare-website--layer-1',
            source: 'prepare-website',
            target: 'layer-1',
        },
    ];
    const projectPath = join(outputDirectory, 'javascript-node.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'JavaScript node', 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await selectGraphNode(session, 'prepare-website');
    await session.waitForElement('.source-editor textarea', 5_000);
    await session.click('[data-testid="maximize-editor"]');
    const maximizedEditor = await session.evaluate<{
        panelWidth: number;
        panelHeight: number;
        editorWidth: number;
        editorHeight: number;
    }>(`
        const panel = document.querySelector('.editor-panel').getBoundingClientRect();
        const editor = document.querySelector('.source-editor textarea').getBoundingClientRect();
        return {
            panelWidth: panel.width,
            panelHeight: panel.height,
            editorWidth: editor.width,
            editorHeight: editor.height,
        };
    `);
    assert.ok(
        maximizedEditor.editorWidth > maximizedEditor.panelWidth * 0.8,
        `javascript: maximized editor must use the panel width (${JSON.stringify(maximizedEditor)}).`,
    );
    assert.ok(
        maximizedEditor.editorHeight > maximizedEditor.panelHeight * 0.5,
        `javascript: maximized editor must use the remaining height (${JSON.stringify(maximizedEditor)}).`,
    );
    await session.screenshot(join(outputDirectory, 'javascript-editor-maximized.png'), true);
    await session.click('[data-testid="maximize-editor"]');
    await session.waitForState('.preview-viewport iframe', 'present', 5_000);
    await playGraphNode(session, 'prepare-website');
    await session.waitForScript(
        `const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
        const website = preview?.querySelector('.director-website')?.contentDocument;
        return Boolean(website?.querySelector('#example-website[data-runs="1"][data-speed="live"]'));`,
        [],
        5_000,
    );
    await session.waitForScript(
        `return document.querySelector(
            '[model-id="prepare-website"] [joint-selector="statusText"]'
        )?.textContent === '✓' &&
            !document.querySelector('[model-id="prepare-website"] [joint-selector^="prepared"]');`,
        [],
        5_000,
    );

    await session.click('[data-testid="play-node-current"]');
    await session.waitForScript(
        `const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
        const website = preview?.querySelector('.director-website')?.contentDocument;
        return Boolean(website?.querySelector('#example-website[data-runs="2"]'));`,
        [],
        5_000,
    );

    await selectGraphNode(session, 'layer-1');
    await playGraphNode(session, 'layer-1');
    await session.waitForScript(
        `const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
        const website = preview?.querySelector('.director-website')?.contentDocument;
        return Boolean(
            preview?.querySelector('.director-layer') &&
            website?.querySelector('#example-website[data-runs="1"][data-speed="live"]')
        );`,
        [],
        5_000,
    );

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}
