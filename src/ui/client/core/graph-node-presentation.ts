import type { dia } from '@joint/core';

import type { NodeExecutionState } from './execution-controller.js';
import type { DirectorNode } from './project-format.js';

const colors = {
    accent: 'var(--color-accent)',
    audio: 'var(--color-node-audio)',
    border: 'var(--color-border)',
    cancelled: 'var(--color-status-cancelled)',
    dangerSoft: 'var(--color-danger-soft)',
    error: 'var(--color-status-error)',
    headerText: 'var(--color-node-header-text)',
    nodeControl: 'var(--color-node-control)',
    nodeSurface: 'var(--color-node-surface)',
    onStrong: 'var(--color-on-strong)',
    pending: 'var(--color-status-pending)',
    play: 'var(--color-play)',
    recording: 'var(--color-recording-strong)',
    running: 'var(--color-status-running)',
    success: 'var(--color-status-success)',
    text: 'var(--color-text)',
} as const;

const nodeColors: Record<DirectorNode['type'], string> = {
    audio: 'var(--color-node-audio)',
    'browser-action': 'var(--color-node-action)',
    'browser-wait': 'var(--color-node-wait)',
    capability: 'var(--color-node-capability)',
    input: 'var(--color-node-input)',
    javascript: 'var(--color-node-javascript)',
    layer: 'var(--color-node-layer)',
    merge: 'var(--color-node-merge)',
    'video-output': 'var(--color-recording-strong)',
    'screenshot-output': 'var(--color-recording-strong)',
    website: 'var(--color-node-website)',
};

const playIcon =
    'M12.5 4a.5.5 0 0 0-1 0v3.248L5.233 3.612C4.693 3.3 4 3.678 4 4.308v7.384c0 .63.692 1.01 1.233.697L11.5 8.753V12a.5.5 0 0 0 1 0z';
const recordIcon = 'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8';
const stopIcon = 'M5 5h6v6H5z';
const pendingIcon = 'M 194 12.5 V 17 L 197 18.5';
const pauseIcon = 'M 192 14 V 20 M 196 14 V 20';

export interface GraphNodePresentationState {
    readonly selected: boolean;
    readonly connected: boolean;
    readonly execution?: NodeExecutionState;
    readonly executionRunning: boolean;
    readonly pausedAudio: boolean;
    readonly stale: boolean;
    readonly locked: boolean;
    readonly stoppingPlayback: boolean;
    readonly stoppingRecording: boolean;
    readonly recordingReady: boolean;
    readonly inputFileName?: string;
    readonly chooseFileLabel: string;
}

