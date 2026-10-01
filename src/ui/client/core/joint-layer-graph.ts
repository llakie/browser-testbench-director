import { dia, shapes } from '@joint/core';

import type { NodeExecutionState } from './execution-controller.js';
import {
    GraphAutoLayout,
    type GraphEdgePoint,
    type GraphNodePosition,
} from './graph-auto-layout.js';
import type { DirectorNode, WorkflowConnection } from './project-format.js';

const graphNodeSize = { width: 216, height: 112 } as const;

const GraphNode = dia.Element.define(
    'director.Node',
    {
        size: graphNodeSize,
        attrs: {
            body: { width: 216, height: 112, rx: 12, ry: 12 },
            header: {
                d: 'M 0 12 A 12 12 0 0 1 12 0 H 204 A 12 12 0 0 1 216 12 V 34 H 0 Z',
            },
            outline: {
                width: 216,
                height: 112,
                rx: 12,
                ry: 12,
                fill: 'none',
                pointerEvents: 'none',
            },
            headerText: { x: 14, y: 21, textAnchor: 'start' },
            bodyText: { x: 14, y: 58, textAnchor: 'start' },
            statusRing: { cx: 194, cy: 17, r: 7, display: 'none' },
            statusText: {
                x: 194,
                y: 20,
                textAnchor: 'middle',
                fontFamily: 'ui-sans-serif, system-ui',
                fontSize: 9,
                fontWeight: 900,
                pointerEvents: 'none',
            },
            statusIcon: {
                d: 'M 194 12.5 V 17 L 197 18.5',
                fill: 'none',
                stroke: 'var(--color-status-pending)',
                strokeWidth: 1.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                pointerEvents: 'none',
                display: 'none',
            },
            playButton: {
                cx: 190,
                cy: 85,
                r: 14,
                fill: 'var(--color-node-control)',
                stroke: 'var(--color-border-strong)',
                cursor: 'pointer',
                event: 'node:play',
            },
            playIcon: {
                d: 'M12.5 4a.5.5 0 0 0-1 0v3.248L5.233 3.612C4.693 3.3 4 3.678 4 4.308v7.384c0 .63.692 1.01 1.233.697L11.5 8.753V12a.5.5 0 0 0 1 0z',
                transform: 'translate(180 75) scale(1.25)',
                fill: 'var(--color-play)',
                stroke: 'none',
                cursor: 'pointer',
                pointerEvents: 'none',
            },
            fileButton: {
                x: 14,
                y: 69,
                width: 142,
                height: 26,
                rx: 6,
                ry: 6,
                fill: 'var(--color-node-control)',
                stroke: 'var(--color-border-strong)',
                cursor: 'pointer',
                event: 'input:choose',
                display: 'none',
            },
            fileButtonText: {
                x: 85,
                y: 86,
                textAnchor: 'middle',
                fill: 'var(--color-text)',
                fontFamily: 'Inter, ui-sans-serif, system-ui',
                fontSize: 10,
                fontWeight: 700,
                pointerEvents: 'none',
                display: 'none',
            },
            fileName: {
                x: 14,
                y: 86,
                fill: 'var(--color-text-muted)',
                fontFamily: 'Inter, ui-sans-serif, system-ui',
                fontSize: 10,
                pointerEvents: 'none',
                display: 'none',
            },
            clearButton: {
                cx: 188,
                cy: 82,
                r: 12,
                fill: 'var(--color-node-control)',
                stroke: 'var(--color-border-strong)',
                cursor: 'pointer',
                event: 'input:clear',
                display: 'none',
            },
            clearText: {
                x: 188,
                y: 86,
                text: '×',
                textAnchor: 'middle',
                fill: 'var(--color-text)',
                fontSize: 15,
                pointerEvents: 'none',
                display: 'none',
            },
        },
    },
    {
        portMarkup: [{ tagName: 'circle', selector: 'portBody' }],
        markup: [
            { tagName: 'rect', selector: 'body' },
            { tagName: 'path', selector: 'header' },
            { tagName: 'rect', selector: 'outline' },
            { tagName: 'text', selector: 'headerText' },
            { tagName: 'text', selector: 'bodyText' },
            { tagName: 'circle', selector: 'statusRing' },
            { tagName: 'path', selector: 'statusIcon' },
            { tagName: 'text', selector: 'statusText' },
            { tagName: 'circle', selector: 'playButton' },
            { tagName: 'path', selector: 'playIcon' },
            { tagName: 'rect', selector: 'fileButton' },
            { tagName: 'text', selector: 'fileButtonText' },
            { tagName: 'text', selector: 'fileName' },
            { tagName: 'circle', selector: 'clearButton' },
            { tagName: 'text', selector: 'clearText' },
        ],
    },
);

