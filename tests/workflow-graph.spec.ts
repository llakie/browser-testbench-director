import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProjectFormat } from '../src/ui/client/core/project-format.js';
import { WorkflowConnectionError, WorkflowGraph } from '../src/ui/client/core/workflow-graph.js';

test('Workflow-Graph erstellt eine lineare Verbindung', () => {
    const project = ProjectFormat.create();
    project.connections = [];

    assert.deepEqual(WorkflowGraph.createConnection(project, 'website-root', 'layer-1'), {
        id: 'website-root--layer-1',
        source: 'website-root',
        target: 'layer-1',
    });
});

test('Workflow-Graph verhindert mehrere Nachfolger und Vorgänger', () => {
    const project = ProjectFormat.create();
    project.nodes.push({
        id: 'second-layer',
        type: 'layer',
        name: 'Second layer',
        position: { x: 544, y: 8 },
        placement: {
            reference: { type: 'viewport' },
            horizontal: 'center',
            vertical: 'center',
        },
        playback: { durationMs: 0, removeAfter: false },
        source: { html: '', css: '', javascript: '' },
    });

    assert.throws(
        () => WorkflowGraph.createConnection(project, 'website-root', 'second-layer'),
        (error) => error instanceof WorkflowConnectionError && error.issue === 'source-occupied',
    );
    assert.throws(
        () => WorkflowGraph.createConnection(project, 'second-layer', 'layer-1'),
        (error) => error instanceof WorkflowConnectionError && error.issue === 'target-occupied',
    );
});

test('Workflow-Graph verhindert Rückverbindungen und Website-Root als Ziel', () => {
    const project = ProjectFormat.create();

    assert.throws(
        () => WorkflowGraph.createConnection(project, 'layer-1', 'website-root'),
        (error) => error instanceof WorkflowConnectionError && error.issue === 'website-target',
    );
});

test('Workflow-Graph erlaubt mehrere Input-Nodes vor der Website-Root', () => {
    const project = ProjectFormat.create();
    project.nodes.unshift(
        {
            id: 'image',
            type: 'input',
            name: 'Image',
            position: null,
            accept: 'image/*',
            required: true,
        },
        {
            id: 'font',
            type: 'input',
            name: 'Font',
            position: null,
            accept: 'font/*',
            required: false,
        },
    );

    const image = WorkflowGraph.createConnection(project, 'image', 'website-root');
    project.connections.push(image);
    const font = WorkflowGraph.createConnection(project, 'font', 'website-root');
    project.connections.push(font);

    assert.deepEqual(
        [...WorkflowGraph.connectedNodeIds(project)],
        ['website-root', 'layer-1', 'image', 'font'],
    );
    assert.doesNotThrow(() => ProjectFormat.parse(ProjectFormat.stringify(project)));
    assert.throws(
        () => WorkflowGraph.createConnection(project, 'image', 'layer-1'),
        (error) => error instanceof WorkflowConnectionError && error.issue === 'input-target',
    );
});

test('Workflow-Graph verbindet einen Datei-Input über die Kamera-Capability mit der Website', () => {
    const project = ProjectFormat.create();
    project.nodes.unshift(
        {
            id: 'camera-image',
            type: 'input',
            name: 'Camera image',
            position: null,
            accept: 'image/*',
            required: true,
        },
        {
            id: 'camera',
            type: 'capability',
            name: 'Virtual camera',
            position: null,
            capability: 'camera',
        },
    );

    project.connections.unshift(
        WorkflowGraph.createConnection(project, 'camera-image', 'camera'),
    );
    project.connections.unshift(WorkflowGraph.createConnection(project, 'camera', 'website-root'));

    assert.deepEqual(
        [...WorkflowGraph.connectedNodeIds(project)],
        ['website-root', 'layer-1', 'camera', 'camera-image'],
    );
    assert.doesNotThrow(() => ProjectFormat.parse(ProjectFormat.stringify(project)));
});
