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
    let previousId = 'layer-1';

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
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 17, 5_000);

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
        allNodesInsideCanvas: boolean;
        nodeHeadersCovered: boolean;
        routeObstructions: string[];
        rootInputPortCount: number;
    }>(`
        const canvas = document.querySelector('[data-testid="graph-canvas"]').getBoundingClientRect();
        const nodeElements = [...document.querySelectorAll(
            '[data-testid="graph-canvas"] .joint-element'
        )];
        const nodes = nodeElements.map((element) => element.getBoundingClientRect());
        const rows = new Set(nodes.map((node) => Math.round(node.top)));
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
        const root = document.querySelector('.joint-element[model-id="website-root"]');
        const rootBounds = root.getBoundingClientRect();
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
        const rootInputPortCount = [...root.querySelectorAll('.joint-port')]
            .map((port) => port.getBoundingClientRect())
            .filter((port) => Math.abs((port.left + port.right) / 2 - rootBounds.left) < 3)
            .length;
        return {
            rowCount: rows.size,
            routeCount: document.querySelectorAll('[data-testid="graph-canvas"] .joint-link').length,
            allNodesInsideCanvas: nodes.every((node) =>
                node.left >= canvas.left - 1 && node.right <= canvas.right + 1 &&
                node.top >= canvas.top - 1 && node.bottom <= canvas.bottom + 1
            ),
            nodeHeadersCovered,
            routeObstructions,
            rootInputPortCount,
        };
    `);
    assert.ok(layout.rowCount > 1, 'auto layout: a long workflow must wrap into multiple rows.');
    assert.equal(
        layout.routeCount,
        project.connections.length,
        'auto layout: every edge needs a route.',
    );
    assert.equal(
        layout.allNodesInsideCanvas,
        true,
        'auto layout: fitted nodes must stay in the canvas.',
    );
    assert.deepEqual(layout.routeObstructions, [], 'routing: edges must avoid unrelated nodes.');
    assert.equal(
        layout.nodeHeadersCovered,
        true,
        'graph: every node header must span the top edge beneath one continuous outline.',
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