export interface JointLayerGraphCallbacks {
    readonly selectNode: (id: string | null) => void;
    readonly positionNode: (id: string, x: number, y: number) => void;
    readonly playNode: (id: string) => void;
    readonly connectNodes: (source: string, target: string) => boolean;
    readonly selectConnection: (id: string | null) => void;
    readonly deleteConnection: (id: string) => void;
    readonly zoomChanged: (zoom: number) => void;
    readonly chooseInputFile: (id: string) => void;
    readonly clearInputFile: (id: string) => void;
}

export class JointLayerGraph {
    readonly #graph = new dia.Graph({}, { cellNamespace: shapes });
    readonly #paper: dia.Paper;
    readonly #callbacks: JointLayerGraphCallbacks;
    #zoom = 1;
    #panX = 0;
    #panY = 0;
    #states: Readonly<Record<string, NodeExecutionState>> = {};
    #lockedNodeIds: ReadonlySet<string> = new Set();
    #playbackTriggerNodeId: string | null = null;
    #recordingNodeId: string | null = null;
    #selectedConnectionId: string | null = null;
    #automaticPositions: ReadonlyMap<string, GraphNodePosition> = new Map();
    #automaticRoutes: ReadonlyMap<string, readonly GraphEdgePoint[]> = new Map();
    #automaticLayoutKey = '';
    #automaticRouteKey = '';
    #automaticLayoutRun = 0;
    #preserveViewportOnNextRender = false;
    #dragStart: { readonly id: string; readonly x: number; readonly y: number } | null = null;
    readonly #deleteSelectedConnection = (event: KeyboardEvent): void => {
        if (!['Backspace', 'Delete'].includes(event.key) || !this.#selectedConnectionId) {
            return;
        }

