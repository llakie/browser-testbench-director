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

test('Workflow-Graph erlaubt parallele Nachfolger und führt sie nur über Merge zusammen', () => {
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
    project.nodes.push({
        id: 'merge',
        type: 'merge',
        name: 'Merge',
        position: null,
        waitFor: 'all',
    });

    project.connections.push(
        WorkflowGraph.createConnection(project, 'website-root', 'second-layer'),
    );
    assert.throws(
        () => WorkflowGraph.createConnection(project, 'second-layer', 'layer-1'),
        (error) => error instanceof WorkflowConnectionError && error.issue === 'target-occupied',
    );
    project.connections.push(
        WorkflowGraph.createConnection(project, 'layer-1', 'merge'),
        WorkflowGraph.createConnection(project, 'second-layer', 'merge'),
    );
    assert.doesNotThrow(() => ProjectFormat.parse(ProjectFormat.stringify(project)));
});

test('Workflow-Graph verhindert Rückverbindungen und Website-Root als Ziel', () => {
    const project = ProjectFormat.create();

    assert.throws(
        () => WorkflowGraph.createConnection(project, 'layer-1', 'website-root'),
        (error) => error instanceof WorkflowConnectionError && error.issue === 'website-target',
    );
});

test('Workflow-Graph behandelt den Video-Output als terminale Node', () => {
    const project = ProjectFormat.create();
    project.nodes.push({
        id: 'video-output',
        type: 'video-output',
        name: 'Video export',
        position: null,
        targetId: '',
        filename: 'video.mp4',
    });
    project.connections.push(WorkflowGraph.createConnection(project, 'layer-1', 'video-output'));

    assert.throws(
        () => WorkflowGraph.createConnection(project, 'video-output', 'layer-1'),
        (error) =>
            error instanceof WorkflowConnectionError && error.issue === 'video-output-source',
    );
    assert.doesNotThrow(() => ProjectFormat.parse(ProjectFormat.stringify(project)));
});

test('Workflow-Graph behandelt den Screenshot-Output als terminale Node', () => {
    const project = ProjectFormat.create();
    project.nodes.push({
        id: 'screenshot-output',
        type: 'screenshot-output',
        name: 'Screenshot export',
        position: null,
        targetId: '',
        filename: 'screenshot.jpg',
        format: 'jpeg',
        quality: 0.9,
    });
    project.connections.push(
        WorkflowGraph.createConnection(project, 'layer-1', 'screenshot-output'),
    );

    assert.throws(
        () => WorkflowGraph.createConnection(project, 'screenshot-output', 'layer-1'),
        (error) =>
            error instanceof WorkflowConnectionError && error.issue === 'screenshot-output-source',
    );
    assert.doesNotThrow(() => ProjectFormat.parse(ProjectFormat.stringify(project)));
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

    project.connections.unshift(WorkflowGraph.createConnection(project, 'camera-image', 'camera'));
    project.connections.unshift(WorkflowGraph.createConnection(project, 'camera', 'website-root'));

    assert.deepEqual(
        [...WorkflowGraph.connectedNodeIds(project)],
        ['website-root', 'layer-1', 'camera', 'camera-image'],
    );
    assert.doesNotThrow(() => ProjectFormat.parse(ProjectFormat.stringify(project)));
});

test('Workflow-Graph trennt Datei- und Ablauf-Eingang einer Audio-Node', () => {
    const project = ProjectFormat.create();
    project.nodes.push(
        {
            id: 'soundtrack',
            type: 'input',
            name: 'Soundtrack',
            position: null,
            accept: 'audio/*',
            required: true,
        },
        {
            id: 'play-soundtrack',
            type: 'audio',
            name: 'Soundtrack abspielen',
            position: null,
            volume: 0.8,
            envelope: [
                { time: 0, gain: 1 },
                { time: 1, gain: 1 },
            ],
            waitForEnd: false,
        },
    );
    project.connections.push(
        WorkflowGraph.createConnection(project, 'soundtrack', 'play-soundtrack'),
        WorkflowGraph.createConnection(project, 'layer-1', 'play-soundtrack'),
    );

    assert.doesNotThrow(() => ProjectFormat.parse(ProjectFormat.stringify(project)));
    assert.ok(WorkflowGraph.connectedNodeIds(project).has('soundtrack'));
    assert.throws(
        () => WorkflowGraph.createConnection(project, 'website-root', 'play-soundtrack'),
        (error) => error instanceof WorkflowConnectionError && error.issue === 'audio-target',
    );
});
