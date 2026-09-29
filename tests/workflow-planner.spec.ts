import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProjectFormat, type DirectorProject } from '../src/ui/client/core/project-format.js';
import { WorkflowPlanner } from '../src/ui/client/core/workflow-planner.js';

function projectWithScript(): DirectorProject {
    const project = ProjectFormat.create();
    project.nodes.push({
        id: 'reveal-price',
        type: 'javascript',
        name: 'Reveal price',
        position: { x: 544, y: 8 },
        source: "document.body.dataset.price = 'revealed';",
    });
    project.connections.push({
        id: 'layer-1--reveal-price',
        source: 'layer-1',
        target: 'reveal-price',
    });
    return project;
}

test('Workflow-Wiedergabe startet an der Website und spielt alle Nodes live', () => {
    const project = projectWithScript();
    project.nodes.unshift({
        id: 'image',
        type: 'input',
        name: 'Image',
        position: null,
        accept: 'image/*',
        required: true,
    });
    project.connections.unshift({
        id: 'image--website-root',
        source: 'image',
        target: 'website-root',
    });
    const plan = WorkflowPlanner.plan(project, 'workflow');

    assert.equal(plan.resetWebsite, true);
    assert.equal(plan.website?.id, 'website-root');
    assert.deepEqual(
        plan.inputs.map((input) => input.id),
        ['image'],
    );
    assert.deepEqual(
        plan.steps.map((step) => [step.node.id, step.speed]),
        [
            ['layer-1', 'live'],
            ['reveal-price', 'live'],
        ],
    );
});

test('Workflow-Plan bewahrt parallele Abhängigkeiten und den Merge', () => {
    const project = ProjectFormat.create();
    project.nodes.push(
        {
            id: 'parallel-layer',
            type: 'layer',
            name: 'Parallel layer',
            position: null,
            placement: {
                reference: { type: 'viewport' },
                horizontal: 'center',
                vertical: 'center',
            },
            playback: { durationMs: 10, removeAfter: true },
            source: { html: '', css: '', javascript: '' },
        },
        { id: 'merge', type: 'merge', name: 'Merge', position: null, waitFor: 'all' },
    );
    project.connections = [
        { id: 'website-root--layer-1', source: 'website-root', target: 'layer-1' },
        {
            id: 'website-root--parallel-layer',
            source: 'website-root',
            target: 'parallel-layer',
        },
        { id: 'layer-1--merge', source: 'layer-1', target: 'merge' },
        { id: 'parallel-layer--merge', source: 'parallel-layer', target: 'merge' },
    ];

    const plan = WorkflowPlanner.plan(project, 'workflow');

    assert.deepEqual(
        plan.steps.map((entry) => [entry.node.id, entry.after]),
        [
            ['layer-1', []],
            ['parallel-layer', []],
            ['merge', ['layer-1', 'parallel-layer']],
        ],
    );
});

test('Root-Wiedergabe lädt nur die Website und verlangt noch keine Eingabedateien', () => {
    const project = projectWithScript();
    project.nodes.unshift({
        id: 'required-image',
        type: 'input',
        name: 'Required image',
        position: null,
        accept: 'image/*',
        required: true,
    });
    project.connections.unshift({
        id: 'required-image--website-root',
        source: 'required-image',
        target: 'website-root',
    });

    const plan = WorkflowPlanner.plan(project, 'root');

    assert.equal(plan.resetWebsite, true);
    assert.equal(plan.website?.id, 'website-root');
    assert.deepEqual(plan.inputs, []);
    assert.deepEqual(plan.steps, []);
});

test('Planer leitet die virtuelle Kamera aus der Capability-Verbindung ab', () => {
    const project = projectWithScript();
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
        { id: 'camera-image--camera', source: 'camera-image', target: 'camera' },
        { id: 'camera--website-root', source: 'camera', target: 'website-root' },
    );

    const plan = WorkflowPlanner.plan(project, 'workflow');

    assert.equal(plan.cameraInputId, 'camera-image');
    assert.deepEqual(
        plan.inputs.map((input) => input.id),
        ['camera-image'],
    );
});

test('Node-Wiedergabe rekonstruiert Vorgänger und stoppt an der gewählten Node', () => {
    const project = projectWithScript();
    project.nodes.push({
        id: 'after-reveal',
        type: 'javascript',
        name: 'After reveal',
        position: { x: 808, y: 8 },
        source: "document.body.dataset.after = 'true';",
    });
    project.connections.push({
        id: 'reveal-price--after-reveal',
        source: 'reveal-price',
        target: 'after-reveal',
    });

    const plan = WorkflowPlanner.plan(project, 'node', 'reveal-price');

    assert.equal(plan.resetWebsite, true);
    assert.deepEqual(
        plan.steps.map((step) => [step.node.id, step.speed]),
        [
            ['layer-1', 'catchup'],
            ['reveal-price', 'live'],
        ],
    );
});

test('Sekundäre Einzelwiedergabe verändert den bestehenden Website-Zustand ohne Reset', () => {
    const plan = WorkflowPlanner.plan(projectWithScript(), 'current', 'reveal-price');

    assert.equal(plan.resetWebsite, false);
    assert.deepEqual(
        plan.steps.map((step) => step.node.id),
        ['reveal-price'],
    );
});

test('Planer weist unbekannte oder nicht ausführbare Nodes zurück', () => {
    assert.throws(
        () => WorkflowPlanner.plan(projectWithScript(), 'node', 'website-root'),
        /Executable node not found/u,
    );
});

test('Workflow-Reihenfolge folgt den Verbindungen und nicht dem Node-Array', () => {
    const project = projectWithScript();
    project.nodes.reverse();

    const plan = WorkflowPlanner.plan(project, 'workflow');

    assert.deepEqual(
        plan.steps.map((step) => step.node.id),
        ['layer-1', 'reveal-price'],
    );
});