export class GraphNodePresentation {
    static attributes(
        node: DirectorNode,
        state: GraphNodePresentationState,
    ): Record<string, Record<string, unknown>> {
        const input = node.type === 'input';
        const audio = node.type === 'audio';
        const output = node.type === 'video-output' || node.type === 'screenshot-output';
        const hidesPlayControl = input || node.type === 'capability' || audio;
        const playingCanStop = state.stoppingPlayback || state.stoppingRecording;
        const playUnavailable = output && !state.recordingReady && !state.stoppingRecording;
        const playLocked = state.locked && !playingCanStop;
        const playDisabled = playUnavailable || playLocked;
        const hasInputFile = Boolean(state.inputFileName);
        const headerColor = GraphNodePresentation.headerColor(node);

        return {
            root: { cursor: 'pointer', opacity: state.locked ? 0.62 : 1 },
            body: { fill: colors.nodeSurface, stroke: 'none', rx: 12, ry: 12 },
            header: { fill: headerColor, stroke: headerColor },
            outline: {
                stroke: GraphNodePresentation.borderColor(state.selected, state.execution),
                strokeWidth: state.selected ? 2 : 1,
                strokeDasharray: state.connected ? 'none' : '5 4',
            },
            headerText: {
                text: GraphNodePresentation.headerLabel(node),
                fill: colors.headerText,
                fontFamily: 'ui-monospace, monospace',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 1.4,
            },
            bodyText: {
                text: GraphNodePresentation.bodyText(node),
                fill: colors.text,
                fontFamily: 'Inter, ui-sans-serif, system-ui',
                fontSize: 13,
                fontWeight: 650,
                lineHeight: 20,
            },
            playButton: {
                display: hidesPlayControl ? 'none' : 'block',
                class: state.stale ? 'is-stale' : '',
                cursor: playDisabled ? 'not-allowed' : 'pointer',
                pointerEvents: playDisabled ? 'none' : 'auto',
                opacity: playDisabled ? 0.35 : 1,
                fill: output ? colors.dangerSoft : colors.nodeControl,
                stroke: output ? colors.recording : colors.play,
                strokeWidth: state.stale ? 2.5 : 1,
            },
            playIcon: {
                display: hidesPlayControl ? 'none' : 'block',
                d: playingCanStop ? stopIcon : output ? recordIcon : playIcon,
                fill: output ? colors.recording : colors.play,
                opacity: playLocked ? 0.35 : 1,
            },
            fileButton: { display: input && !hasInputFile ? 'block' : 'none' },
            fileButtonText: {
                display: input && !hasInputFile ? 'block' : 'none',
                text: state.chooseFileLabel,
            },
            fileName: {
                display: hasInputFile ? 'block' : 'none',
                text: GraphNodePresentation.ellipsize(state.inputFileName ?? '', 27),
            },
            clearButton: { display: hasInputFile ? 'block' : 'none' },
            clearText: { display: hasInputFile ? 'block' : 'none' },
            statusRing: GraphNodePresentation.statusRing(state),
            statusIcon: GraphNodePresentation.statusIcon(state),
            statusText: GraphNodePresentation.statusText(state.execution),
        };
    }

    static title(node: DirectorNode, connected: boolean, disconnectedLabel: string): string {
        const detail = GraphNodePresentation.detail(node);
        return [connected ? '' : disconnectedLabel, detail].filter(Boolean).join(' · ');
    }

    static headerColor(node: DirectorNode): string {
        if (node.type === 'javascript' && node.delay) {
            return nodeColors['browser-wait'];
        }

        return nodeColors[node.type];
    }

    static borderColor(selected: boolean, state?: NodeExecutionState): string {
        if (state?.status === 'error') {
            return colors.error;
        }

        if (selected) {
            return colors.accent;
        }

        if (state?.status === 'running') {
            return colors.running;
        }

        return colors.border;
    }

    static portGroups(fill: string): Record<string, dia.Element.PortGroup> {
        const port = (magnet: boolean | 'passive'): Record<string, unknown> => ({
            r: 6,
            fill,
            stroke: colors.border,
            strokeWidth: 2,
            magnet,
            cursor: 'crosshair',
        });

        return {
            in: { position: { name: 'left' }, attrs: { portBody: port('passive') } },
            out: { position: { name: 'right' }, attrs: { portBody: port(true) } },
        };
    }

    private static headerLabel(node: DirectorNode): string {
        const labels: Partial<Record<DirectorNode['type'], string>> = {
            website: 'ROOT',
            input: 'INPUT',
            capability: 'CAPABILITY',
            merge: 'MERGE',
            audio: 'AUDIO',
            'video-output': 'VIDEO',
            'screenshot-output': 'SCREENSHOT',
            javascript: 'JS',
            'browser-action': 'ACTION',
            'browser-wait': 'WAIT',
        };

        if (node.type === 'layer') {
            return node.text ? 'TEXT' : 'LAYER';
        }

        if (node.type === 'javascript' && node.delay) {
            return 'DELAY';
        }

        return labels[node.type] ?? '';
    }

