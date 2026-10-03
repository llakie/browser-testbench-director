import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ExecutionController } from '../src/ui/client/core/execution-controller.js';
import { ProjectFormat } from '../src/ui/client/core/project-format.js';
import { workspaceExecutionMethods } from '../src/ui/client/components/workspace-execution-controller.js';

test('Execution Controller verhindert parallele Läufe', () => {
    const controller = new ExecutionController();
    const runId = controller.begin(['root', 'layer']);

    assert.equal(typeof runId, 'number');
    assert.equal(controller.begin(['layer']), null);
    assert.equal(controller.snapshot().running, true);
});

test('Execution Controller verfolgt aktive, erfolgreiche und fehlerhafte Nodes', () => {
    const controller = new ExecutionController();
    const runId = controller.begin(['root', 'layer'])!;

    controller.update(runId, 'root', 'running');
    assert.equal(controller.snapshot().activeNodeId, 'root');
    controller.update(runId, 'root', 'success');
    controller.update(runId, 'layer', 'running');
    controller.update(runId, 'layer', 'error', 'Layer failed');
    controller.complete(runId);

    assert.deepEqual(controller.snapshot(), {
        runId,
        running: false,
        activeNodeId: null,
        nodes: {
            root: { status: 'success' },
            layer: { status: 'error', error: 'Layer failed' },
        },
    });
});

test('Execution Controller markiert eine laufende Node beim Stoppen als abgebrochen', () => {
    const controller = new ExecutionController();
    const runId = controller.begin(['layer'])!;
    controller.update(runId, 'layer', 'running');

    assert.equal(controller.stop(), true);
    assert.equal(controller.snapshot().nodes['layer']?.status, 'cancelled');
    assert.equal(controller.update(runId, 'layer', 'success'), false);
});

test('Execution Controller schließt eine erfolgreich beendete aktive Node sichtbar ab', () => {
    const controller = new ExecutionController();
    const runId = controller.begin(['wait'])!;
    controller.update(runId, 'wait', 'running');

    assert.equal(controller.complete(runId), true);
    assert.equal(controller.snapshot().nodes['wait']?.status, 'success');
});

test('Execution Controller kann einen behobenen Node-Fehler zurücksetzen', () => {
    const controller = new ExecutionController();
    const runId = controller.begin(['input-1'])!;
    controller.update(runId, 'input-1', 'error', 'Missing file');
    controller.complete(runId);

    assert.equal(controller.clear('input-1'), true);
    assert.equal(controller.snapshot().nodes['input-1'], undefined);
});

test('Playback synchronizes the editor after a post-run state error', async () => {
    const controller = new ExecutionController();
    const project = ProjectFormat.create('Post-run state error');
    let published = 0;
    let viewState = controller.snapshot();
    const workspace = {
        project,
        executionController: controller,
        executionState: viewState,
        previewInitialization: null,
        remotePreviewSessionId: null,
        selectedBrowserTargetId: '',
        preparePlanInputs: async () => undefined,
        executeLocalPlan: async () => undefined,
        syncRemotePreview: async () => undefined,
        stopPlaybackAudio: async () => undefined,
        capturePreviewState: () => {
            throw new Error('state capture failed');
        },
        publishExecutionState: () => {
            published += 1;
            viewState = controller.snapshot();
        },
        showNotice: () => undefined,
        t: (key: string) => key,
        errorMessage: (error: unknown) => String(error),
        recordingWorkflow: false,
        restoreLocalPreview: async () => undefined,
    };

    const runPlayback = workspaceExecutionMethods.runPlayback!;
    const completed = await runPlayback.call(workspace, 'root');

    assert.equal(completed, false);
    assert.equal(controller.snapshot().running, false);
    assert.equal(viewState.running, false);
    assert.equal(published, 2);
});
