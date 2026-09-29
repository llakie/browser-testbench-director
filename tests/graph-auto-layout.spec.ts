import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GraphAutoLayout } from '../src/ui/client/core/graph-auto-layout.js';
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
