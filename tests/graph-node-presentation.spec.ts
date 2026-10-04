import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NodeExecutionState } from '../src/ui/client/core/execution-controller.js';
import {
    GraphNodePresentation,
    type GraphNodePresentationState,
} from '../src/ui/client/core/graph-node-presentation.js';
import type { DirectorNode, LayerNode } from '../src/ui/client/core/project-format.js';

const layer: LayerNode = {
    id: 'layer',
    type: 'layer',
    name: 'Layer',
    position: null,
    placement: {
        reference: { type: 'viewport' },
        horizontal: 'center',
        vertical: 'center',
    },
    playback: { durationMs: 0, removeAfter: false },
    source: { html: '', css: '', javascript: '' },
};

function state(
    execution?: NodeExecutionState,
    overrides: Partial<GraphNodePresentationState> = {},
): GraphNodePresentationState {
    return {
        selected: false,
        connected: true,
        execution,
        executionRunning: false,
        pausedAudio: false,
        stale: false,
        locked: false,
        stoppingPlayback: false,
        stoppingRecording: false,
        recordingReady: true,
        chooseFileLabel: 'Choose file',
        ...overrides,
    };
}

function attributes(
    node: DirectorNode,
    presentationState: GraphNodePresentationState,
): Record<string, Record<string, unknown>> {
    return GraphNodePresentation.attributes(node, presentationState);
}

test('Graph node presentation maps execution states consistently', () => {
    const pending = attributes(layer, state({ status: 'idle' }, { executionRunning: true }));
    assert.equal(pending.statusRing?.class, 'graph-node-status is-pending');
    assert.equal(pending.statusIcon?.display, 'block');

    const running = attributes(layer, state({ status: 'running' }));
    assert.equal(running.statusRing?.class, 'graph-node-status is-running');
    assert.equal(running.statusRing?.strokeDasharray, '8 5');

    const success = attributes(layer, state({ status: 'success' }));
    assert.equal(success.statusText?.text, '✓');

    const error = attributes(layer, state({ status: 'error' }, { selected: true }));
    assert.equal(error.outline?.stroke, 'var(--color-status-error)');
    assert.equal(error.statusText?.text, '!');

    const cancelled = attributes(layer, state({ status: 'cancelled' }));
    assert.equal(cancelled.statusText?.text, '■');
});

test('Graph node presentation distinguishes paused, stale, and disconnected nodes', () => {
    const paused = attributes(
        {
            id: 'audio',
            type: 'audio',
            name: 'Music',
            position: null,
            volume: 1,
            envelope: [],
            waitForEnd: false,
        },
        state({ status: 'running' }, { pausedAudio: true }),
    );
    assert.equal(paused.statusRing?.class, 'graph-node-status is-paused');
    assert.equal(paused.statusIcon?.class, 'graph-node-paused-icon');

    const stale = attributes(layer, state(undefined, { stale: true }));
    assert.equal(stale.playButton?.class, 'is-stale');
    assert.equal(GraphNodePresentation.title(layer, false, 'Not connected'), 'Not connected');
});

test('Graph node presentation distinguishes a visual delay from raw JavaScript', () => {
    const delay: DirectorNode = {
        id: 'delay',
        type: 'javascript',
        name: 'Pause',
        position: null,
        source: 'await director.wait(1200);',
        delay: { durationMs: 1_200 },
    };
    const presentation = attributes(delay, state());

    assert.equal(presentation.headerText?.text, 'DELAY');
    assert.equal(presentation.header?.fill, 'var(--color-node-wait)');
    assert.match(String(presentation.bodyText?.text), /1200 ms/u);
});

test('Graph node presentation exposes stop controls only for active playback and recording', () => {
    const stoppingPlayback = attributes(layer, state(undefined, { stoppingPlayback: true }));
    assert.equal(stoppingPlayback.playIcon?.d, 'M5 5h6v6H5z');

    const videoOutput: DirectorNode = {
        id: 'video',
        type: 'video-output',
        name: 'Video',
        position: null,
        targetId: '',
        filename: 'video.mp4',
    };
    const unavailable = attributes(videoOutput, state(undefined, { recordingReady: false }));
    assert.equal(unavailable.playButton?.pointerEvents, 'none');

    const screenshotOutput: DirectorNode = {
        id: 'screenshot',
        type: 'screenshot-output',
        name: 'Screenshot',
        position: null,
        targetId: '',
        filename: 'screenshot.jpg',
        format: 'jpeg',
        quality: 0.9,
    };
    const screenshotUnavailable = attributes(
        screenshotOutput,
        state(undefined, { recordingReady: false }),
    );
    assert.equal(screenshotUnavailable.playButton?.pointerEvents, 'none');
    assert.equal(screenshotUnavailable.headerText?.text, 'SCREENSHOT');

    const stoppingRecording = attributes(
        videoOutput,
        state(undefined, { recordingReady: false, stoppingRecording: true, locked: true }),
    );
    assert.equal(stoppingRecording.playButton?.pointerEvents, 'auto');
    assert.equal(stoppingRecording.playIcon?.d, 'M5 5h6v6H5z');
});
