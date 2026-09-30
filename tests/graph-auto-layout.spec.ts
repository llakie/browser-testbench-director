import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GraphAutoLayout, type GraphEdgePoint } from '../src/ui/client/core/graph-auto-layout.js';
import { ProjectFormat, type JavaScriptNode } from '../src/ui/client/core/project-format.js';

test('ELK bricht einen langen Workflow kompakt in mehrere Zeilen um', async () => {
    const project = ProjectFormat.create();
    let previousId = 'layer-1';

    for (let index = 2; index <= 22; index += 1) {
        const node: JavaScriptNode = {
            id: `node-${index}`,
            type: 'javascript',
            name: `Node ${index}`,
            position: { x: index * 280, y: 8 },
            source: '',
        };
        project.nodes.push(node);
        project.connections.push({
            id: `${previousId}--${node.id}`,
            source: previousId,
            target: node.id,
        });
        previousId = node.id;
    }

    const positions = await GraphAutoLayout.positions(project.nodes, project.connections, 1.6);
    const arranged = [...positions.values()];
    const distinctRows = new Set(arranged.map((position) => position.y));
    const width = Math.max(...arranged.map((position) => position.x + 216));

    assert.equal(positions.size, project.nodes.length);
    assert.ok(distinctRows.size >= 4, 'Der lineare Graph muss in mehrere Zeilen umbrechen.');
    assert.ok(width < 2_000, `Der umgebrochene Graph ist zu breit: ${width}px.`);

    for (let left = 0; left < arranged.length; left += 1) {
        for (let right = left + 1; right < arranged.length; right += 1) {
            const a = arranged[left]!;
            const b = arranged[right]!;
            const overlaps =
                a.x < b.x + 216 && a.x + 216 > b.x && a.y < b.y + 112 && a.y + 112 > b.y;
            assert.equal(overlaps, false, `Nodes ${left} und ${right} überlappen sich.`);
        }
    }
});

test('ELK routes parallel workflow branches without overlapping edge segments', async () => {
    const project = ProjectFormat.create();
    const branchNodes = ['branch-a', 'branch-b', 'branch-c', 'merge'].map((id): JavaScriptNode => ({
        id,
        type: 'javascript',
        name: id,
        position: null,
        source: '',
    }));
    project.nodes.push(...branchNodes);
    project.connections.push(
        { id: 'root-a', source: 'layer-1', target: 'branch-a' },
        { id: 'root-b', source: 'layer-1', target: 'branch-b' },
        { id: 'root-c', source: 'layer-1', target: 'branch-c' },
        { id: 'a-merge', source: 'branch-a', target: 'merge' },
        { id: 'b-merge', source: 'branch-b', target: 'merge' },
        { id: 'c-merge', source: 'branch-c', target: 'merge' },
    );

    const layout = await GraphAutoLayout.layout(project.nodes, project.connections, 1.6);
    const routes = [...layout.routes.entries()];

    assert.equal(routes.length, project.connections.length);

    for (const [connectionId, route] of routes) {
        assert.ok(route.length >= 2, `${connectionId} has no usable route.`);

        for (let index = 1; index < route.length; index += 1) {
            const previous = route[index - 1]!;
            const current = route[index]!;
            assert.ok(
                previous.x === current.x || previous.y === current.y,
                `${connectionId} is not routed orthogonally.`,
            );
        }
    }

    for (let left = 0; left < routes.length; left += 1) {
        for (let right = left + 1; right < routes.length; right += 1) {
            assert.equal(
                routesOverlap(routes[left]![1], routes[right]![1]),
                false,
                `${routes[left]![0]} and ${routes[right]![0]} overlap.`,
            );
        }
    }
});

test('ELK wraps a long workflow with side branches into distinct compact lanes', async () => {
    const project = ProjectFormat.create();
    let previousId = 'layer-1';

    for (let index = 2; index <= 20; index += 1) {
        const nodeId = `main-${index}`;
        project.nodes.push({
            id: nodeId,
            type: 'javascript',
            name: nodeId,
            position: null,
            source: '',
        });
        project.connections.push({
            id: `${previousId}--${nodeId}`,
            source: previousId,
            target: nodeId,
        });

        if (index % 3 === 0) {
            const sideId = `side-${index}`;
            project.nodes.push({
                id: sideId,
                type: 'javascript',
                name: sideId,
                position: null,
                source: '',
            });
            project.connections.push({
                id: `${nodeId}--${sideId}`,
                source: nodeId,
                target: sideId,
            });
        }

        previousId = nodeId;
    }

    const layout = await GraphAutoLayout.layout(project.nodes, project.connections, 1.6);
    const positions = [...layout.positions.values()];
    const width = Math.max(...positions.map((position) => position.x + 216));
    const rows = new Set(positions.map((position) => position.y));

    assert.ok(rows.size >= 4, 'A branched workflow must wrap into several rows.');
    assert.ok(width < 2_000, `The branched workflow is too wide: ${width}px.`);

    const routes = [...layout.routes.entries()];

    for (let left = 0; left < routes.length; left += 1) {
        for (let right = left + 1; right < routes.length; right += 1) {
            assert.equal(
                routesOverlap(routes[left]![1], routes[right]![1]),
                false,
                `${routes[left]![0]} and ${routes[right]![0]} overlap.`,
            );
        }
    }
});

function routesOverlap(left: readonly GraphEdgePoint[], right: readonly GraphEdgePoint[]): boolean {
    return segments(left).some((leftSegment) =>
        segments(right).some((rightSegment) => segmentsOverlap(leftSegment, rightSegment)),
    );
}

function segments(route: readonly GraphEdgePoint[]): [GraphEdgePoint, GraphEdgePoint][] {
    return route.slice(1).map((point, index) => [route[index]!, point]);
}

function segmentsOverlap(
    [leftStart, leftEnd]: [GraphEdgePoint, GraphEdgePoint],
    [rightStart, rightEnd]: [GraphEdgePoint, GraphEdgePoint],
): boolean {
    const leftVertical = leftStart.x === leftEnd.x;
    const rightVertical = rightStart.x === rightEnd.x;

    if (leftVertical !== rightVertical) {
        return false;
    }

    if (leftVertical && leftStart.x !== rightStart.x) {
        return false;
    }

    if (!leftVertical && leftStart.y !== rightStart.y) {
        return false;
    }

    const leftRange = leftVertical ? [leftStart.y, leftEnd.y] : [leftStart.x, leftEnd.x];
    const rightRange = rightVertical ? [rightStart.y, rightEnd.y] : [rightStart.x, rightEnd.x];
    const overlap =
        Math.min(Math.max(...leftRange), Math.max(...rightRange)) -
        Math.max(Math.min(...leftRange), Math.min(...rightRange));
    return overlap > 0.01;
}