        if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement
        ) {
            return;
        }

        event.preventDefault();
        this.#callbacks.deleteConnection(this.#selectedConnectionId);
    };

    constructor(element: HTMLElement, callbacks: JointLayerGraphCallbacks) {
        this.#callbacks = callbacks;
        this.#paper = new dia.Paper({
            el: element,
            model: this.#graph,
            cellViewNamespace: shapes,
            width: '100%',
            height: '100%',
            async: true,
            gridSize: 8,
            drawGrid: {
                name: 'mesh',
                args: { color: 'var(--color-graph-grid)', thickness: 1 },
            },
            background: { color: 'transparent' },
            interactive: (view) => ({
                elementMove: !this.#lockedNodeIds.has(String(view.model.id)),
            }),
            defaultLink: () => JointLayerGraph.createLink(),
            linkPinning: false,
            validateMagnet: (view) => !this.#lockedNodeIds.has(String(view.model.id)),
            validateConnection: (sourceView, sourceMagnet, targetView, targetMagnet) =>
                !this.#lockedNodeIds.has(String(sourceView.model.id)) &&
                !this.#lockedNodeIds.has(String(targetView.model.id)) &&
                sourceView !== targetView &&
                sourceMagnet?.getAttribute('port-group') === 'out' &&
                targetMagnet?.getAttribute('port-group') === 'in',
        });
        this.#paper.on('element:pointerclick', (view: dia.ElementView) => {
            this.select(String(view.model.id));
            this.selectConnection(null);
            this.#callbacks.selectNode(String(view.model.id));
        });
        this.#paper.on('blank:pointerclick', () => {
            this.select(null);
            this.selectConnection(null);
            this.#callbacks.selectNode(null);
        });
        this.#paper.on('link:pointerclick', (view: dia.LinkView) => {
            this.selectLink(view);
        });
        this.#paper.on('connection:select', (view: dia.LinkView, event: Event) => {
            event.stopPropagation();
            this.selectLink(view);
        });
        this.#paper.on('element:pointerdown', (view: dia.ElementView) => {
            if (this.#lockedNodeIds.has(String(view.model.id))) {
                this.#dragStart = null;
                return;
            }

            const position = view.model.position();
            this.#dragStart = { id: String(view.model.id), x: position.x, y: position.y };
        });
        this.#paper.on('element:pointerup', (view: dia.ElementView) => {
            const position = view.model.position();
            const start = this.#dragStart;
            this.#dragStart = null;

            if (
                !start ||
                start.id !== String(view.model.id) ||
                (start.x === position.x && start.y === position.y)
            ) {
                return;
            }

            this.#callbacks.positionNode(String(view.model.id), position.x, position.y);
        });
        this.#paper.on('node:play', (view: dia.ElementView, event: Event) => {
            event.stopPropagation();
            const nodeId = String(view.model.id);

            if (
                this.#lockedNodeIds.has(nodeId) &&
                nodeId !== this.#playbackTriggerNodeId &&
                nodeId !== this.#recordingNodeId
            ) {
                return;
            }

            this.#callbacks.playNode(nodeId);
        });
        this.#paper.on('input:choose', (view: dia.ElementView, event: Event) => {
            event.stopPropagation();
            const nodeId = String(view.model.id);

            if (!this.#lockedNodeIds.has(nodeId)) {
                this.#callbacks.chooseInputFile(nodeId);
            }
        });
        this.#paper.on('input:clear', (view: dia.ElementView, event: Event) => {
            event.stopPropagation();
            const nodeId = String(view.model.id);

            if (!this.#lockedNodeIds.has(nodeId)) {
                this.#callbacks.clearInputFile(nodeId);
            }
        });
        this.#paper.on('link:connect', (view: dia.LinkView) => {
            const source = String(view.model.source().id ?? '');
            const target = String(view.model.target().id ?? '');

            if (!source || !target || !this.#callbacks.connectNodes(source, target)) {
                view.model.remove();
            }
        });
        document.addEventListener('keydown', this.#deleteSelectedConnection);
    }

    render(
        nodes: readonly DirectorNode[],
        connections: readonly WorkflowConnection[],
        selectedId: string | null,
        selectedConnectionId: string | null,
        states: Readonly<Record<string, NodeExecutionState>> = {},
        connectedNodeIds: ReadonlySet<string> = new Set(),
        disconnectedLabel = 'Not connected',
        staleNodeIds: ReadonlySet<string> = new Set(),
        inputFileNames: Readonly<Record<string, string>> = {},
        chooseFileLabel = 'Choose file',
        recordingActive = false,
        lockedNodeIds: ReadonlySet<string> = new Set(),
        playbackTriggerNodeId: string | null = null,
        executionRunning = false,
        recordingReady = true,
    ): void {
        const fitAutomaticLayout = !this.#preserveViewportOnNextRender;
        this.#preserveViewportOnNextRender = false;
        this.#states = states;
        this.#lockedNodeIds = lockedNodeIds;
        this.#playbackTriggerNodeId = playbackTriggerNodeId;
        this.#recordingNodeId = recordingActive
            ? (nodes.find((node) => node.type === 'video-output')?.id ?? null)
            : null;
        this.#selectedConnectionId = selectedConnectionId;
        this.#paper.freeze();
        this.#graph.clear();
        const incomingConnections = JointLayerGraph.incomingConnections(connections);
        const outgoingConnections = JointLayerGraph.outgoingConnections(connections);
        const targetPorts = new Map<string, string>();
        const sourcePorts = new Map<string, string>();
        const routeKey = this.#layoutKey(nodes, connections);
        const useAutomaticRoutes = routeKey === this.#automaticRouteKey;

        for (const [index, node] of nodes.entries()) {
            const execution = states[node.id];
            const locked = lockedNodeIds.has(node.id);
            const stoppingPlayback = playbackTriggerNodeId === node.id;
            const stoppingRecording = recordingActive && node.type === 'video-output';
            const playUnavailable =
                node.type === 'video-output' && !recordingReady && !stoppingRecording;
            const connected = connectedNodeIds.has(node.id);
            const inputFileName = node.type === 'input' ? inputFileNames[node.id] : undefined;
            const incoming = incomingConnections.get(node.id) ?? [];
            const outgoing = outgoingConnections.get(node.id) ?? [];
            const inputPorts =
                node.type === 'audio'
                    ? [
                          { id: 'asset', group: 'in' },
                          { id: 'flow', group: 'in' },
                      ]
                    : incoming.length
                      ? incoming.map((connection, connectionIndex) => {
                            const portId = `in-${connectionIndex}`;
                            targetPorts.set(connection.id, portId);
                            return { id: portId, group: 'in' };
                        })
                      : [{ id: 'in', group: 'in' }];

            if (node.type === 'audio') {
                for (const connection of incoming) {
                    const source = nodes.find((candidate) => candidate.id === connection.source);
                    targetPorts.set(connection.id, source?.type === 'input' ? 'asset' : 'flow');
                }
            }

            const outputPorts =
                node.type === 'video-output'
                    ? []
                    : outgoing.length
                      ? outgoing.map((connection, connectionIndex) => {
                            const portId = outgoing.length === 1 ? 'out' : `out-${connectionIndex}`;
                            sourcePorts.set(connection.id, portId);
                            return { id: portId, group: 'out' };
                        })
                      : [{ id: 'out', group: 'out' }];

            const cell = new GraphNode({
                id: node.id,
                ports: {
                    groups: JointLayerGraph.portGroups(),
                    items: [...(node.type === 'input' ? [] : inputPorts), ...outputPorts],
                },
            });
            const position =
                node.position ??
                this.#automaticPositions.get(node.id) ??
                JointLayerGraph.fallbackPosition(index);
            cell.position(position.x, position.y);
            cell.attr({
                root: { cursor: 'pointer', opacity: locked ? 0.62 : 1 },
                body: {
                    fill: 'var(--color-node-surface)',
                    stroke: 'none',
                    rx: 12,
                    ry: 12,
                },
                header: {
                    fill: JointLayerGraph.color(node),
                    stroke: JointLayerGraph.color(node),
                },
                outline: {
                    stroke: JointLayerGraph.borderColor(node.id === selectedId, execution),
                    strokeWidth: node.id === selectedId ? 2 : 1,
                    strokeDasharray: connected ? 'none' : '5 4',
                },
                headerText: {
                    text:
                        node.type === 'website'
                            ? 'ROOT'
                            : node.type === 'input'
                              ? 'INPUT'
                              : node.type === 'capability'
                                ? 'CAPABILITY'
                                : node.type === 'layer'
                                  ? 'LAYER'
                                  : node.type === 'merge'
                                    ? 'MERGE'
                                    : node.type === 'audio'
                                      ? 'AUDIO'
                                      : node.type === 'video-output'
                                        ? 'VIDEO'
                                        : node.type === 'javascript'
                                          ? 'JS'
                                          : node.type === 'browser-action'
                                            ? 'ACTION'
                                            : 'WAIT',
                    fill: 'var(--color-node-header-text)',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 1.4,
                },
                bodyText: {
                    text: JointLayerGraph.nodeText(node),
                    fill: 'var(--color-text)',
                    fontFamily: 'Inter, ui-sans-serif, system-ui',
                    fontSize: 13,
                    fontWeight: 650,
                    lineHeight: 20,
                },
                playButton: {
                    display: ['input', 'capability', 'audio'].includes(node.type)
                        ? 'none'
                        : 'block',
                    class: staleNodeIds.has(node.id) ? 'is-stale' : '',
                    cursor:
                        playUnavailable || (locked && !stoppingPlayback && !stoppingRecording)
                            ? 'not-allowed'
                            : 'pointer',
                    pointerEvents:
                        playUnavailable || (locked && !stoppingPlayback && !stoppingRecording)
                            ? 'none'
                            : 'auto',
                    opacity:
                        playUnavailable || (locked && !stoppingPlayback && !stoppingRecording)
                            ? 0.35
                            : 1,
                    fill:
                        node.type === 'video-output'
                            ? 'var(--color-danger-soft)'
                            : 'var(--color-node-control)',
                    stroke:
                        node.type === 'video-output'
                            ? 'var(--color-recording-strong)'
                            : 'var(--color-play)',
                    strokeWidth: staleNodeIds.has(node.id) ? 2.5 : 1,
                },
                playIcon: {
                    display: ['input', 'capability', 'audio'].includes(node.type)
                        ? 'none'
                        : 'block',
                    d:
                        stoppingPlayback || stoppingRecording
                            ? 'M5 5h6v6H5z'
                            : node.type === 'video-output'
                              ? 'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8'
                              : 'M12.5 4a.5.5 0 0 0-1 0v3.248L5.233 3.612C4.693 3.3 4 3.678 4 4.308v7.384c0 .63.692 1.01 1.233.697L11.5 8.753V12a.5.5 0 0 0 1 0z',
                    fill:
                        node.type === 'video-output'
                            ? 'var(--color-recording-strong)'
                            : 'var(--color-play)',
                    opacity: locked && !stoppingPlayback && !stoppingRecording ? 0.35 : 1,
                },
                fileButton: {
                    display: node.type === 'input' && !inputFileName ? 'block' : 'none',
                },
                fileButtonText: {
                    display: node.type === 'input' && !inputFileName ? 'block' : 'none',
                    text: chooseFileLabel,
                },
                fileName: {
                    display: inputFileName ? 'block' : 'none',
                    text: JointLayerGraph.ellipsize(inputFileName ?? '', 27),
                },
                clearButton: {
                    display: inputFileName ? 'block' : 'none',
                },
                clearText: {
                    display: inputFileName ? 'block' : 'none',
                },
                statusRing: JointLayerGraph.statusRing(execution, executionRunning),
                statusIcon: JointLayerGraph.statusIcon(execution, executionRunning),
                statusText: JointLayerGraph.statusText(execution),
            });
            const title = [connected ? '' : disconnectedLabel, JointLayerGraph.nodeDetail(node)]
                .filter(Boolean)
                .join(' · ');
            cell.attr('body/title', title);
            cell.addTo(this.#graph);
        }

        for (const connection of connections) {
            const link = JointLayerGraph.createLink(
                connection.id,
                useAutomaticRoutes ? this.#automaticRoutes.get(connection.id) : undefined,
            );
            link.source({
                id: connection.source,
                port: sourcePorts.get(connection.id) ?? 'out',
            });
            link.target({ id: connection.target, port: targetPorts.get(connection.id) ?? 'in' });
            link.addTo(this.#graph);
            link.toBack();
        }

        this.#paper.scale(this.#zoom);
        this.#paper.translate(this.#panX, this.#panY);
        this.#paper.unfreeze();
        this.selectConnection(
            connections.some((connection) => connection.id === this.#selectedConnectionId)
                ? this.#selectedConnectionId
                : null,
        );

        if (nodes.some((node) => node.position === null)) {
            const key = this.#layoutKey(nodes, connections);

            if (key !== this.#automaticLayoutKey) {
                this.#automaticLayoutKey = key;
                void this.arrangeAutomatically(nodes, connections, fitAutomaticLayout)
                    .then((zoom) => this.#callbacks.zoomChanged(zoom))
                    .catch(() => undefined);
            }
        }
    }

    private static nodeDetail(node: DirectorNode): string {
        if (node.type === 'browser-action') {
            return node.selector;
        }

        if (node.type === 'browser-wait' && node.condition === 'element') {
            return node.selector;
        }

        return '';
    }

    private static nodeText(node: DirectorNode): string {
        const detail =
            node.type === 'website'
                ? JointLayerGraph.compactUrl(node.url)
                : node.type === 'input'
                  ? ''
                  : node.type === 'capability'
                    ? 'Virtual camera'
                    : node.type === 'layer'
                      ? 'HTML  ·  CSS  ·  JS'
                      : node.type === 'merge'
                        ? `Wait ${node.waitFor}`
                        : node.type === 'audio'
                          ? `${Math.round(node.volume * 100)} % · ${node.waitForEnd ? 'Wait' : 'Continue'}`
                          : node.type === 'video-output'
                            ? `${node.filename} · ${node.targetId || 'Select target'}`
                            : node.type === 'javascript'
                              ? 'JavaScript'
                              : node.type === 'browser-action'
                                ? `Click · ${node.selector}`
                                : node.condition === 'element'
                                  ? `Element · ${node.selector}`
                                  : node.condition === 'url'
                                    ? `URL · ${node.value}`
                                    : 'Script';
        return `${JointLayerGraph.ellipsize(node.name, 27)}\n${JointLayerGraph.ellipsize(detail, 27)}`;
    }

    private static ellipsize(value: string, maximumLength: number): string {
        const characters = Array.from(value);

        if (characters.length <= maximumLength) {
            return value;
        }

        return `${characters.slice(0, maximumLength - 1).join('')}…`;
    }

    select(id: string | null): void {
        for (const element of this.#graph.getElements()) {
            const selected = String(element.id) === id;
            element.attr(
                'outline/stroke',
                JointLayerGraph.borderColor(selected, this.#states[String(element.id)]),
            );
            element.attr('outline/strokeWidth', selected ? 2 : 1);
        }
    }

    setZoom(zoom: number): void {
        this.#zoom = zoom;
        this.#paper.scale(zoom);
    }

    setZoomAt(zoom: number, fromX: number, fromY: number, toX = fromX, toY = fromY): void {
        const contentX = (fromX - this.#panX) / this.#zoom;
        const contentY = (fromY - this.#panY) / this.#zoom;
        this.#zoom = zoom;
        this.#panX = toX - contentX * zoom;
        this.#panY = toY - contentY * zoom;
        this.#paper.scale(zoom);
        this.#paper.translate(this.#panX, this.#panY);
    }

    fitToContent(): number {
        const bounds = this.#graph.getBBox();
        const width = this.#paper.el.clientWidth;
        const height = this.#paper.el.clientHeight;

        if (!bounds || width <= 0 || height <= 0) {
            return this.#zoom;
        }

        const padding = 24;
        const zoom = Math.min(
            1,
            Math.max(
                0.25,
                Math.min(
                    (width - padding * 2) / bounds.width,
                    (height - padding * 2) / bounds.height,
                ),
            ),
        );
        this.#zoom = zoom;
        this.#panX = (width - bounds.width * zoom) / 2 - bounds.x * zoom;
        this.#panY = (height - bounds.height * zoom) / 2 - bounds.y * zoom;
        this.#paper.scale(this.#zoom);
        this.#paper.translate(this.#panX, this.#panY);
        return zoom;
    }

    async arrangeAutomatically(
        nodes: readonly DirectorNode[],
        connections: readonly WorkflowConnection[],
        fit = false,
    ): Promise<number> {
        const run = ++this.#automaticLayoutRun;
        const height = this.#paper.el.clientHeight;
        const aspectRatio = height > 0 ? this.#paper.el.clientWidth / height : 1.6;
        const layout = await GraphAutoLayout.layout(nodes, connections, aspectRatio);

        if (run !== this.#automaticLayoutRun) {
            return this.#zoom;
        }

        const layoutKey = this.#layoutKey(nodes, connections);
        this.#automaticPositions = layout.positions;
        this.#automaticLayoutKey = layoutKey;

        for (const node of nodes) {
            if (node.position !== null) {
                continue;
            }

            const position = layout.positions.get(node.id);
            const cell = this.#graph.getCell(node.id);

            if (position && cell?.isElement()) {
                cell.position(position.x, position.y);
            }
        }

        this.#applyRoutes(connections, layout.routes, layoutKey);

        this.#paper.updateViews();
        return fit ? this.fitToContent() : this.#zoom;
    }

    async rerouteConnections(
        nodes: readonly DirectorNode[],
        connections: readonly WorkflowConnection[],
    ): Promise<void> {
        const run = ++this.#automaticLayoutRun;
        const height = this.#paper.el.clientHeight;
        const aspectRatio = height > 0 ? this.#paper.el.clientWidth / height : 1.6;
        const layout = await GraphAutoLayout.layout(nodes, connections, aspectRatio);

        if (run !== this.#automaticLayoutRun) {
            return;
        }

        const layoutKey = this.#layoutKey(nodes, connections);
        this.#automaticLayoutKey = layoutKey;
        this.#applyRoutes(connections, layout.routes, layoutKey);
        this.#paper.updateViews();
    }

    #applyRoutes(
        connections: readonly WorkflowConnection[],
        routes: ReadonlyMap<string, readonly GraphEdgePoint[]>,
        layoutKey: string,
    ): void {
        this.#automaticRoutes = routes;
        this.#automaticRouteKey = routes.size ? layoutKey : '';

        for (const connection of connections) {
            const link = this.#graph.getCell(connection.id);

            if (link?.isLink()) {
                JointLayerGraph.applyRoute(link, routes.get(connection.id));
            }
        }
    }

    panBy(x: number, y: number): void {
        this.#panX += x;
        this.#panY += y;
        this.#paper.translate(this.#panX, this.#panY);
    }

    preserveViewportOnNextRender(): void {
        this.#preserveViewportOnNextRender = true;
    }

    centeredNodePosition(): GraphNodePosition {
        const centerX = (this.#paper.el.clientWidth / 2 - this.#panX) / this.#zoom;
        const centerY = (this.#paper.el.clientHeight / 2 - this.#panY) / this.#zoom;
        return {
            x: Math.round(centerX - graphNodeSize.width / 2),
            y: Math.round(centerY - graphNodeSize.height / 2),
        };
    }

    dispose(): void {
        document.removeEventListener('keydown', this.#deleteSelectedConnection);
        this.#paper.remove();
    }

    selectConnection(id: string | null): void {
        this.#selectedConnectionId = id;

        for (const link of this.#graph.getLinks()) {
            const selected = String(link.id) === id;
            link.attr('line/stroke', selected ? 'var(--color-accent)' : 'var(--color-text-muted)');
            link.attr('line/strokeWidth', selected ? 3 : 1.5);
        }

        this.#callbacks.selectConnection(id);
    }

    private static createLink(
        id?: string,
        route?: readonly GraphEdgePoint[],
    ): shapes.standard.Link {
        const link = new shapes.standard.Link(id ? { id } : undefined);
        JointLayerGraph.applyRoute(link, route);
        link.connector('jumpover', { jump: 'gap', size: 7, radius: 8 });
        link.attr({
            line: {
                stroke: 'var(--color-text-muted)',
                strokeWidth: 1.5,
                pointerEvents: 'stroke',
                cursor: 'pointer',
                event: 'connection:select',
                targetMarker: null,
            },
        });
        return link;
    }

    private static applyRoute(link: dia.Link, route?: readonly GraphEdgePoint[]): void {
        if (route?.length) {
            link.unset('router');
            link.vertices(route.map((point) => ({ x: point.x, y: point.y })));
            return;
        }

        link.vertices([]);
        link.router('manhattan', {
            padding: 24,
            step: 8,
            maximumLoops: 20_000,
            startDirections: ['right'],
            endDirections: ['left'],
        });
    }

    private static incomingConnections(
        connections: readonly WorkflowConnection[],
    ): ReadonlyMap<string, readonly WorkflowConnection[]> {
        const incoming = new Map<string, WorkflowConnection[]>();

        for (const connection of connections) {
            const entries = incoming.get(connection.target) ?? [];
            entries.push(connection);
            incoming.set(connection.target, entries);
        }

        return incoming;
    }

    private static outgoingConnections(
        connections: readonly WorkflowConnection[],
    ): ReadonlyMap<string, readonly WorkflowConnection[]> {
        const outgoing = new Map<string, WorkflowConnection[]>();

        for (const connection of connections) {
            const entries = outgoing.get(connection.source) ?? [];
            entries.push(connection);
            outgoing.set(connection.source, entries);
        }

        return outgoing;
    }

    private static portGroups(): Record<string, dia.Element.PortGroup> {
        return {
            in: {
                position: { name: 'left' },
                attrs: {
                    portBody: {
                        r: 6,
                        fill: 'var(--color-surface-raised)',
                        stroke: 'var(--color-text-muted)',
                        strokeWidth: 2,
                        magnet: 'passive',
                        cursor: 'crosshair',
                    },
                },
            },
            out: {
                position: { name: 'right' },
                attrs: {
                    portBody: {
                        r: 6,
                        fill: 'var(--color-accent)',
                        stroke: 'var(--color-surface-raised)',
                        strokeWidth: 2,
                        magnet: true,
                        cursor: 'crosshair',
                    },
                },
            },
        };
    }

    private selectLink(view: dia.LinkView): void {
        this.select(null);
        this.#callbacks.selectNode(null);
        this.selectConnection(String(view.model.id));
    }

    private static compactUrl(url: string): string {
        if (!url) {
            return 'URL';
        }

        return url.length > 28 ? `${url.slice(0, 25)}…` : url;
    }

    #layoutKey(nodes: readonly DirectorNode[], connections: readonly WorkflowConnection[]): string {
        const height = this.#paper.el.clientHeight;
        const aspectRatio = height > 0 ? this.#paper.el.clientWidth / height : 1.6;
        return `${nodes
            .map((node) =>
                node.position
                    ? `${node.id}@${node.position.x},${node.position.y}`
                    : `${node.id}@auto`,
            )
            .join(',')}|${connections
            .map((connection) => `${connection.source}>${connection.target}`)
            .join(',')}|${aspectRatio.toFixed(2)}`;
    }

    private static fallbackPosition(index: number): GraphNodePosition {
        return { x: 24 + (index % 3) * 280, y: 24 + Math.floor(index / 3) * 152 };
    }

    private static color(node: DirectorNode): string {
        if (node.type === 'website') {
            return 'var(--color-node-website)';
        }

        if (node.type === 'input') {
            return 'var(--color-node-input)';
        }

        if (node.type === 'capability') {
            return 'var(--color-node-capability)';
        }

        if (node.type === 'merge') {
            return 'var(--color-node-merge)';
        }

        if (node.type === 'audio') {
            return 'var(--color-node-audio)';
        }

        if (node.type === 'video-output') {
            return 'var(--color-recording-strong)';
        }

        if (node.type === 'javascript') {
            return 'var(--color-node-javascript)';
        }

        if (node.type === 'browser-action') {
            return 'var(--color-node-action)';
        }

        if (node.type === 'browser-wait') {
            return 'var(--color-node-wait)';
        }

        return 'var(--color-node-layer)';
    }

    private static borderColor(selected: boolean, state?: NodeExecutionState): string {
        if (state?.status === 'error') {
            return 'var(--color-status-error)';
        }

        if (state?.status === 'running') {
            return 'var(--color-status-running)';
        }

        return selected ? 'var(--color-accent)' : 'var(--color-border)';
    }

    private static statusRing(
        state: NodeExecutionState | undefined,
        executionRunning: boolean,
    ): Record<string, unknown> {
        if (!state || (state.status === 'idle' && !executionRunning)) {
            return { display: 'none' };
        }

        const colors = {
            idle: 'var(--color-status-pending)',
            running: 'var(--color-status-running)',
            success: 'var(--color-status-success)',
            error: 'var(--color-status-error)',
            cancelled: 'var(--color-status-cancelled)',
        } as const;
        return {
            display: 'block',
            class: `graph-node-status is-${state.status === 'idle' ? 'pending' : state.status}`,
            fill: ['idle', 'running'].includes(state.status) ? 'none' : colors[state.status],
            stroke: colors[state.status],
            strokeWidth: ['idle', 'running'].includes(state.status) ? 2 : 0,
            strokeDasharray: state.status === 'running' ? '8 5' : 'none',
        };
    }

    private static statusIcon(
        state: NodeExecutionState | undefined,
        executionRunning: boolean,
    ): Record<string, unknown> {
        const pending = executionRunning && state?.status === 'idle';
        return {
            display: pending ? 'block' : 'none',
            class: 'graph-node-pending-icon',
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
                    ? 'var(--color-on-strong)'
                    : 'var(--color-text)',
        };
    }
}
