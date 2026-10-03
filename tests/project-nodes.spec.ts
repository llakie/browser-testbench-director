import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProjectNodes } from '../src/ui/client/core/project-nodes.js';
import { ProjectFormat } from '../src/ui/client/core/project-format.js';

test('Projekt-Nodes erzeugt alle editierbaren Node-Typen mit eindeutigen IDs', () => {
    const project = ProjectFormat.create();
    const input = ProjectNodes.createInput(project, 'Datei');
    project.nodes.push(input);
    const camera = ProjectNodes.createCameraCapability(project, 'Virtuelle Kamera');
    project.nodes.push(camera);
    const layer = ProjectNodes.createLayer(project, 'Layer');
    project.nodes.push(layer);
    const script = ProjectNodes.createJavaScript(project, 'JavaScript');
    project.nodes.push(script);
    const action = ProjectNodes.createBrowserAction(project, 'Klick');
    project.nodes.push(action);
    const wait = ProjectNodes.createBrowserWait(project, 'Warten');
    const merge = ProjectNodes.createMerge(project, 'Zusammenführen');
    const audio = ProjectNodes.createAudio(project, 'Ton');
    const output = ProjectNodes.createVideoOutput(project, 'Video');

    assert.equal(layer.id, 'layer-2');
    assert.equal(input.id, 'input-1');
    assert.equal(input.required, false);
    assert.equal(camera.capability, 'camera');
    assert.equal(camera.id, 'camera-1');
    assert.equal(script.id, 'javascript-1');
    assert.equal(layer.position, null);
    assert.equal(script.position, null);
    assert.equal(action.selector, 'button');
    assert.equal(wait.condition, 'element');
    assert.equal(wait.timeoutMs, 30_000);
    assert.equal(wait.omitFromRecording, true);
    assert.equal(merge.id, 'merge-1');
    assert.equal(merge.waitFor, 'all');
    assert.equal(audio.id, 'audio-1');
    assert.equal(audio.volume, 1);
    assert.deepEqual(audio.envelope, [
        { time: 0, gain: 1 },
        { time: 1, gain: 1 },
    ]);
    assert.equal(audio.waitForEnd, true);
    assert.equal(audio.loop, false);
    assert.equal(audio.fadeInMs, 0);
    assert.equal(audio.fadeOutMs, 0);
    assert.equal(output.type, 'video-output');
    assert.equal(output.targetId, '');
    assert.equal(output.filename, 'video.mp4');
});

test('Projekt-Nodes dupliziert Quellen ohne gemeinsame Referenzen', () => {
    const project = ProjectFormat.create();
    const original = project.nodes.find((node) => node.type === 'layer')!;
    const duplicate = ProjectNodes.duplicate(project, original, 'Kopie')!;

    assert.equal(duplicate.type, 'layer');

    if (duplicate.type !== 'layer') {
        throw new Error('Expected a layer duplicate.');
    }

    assert.equal(duplicate.position, null);
    duplicate.source.html = 'changed';
    duplicate.playback.removeAfter = true;
    assert.notEqual(original.source.html, duplicate.source.html);
    assert.equal(original.playback.removeAfter, false);
});

test('Website und Video-Ausgabe sind nicht duplizierbar', () => {
    const project = ProjectFormat.create();
    const website = project.nodes.find((node) => node.type === 'website')!;
    const output = ProjectNodes.createVideoOutput(project, 'Video');

    for (const node of [website, output]) {
        assert.equal(ProjectNodes.canDuplicate(node), false);
        assert.equal(ProjectNodes.duplicate(project, node, 'Kopie'), null);
    }

    const layer = project.nodes.find((node) => node.type === 'layer')!;
    assert.equal(ProjectNodes.canDuplicate(layer), true);
});

test('Projekt-Nodes dupliziert Audio-Hüllkurven ohne gemeinsame Referenzen', () => {
    const project = ProjectFormat.create();
    const original = ProjectNodes.createAudio(project, 'Audio');
    original.envelope = [
        { time: 0, gain: 0 },
        { time: 1, gain: 1 },
    ];
    const duplicate = ProjectNodes.duplicate(project, original, 'Audio copy');

    assert.equal(duplicate?.type, 'audio');

    if (duplicate?.type !== 'audio') {
        return;
    }

    duplicate.envelope[0] = { time: 0, gain: 1 };
    assert.equal(original.envelope[0]?.gain, 0);
});

test('Projekt-Nodes löscht eine Node samt Verbindungen, aber niemals die Website-Root', () => {
    const project = ProjectFormat.create();

    assert.equal(ProjectNodes.remove(project, 'website-root'), false);
    assert.equal(ProjectNodes.remove(project, 'layer-1'), true);
    assert.equal(project.nodes.length, 1);
    assert.deepEqual(project.connections, []);
});

test('Das Löschen eines Parent-Layers setzt abhängige Layer auf den Viewport zurück', () => {
    const project = ProjectFormat.create();
    const parent = project.nodes.find((node) => node.type === 'layer')!;
    const child = ProjectNodes.createLayer(project, 'Child');
    child.placement.reference = { type: 'layer', nodeId: parent.id };
    project.nodes.push(child);

    ProjectNodes.remove(project, parent.id);

    assert.deepEqual(child.placement.reference, { type: 'viewport' });
});