    private static bodyText(node: DirectorNode): string {
        let detail: string;

        if (node.type === 'website') {
            detail = node.url ? GraphNodePresentation.ellipsize(node.url, 28) : 'URL';
        } else if (node.type === 'input') {
            detail = '';
        } else if (node.type === 'capability') {
            detail = 'Virtual camera';
        } else if (node.type === 'layer') {
            detail = node.text
                ? node.text.lines.map((line) => line.text).join(' · ')
                : 'HTML  ·  CSS  ·  JS';
        } else if (node.type === 'merge') {
            detail = `Wait ${node.waitFor}`;
        } else if (node.type === 'audio') {
            detail = `${Math.round(node.volume * 100)} % · ${node.waitForEnd ? 'Wait' : 'Continue'}`;
        } else if (node.type === 'video-output') {
            detail = `${node.filename} · ${node.targetId || 'Select target'}`;
        } else if (node.type === 'screenshot-output') {
            detail = `${node.filename} · ${node.targetId || 'Select target'}`;
        } else if (node.type === 'javascript') {
            detail = node.delay ? `${node.delay.durationMs} ms` : 'JavaScript';
        } else if (node.type === 'browser-action') {
            detail = `Click · ${node.selector}`;
        } else if (node.condition === 'element') {
            detail = `Element · ${node.selector}`;
        } else if (node.condition === 'url') {
            detail = `URL · ${node.value}`;
        } else {
            detail = 'Script';
        }

        return `${GraphNodePresentation.ellipsize(node.name, 27)}\n${GraphNodePresentation.ellipsize(detail, 27)}`;
    }

    private static detail(node: DirectorNode): string {
        if (node.type === 'javascript' && node.delay) {
            return `${node.delay.durationMs} ms`;
        }

        if (node.type === 'browser-action') {
            return node.selector;
        }

        if (node.type === 'browser-wait' && node.condition === 'element') {
            return node.selector;
        }

        return '';
    }

    private static ellipsize(value: string, maximumLength: number): string {
        const characters = Array.from(value);

        if (characters.length <= maximumLength) {
            return value;
        }

        return `${characters.slice(0, maximumLength - 1).join('')}…`;
    }

    private static statusRing(state: GraphNodePresentationState): Record<string, unknown> {
        const execution = state.execution;

        if (!execution || (execution.status === 'idle' && !state.executionRunning)) {
            return { display: 'none' };
        }

        const statusColors = {
            idle: colors.pending,
            running: colors.running,
            success: colors.success,
            error: colors.error,
            cancelled: colors.cancelled,
        } as const;
        const status = state.pausedAudio
            ? 'paused'
            : execution.status === 'idle'
              ? 'pending'
              : execution.status;
        const outlined = state.pausedAudio || ['idle', 'running'].includes(execution.status);
        return {
            display: 'block',
            class: `graph-node-status is-${status}`,
            fill: state.pausedAudio
                ? colors.nodeSurface
                : outlined
                  ? 'none'
                  : statusColors[execution.status],
            stroke: state.pausedAudio ? colors.audio : statusColors[execution.status],
            strokeWidth: outlined ? 2 : 0,
            strokeDasharray: execution.status === 'running' && !state.pausedAudio ? '8 5' : 'none',
        };
    }

    private static statusIcon(state: GraphNodePresentationState): Record<string, unknown> {
        const pending = state.executionRunning && state.execution?.status === 'idle';
        return {
            display: pending || state.pausedAudio ? 'block' : 'none',
            class: state.pausedAudio ? 'graph-node-paused-icon' : 'graph-node-pending-icon',
            d: state.pausedAudio ? pauseIcon : pendingIcon,
            stroke: state.pausedAudio ? colors.audio : colors.pending,
        };
    }

    private static statusText(state?: NodeExecutionState): Record<string, unknown> {
        const text =
            state?.status === 'success'
                ? '✓'
                : state?.status === 'error'
                  ? '!'
                  : state?.status === 'cancelled'
                    ? '■'
                    : '';
        return {
            text,
            fill:
                state?.status === 'success' || state?.status === 'error'
                    ? colors.onStrong
                    : colors.text,
        };
    }
}
