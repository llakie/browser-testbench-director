import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { outputDirectory } from '../support/ui-verification-context.js';

export async function verifyGraphAutoLayout(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create('Auto layout');
    project.nodes.unshift(
        {
            id: 'input-a',
            type: 'input',
            name: 'Input A',
            position: null,
            accept: 'image/*',
            required: true,
        },
        {
            id: 'input-b',
            type: 'input',
            name: 'Input B',
            position: null,
            accept: 'image/*',
            required: true,
        },
    );
    project.connections.push(
        { id: 'input-a--website-root', source: 'input-a', target: 'website-root' },
        { id: 'input-b--website-root', source: 'input-b', target: 'website-root' },
    );
    project.nodes.push(
        {
            id: 'branch-a',
            type: 'javascript',
            name: 'Branch A',
            position: null,
            source: '',
        },
        {
            id: 'branch-b',
            type: 'javascript',
            name: 'Branch B',
            position: null,
            source: '',
        },
        {
            id: 'branch-merge',
            type: 'merge',
            name: 'Merge branches',
            position: null,
            waitFor: 'all',
        },
    );
    project.connections.push(
        { id: 'layer-1--branch-a', source: 'layer-1', target: 'branch-a' },
        { id: 'layer-1--branch-b', source: 'layer-1', target: 'branch-b' },
        { id: 'branch-a--merge', source: 'branch-a', target: 'branch-merge' },
        { id: 'branch-b--merge', source: 'branch-b', target: 'branch-merge' },
    );
    let previousId = 'branch-merge';

    for (let index = 2; index <= 14; index += 1) {
        const id = `auto-node-${index}`;
        project.nodes.push({
            id,
            type: 'javascript',
            name: `Auto ${index}`,
            position: { x: index * 280, y: 8 },
            source: '',
        });
        project.connections.push({
            id: `${previousId}--${id}`,
            source: previousId,
            target: id,
        });
        previousId = id;
    }

    const projectPath = join(outputDirectory, 'auto-layout.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForCount(
        '[data-testid="graph-canvas"] .joint-element',
        project.nodes.length,
        5_000,
    );

    await session.click('[data-testid="graph-zoom-in"]');
    await session.click('[data-testid="graph-zoom-in"]');
    const zoomBeforeLayout = (await session.state('[data-testid="graph-zoom-reset"]')).text;
    await session.click('[data-testid="auto-layout-graph"]');
    await session.waitForScript(
        `return /kompakt angeordnet|arranged compactly/iu.test(
            document.querySelector('.notice')?.textContent || ''
        );`,
        [],
        5_000,
    );
    const layout = await session.evaluate<{
        rowCount: number;
        routeCount: number;
        nodeOverlaps: string[];
        nodeHeadersCovered: boolean;
        portsMatchHeaders: boolean;
        routeObstructions: string[];
        routeOverlaps: string[];
        rootInputPortCount: number;
    }>(`
        const nodeElements = [...document.querySelectorAll(
            '[data-testid="graph-canvas"] .joint-element'
        )];
        const nodes = nodeElements.map((element) => element.getBoundingClientRect());
        const rows = new Set(nodes.map((node) => Math.round(node.top)));
        const nodeOverlaps = [];
        for (let left = 0; left < nodeElements.length; left += 1) {
            for (let right = left + 1; right < nodeElements.length; right += 1) {
                const leftBounds = nodeElements[left].getBoundingClientRect();
                const rightBounds = nodeElements[right].getBoundingClientRect();
                if (leftBounds.left < rightBounds.right && leftBounds.right > rightBounds.left &&
                    leftBounds.top < rightBounds.bottom && leftBounds.bottom > rightBounds.top) {
                    nodeOverlaps.push(
                        nodeElements[left].getAttribute('model-id') + ':' +
                        nodeElements[right].getAttribute('model-id')
                    );
                }
            }
        }
        const connections = ${JSON.stringify(project.connections)};
        const routeObstructions = connections.flatMap((connection) => {
            const link = document.querySelector(
                '.joint-link[model-id="' + CSS.escape(connection.id) + '"] [joint-selector="line"]'
            );
            if (!link) return [connection.id + ':missing-path'];
            const matrix = link.getScreenCTM();
            const length = link.getTotalLength();
            if (!matrix || length <= 8) return [connection.id + ':invalid-path'];
            for (let distance = 4; distance < length - 4; distance += 4) {
                const local = link.getPointAtLength(distance);
                const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
                const crossedNode = nodeElements.find((element) => {
                    const id = element.getAttribute('model-id');
                    if (id === connection.source || id === connection.target) return false;
                    const bounds = element.getBoundingClientRect();
                    return point.x > bounds.left + 1 && point.x < bounds.right - 1 &&
                        point.y > bounds.top + 1 && point.y < bounds.bottom - 1;
                });
                if (crossedNode) {
                    return [connection.id + ':' + crossedNode.getAttribute('model-id')];
                }
            }
            return [];
        });
        const routeSamples = connections.flatMap((connection) => {
            const link = document.querySelector(
                '.joint-link[model-id="' + CSS.escape(connection.id) + '"] [joint-selector="line"]'
            );
            if (!link) return [];
            const matrix = link.getScreenCTM();
            const length = link.getTotalLength();
            if (!matrix || length <= 16) return [];
            const samples = new Set();
            for (let distance = 8; distance < length - 8; distance += 2) {
                const local = link.getPointAtLength(distance);
                const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
                samples.add(Math.round(point.x) + ':' + Math.round(point.y));
            }
            return [[connection.id, samples]];
        });
        const routeOverlaps = [];
        for (let left = 0; left < routeSamples.length; left += 1) {
            for (let right = left + 1; right < routeSamples.length; right += 1) {
                const shared = [...routeSamples[left][1]].filter((point) =>
                    routeSamples[right][1].has(point)
                );
                if (shared.length > 4) {
                    routeOverlaps.push(routeSamples[left][0] + ':' + routeSamples[right][0]);
                }
            }
        }
        const root = document.querySelector('.joint-element[model-id="website-root"]');
        const unselectedOutline = document.querySelector(
            '.joint-element[model-id="branch-a"] [joint-selector="outline"]'
        );
        const borderColor = unselectedOutline ? getComputedStyle(unselectedOutline).stroke : '';
        const portsMatchHeaders = nodeElements.every((element) => {
            const header = element.querySelector('[joint-selector="header"]');
            const ports = [...element.querySelectorAll('[joint-selector="portBody"]')];
            return header && ports.length > 0 && ports.every((port) =>
                getComputedStyle(port).fill === getComputedStyle(header).fill &&
                getComputedStyle(port).stroke === borderColor
            );
        });
        const nodeHeadersCovered = nodeElements.every((element) => {
            const header = element.querySelector('[joint-selector="header"]');
            const outline = element.querySelector('[joint-selector="outline"]');
            if (!(header instanceof SVGGraphicsElement) || !(outline instanceof SVGGraphicsElement)) {
                return false;
            }
            const headerBounds = header.getBBox();
            const outlineBounds = outline.getBBox();
            return Math.abs(headerBounds.x - outlineBounds.x) < 0.1 &&
                Math.abs(headerBounds.y - outlineBounds.y) < 0.1 &&
                Math.abs(headerBounds.width - outlineBounds.width) < 0.1 &&
                Boolean(header.compareDocumentPosition(outline) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        const rootInputPortCount = root.querySelectorAll('[port-group="in"]').length;
        return {
            rowCount: rows.size,
            routeCount: document.querySelectorAll('[data-testid="graph-canvas"] .joint-link').length,
            nodeOverlaps,
            nodeHeadersCovered,
            portsMatchHeaders,
            routeObstructions,
            routeOverlaps,
            rootInputPortCount,
        };
    `);
    assert.ok(layout.rowCount > 1, 'auto layout: a long workflow must wrap into multiple rows.');
    assert.equal(
        layout.routeCount,
        project.connections.length,
        'auto layout: every edge needs a route.',
    );
    assert.deepEqual(layout.nodeOverlaps, [], 'auto layout: nodes must never overlap.');
    assert.equal(
        (await session.state('[data-testid="graph-zoom-reset"]')).text,
        zoomBeforeLayout,
        'auto layout: manually arranging nodes must preserve the current zoom.',
    );
    assert.deepEqual(layout.routeObstructions, [], 'routing: edges must avoid unrelated nodes.');
    assert.deepEqual(layout.routeOverlaps, [], 'routing: edges must not overlap each other.');
    assert.equal(
        layout.nodeHeadersCovered,
        true,
        'graph: every node header must span the top edge beneath one continuous outline.',
    );
    assert.equal(
        layout.portsMatchHeaders,
        true,
        'graph: both port types must have their node header fill and a gray node border.',
    );
    assert.equal(
        layout.rootInputPortCount,
        2,
        'routing: concurrent inputs need separate ports on the website root.',
    );
    await session.screenshot(join(outputDirectory, 'graph-auto-layout.png'), true);

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

export async function verifyManualNodeMove(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create('Manual node move');
    const projectPath = join(outputDirectory, 'manual-node-move.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 5_000);
    const before = await graphNodeRects(session);
    await session.drag(
        '.joint-element[model-id="layer-1"] [joint-selector="body"]',
        '[data-testid="graph-canvas"]',
    );
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 5_000);
    const after = await graphNodeRects(session);
    assert.equal(after.length, 2, 'dragging must preserve both graph nodes');
    assert.deepEqual(
        after.find((node) => node.id === 'website-root'),
        before.find((node) => node.id === 'website-root'),
        'dragging one node must not move the root',
    );
    const moved = after.find((node) => node.id === 'layer-1');
    const original = before.find((node) => node.id === 'layer-1');
    assert.ok(moved && original && moved.x !== original.x, 'the dragged node must move');
    assert.equal(moved.visible, true, 'the dragged node must remain visible in the graph');
    await session.screenshot(join(outputDirectory, 'graph-manual-move.png'), true);
}

async function graphNodeRects(
    session: RemoteSession,
): Promise<Array<{ id: string; x: number; y: number; visible: boolean }>> {
    return session.evaluate(`
        const panel = document.querySelector('[data-testid="graph-canvas"]').getBoundingClientRect();
        return [...document.querySelectorAll('[data-testid="graph-canvas"] .joint-element')]
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    id: element.getAttribute('model-id'),
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    visible: rect.right > panel.left && rect.left < panel.right &&
                        rect.bottom > panel.top && rect.top < panel.bottom,
                };
            });
    `);
}

export async function verifyCenteredNodeInsertion(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    const project = ProjectFormat.create('Centered insertion');
    const projectPath = join(outputDirectory, 'centered-insertion.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'Centered insertion', 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
    await waitForStableGraph(session);
    await session.evaluate(`
        const graph = document.querySelector('[data-testid="graph-canvas"]');
        graph.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaX: 260,
            deltaY: 140,
        }));
    `);
    await session.click('[data-testid="graph-zoom-in"]');
    await session.click('[data-testid="graph-zoom-in"]');
    const existingBeforeInsertion = await graphNodeRects(session);
    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="node-category-browser"]');
    await session.click('[data-testid="add-javascript-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);
    await waitForStableGraph(session);
    const afterInsertion = await graphNodeRects(session);

    for (const original of existingBeforeInsertion) {
        assert.deepEqual(
            afterInsertion.find((node) => node.id === original.id),
            original,
            `graph: adding a node must not move ${original.id}.`,
        );
    }

    const centerOffset = await session.evaluate<{ x: number; y: number }>(`
        const graph = document.querySelector('[data-testid="graph-canvas"]')
            .getBoundingClientRect();
        const node = document.querySelector('[model-id="javascript-1"]')
            .getBoundingClientRect();
        return {
            x: (node.left + node.right) / 2 - (graph.left + graph.right) / 2,
            y: (node.top + node.bottom) / 2 - (graph.top + graph.bottom) / 2,
        };
    `);
    assert.ok(
        Math.abs(centerOffset.x) <= 2 && Math.abs(centerOffset.y) <= 2,
        `graph: new nodes must open in the visible center (${JSON.stringify(centerOffset)}).`,
    );
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 5_000);
    await waitForStableGraph(session);
    assert.deepEqual(
        await graphNodeRects(session),
        existingBeforeInsertion,
        'graph: deleting a node must not move the remaining nodes.',
    );
}

async function waitForStableGraph(session: RemoteSession): Promise<void> {
    await session.waitForScript(
        `const key = [...document.querySelectorAll(
            '[data-testid="graph-canvas"] .joint-element'
        )].map((element) => {
            const rect = element.getBoundingClientRect();
            return [
                element.getAttribute('model-id'),
                Math.round(rect.x),
                Math.round(rect.y)
            ].join(':');
        }).join('|');
        const previous = window.__directorGraphPositionCheck;
        window.__directorGraphPositionCheck = key;
        return previous === key;`,
        [],
        5_000,
    );
}
