import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    GraphAutoLayout,
    rebaseRouteToAnchors,
    type GraphEdgePoint,
} from '../src/ui/client/core/graph-auto-layout.js';
import { ProjectFormat, type JavaScriptNode } from '../src/ui/client/core/project-format.js';

test('ELK bricht einen langen Workflow kompakt in mehrere Zeilen um', async () => {
    const project = ProjectFormat.create();
    let previousId = 'layer-1';

    for (let index = 2; index <= 22; index += 1) {
        const node: JavaScriptNode = {
            id: `node-${index}`,
            type: 'javascript',
            name: `Node ${index}`,
            position: null,
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

test('ELK lays automatic nodes around stored node positions without overlaps', async () => {
    const project = ProjectFormat.create();
    project.nodes[0]!.position = { x: 24, y: 24 };
    project.nodes[1]!.position = null;

    for (let index = 2; index <= 8; index += 1) {
        project.nodes.push({
            id: `automatic-${index}`,
            type: 'javascript',
            name: `Automatic ${index}`,
            position: null,
            source: '',
        });
    }

    const positions = await GraphAutoLayout.positions(project.nodes, project.connections, 1.6);

    assert.deepEqual(positions.get(project.nodes[0]!.id), { x: 24, y: 24 });

    for (let left = 0; left < project.nodes.length; left += 1) {
        for (let right = left + 1; right < project.nodes.length; right += 1) {
            const a = positions.get(project.nodes[left]!.id)!;
            const b = positions.get(project.nodes[right]!.id)!;
            const overlaps =
                a.x < b.x + 216 && a.x + 216 > b.x && a.y < b.y + 112 && a.y + 112 > b.y;
            assert.equal(
                overlaps,
                false,
                `${project.nodes[left]!.id} and ${project.nodes[right]!.id} overlap.`,
            );
        }
    }
});

test('ELK positions parallel workflow branches', async () => {
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

    const positions = await GraphAutoLayout.positions(project.nodes, project.connections, 1.6);

    assert.equal(positions.size, project.nodes.length);
});

test('ELK routes are connected to offset JointJS ports without diagonal segments', () => {
    const route: GraphEdgePoint[] = [
        { x: 216, y: 56 },
        { x: 280, y: 56 },
        { x: 280, y: 200 },
        { x: 496, y: 200 },
        { x: 496, y: 112 },
        { x: 560, y: 112 },
    ];
    const rebased = rebaseRouteToAnchors(route, { x: 216, y: 72 }, { x: 560, y: 96 });

    assert.deepEqual(rebased[0], { x: 216, y: 72 });
    assert.deepEqual(rebased.at(-1), { x: 560, y: 96 });

    for (let index = 1; index < rebased.length; index += 1) {
        const previous = rebased[index - 1]!;
        const current = rebased[index]!;
        assert.ok(
            previous.x === current.x || previous.y === current.y,
            `Diagonal segment from ${previous.x},${previous.y} to ${current.x},${current.y}.`,
        );
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
});
