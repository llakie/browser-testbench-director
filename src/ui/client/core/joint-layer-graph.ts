import { dia, g, routers, shapes } from '@joint/core';

import type { NodeExecutionState } from './execution-controller.js';
import { GraphNodePresentation } from './graph-node-presentation.js';
import {
    GraphAutoLayout,
    rebaseRouteToAnchors,
    type GraphEdgePoint,
    type GraphLayout,
    type GraphNodePosition,
} from './graph-auto-layout.js';
import type { DirectorNode, WorkflowConnection } from './project-format.js';

const graphNodeSize = { width: 216, height: 112 } as const;
const routingMaximumLoops = 4_000;

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

export interface GraphRenderOptions {
    readonly selectedNodeId: string | null;
    readonly selectedConnectionId: string | null;
    readonly states: Readonly<Record<string, NodeExecutionState>>;
    readonly connectedNodeIds: ReadonlySet<string>;
    readonly disconnectedLabel: string;
    readonly staleNodeIds: ReadonlySet<string>;
    readonly inputFileNames: Readonly<Record<string, string>>;
    readonly chooseFileLabel: string;
    readonly recordingActive: boolean;
    readonly lockedNodeIds: ReadonlySet<string>;
    readonly playbackTriggerNodeId: string | null;
    readonly executionRunning: boolean;
    readonly recordingReady: boolean;
    readonly pausedAudioNodeId: string | null;
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
    #automaticRouteKey = '';
    #automaticLayoutRun = 0;
    #initialLayoutPending = true;
    #initialLayoutInProgress = false;
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
        options: GraphRenderOptions,
    ): void {
        const {
            selectedNodeId,
            selectedConnectionId,
            states,
            connectedNodeIds,
            disconnectedLabel,
            staleNodeIds,
            inputFileNames,
            chooseFileLabel,
            recordingActive,
            lockedNodeIds,
            playbackTriggerNodeId,
            executionRunning,
            recordingReady,
            pausedAudioNodeId,
        } = options;
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
            const headerColor = GraphNodePresentation.headerColor(node);
            const execution = states[node.id];
            const pausedAudio = node.id === pausedAudioNodeId && node.type === 'audio';
            const locked = lockedNodeIds.has(node.id);
            const stoppingPlayback = playbackTriggerNodeId === node.id;
            const stoppingRecording = recordingActive && node.type === 'video-output';
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
                    groups: GraphNodePresentation.portGroups(headerColor),
                    items: [...(node.type === 'input' ? [] : inputPorts), ...outputPorts],
                },
            });
            const position =
                node.position ??
                this.#automaticPositions.get(node.id) ??
                JointLayerGraph.fallbackPosition(index);
            cell.position(position.x, position.y);
            cell.attr(
                GraphNodePresentation.attributes(node, {
                    selected: node.id === selectedNodeId,
                    connected,
                    execution,
                    executionRunning,
                    pausedAudio,
                    stale: staleNodeIds.has(node.id),
                    locked,
                    stoppingPlayback,
                    stoppingRecording,
                    recordingReady,
                    inputFileName,
                    chooseFileLabel,
                }),
            );
            cell.attr(
                'body/title',
                GraphNodePresentation.title(node, connected, disconnectedLabel),
            );
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

        if (this.#initialLayoutPending) {
            if (!nodes.some((node) => node.position === null)) {
                this.#initialLayoutPending = false;
            } else {
                if (!this.#initialLayoutInProgress) {
                    this.#initialLayoutInProgress = true;
                    const layoutRun = this.#automaticLayoutRun;
                    void this.arrangeAutomatically(nodes, connections, fitAutomaticLayout)
                        .then((zoom) => this.#callbacks.zoomChanged(zoom))
                        .catch(() => undefined)
                        .finally(() => {
                            if (layoutRun !== this.#automaticLayoutRun) {
                                return;
                            }

                            this.#initialLayoutInProgress = false;
                            this.#initialLayoutPending = false;
                        });
                }

                return;
            }
        }

        if (this.#initialLayoutInProgress) {
            return;
        }

        if (routeKey !== this.#automaticRouteKey) {
            void this.rerouteConnections(nodes, connections).catch(() => undefined);
        }
    }

    select(id: string | null): void {
        for (const element of this.#graph.getElements()) {
            const selected = String(element.id) === id;
            element.attr(
                'outline/stroke',
                GraphNodePresentation.borderColor(selected, this.#states[String(element.id)]),
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
        const result = await this.#calculateLayout(nodes, connections);

        if (!result) {
            return this.#zoom;
        }

        const { layout } = result;
        this.#automaticPositions = layout.positions;

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

        this.#paper.updateViews();
        this.#automaticRoutes = layout.routes;
        await this.rerouteConnections(nodes, connections, layout.routes);
        return fit ? this.fitToContent() : this.#zoom;
    }

    async rerouteConnections(
        nodes: readonly DirectorNode[],
        connections: readonly WorkflowConnection[],
        preferredRoutes?: ReadonlyMap<string, readonly GraphEdgePoint[]>,
    ): Promise<void> {
        const routes = new Map<string, readonly GraphEdgePoint[]>();
        const reservedSegments: Array<readonly [GraphEdgePoint, GraphEdgePoint]> = [];
        const incoming = JointLayerGraph.incomingConnections(connections);
        const outgoing = JointLayerGraph.outgoingConnections(connections);
        const nodeBounds = new Map(
            nodes.flatMap((node) => {
                const cell = this.#graph.getCell(node.id);
                return cell?.isElement() ? [[node.id, cell.getBBox()] as const] : [];
            }),
        );

        for (const connection of connections) {
            const link = this.#graph.getCell(connection.id);

            if (!link?.isLink()) {
                continue;
            }

            JointLayerGraph.applyRoute(link);
        }

        this.#paper.updateViews();

        for (const connection of connections) {
            const link = this.#graph.getCell(connection.id);

            if (!link?.isLink()) {
                continue;
            }

            const view = this.#paper.requireView<dia.LinkView>(link);
            const sourceAnchor = view.sourceAnchor;
            const targetAnchor = view.targetAnchor;
            const outgoingIndex =
                outgoing.get(connection.source)?.findIndex((entry) => entry.id === connection.id) ??
                0;
            const incomingIndex =
                incoming.get(connection.target)?.findIndex((entry) => entry.id === connection.id) ??
                0;
            const outgoingCount = outgoing.get(connection.source)?.length ?? 1;
            const incomingCount = incoming.get(connection.target)?.length ?? 1;
            const outgoingOffset = (outgoingIndex - (outgoingCount - 1) / 2) * 16;
            const incomingOffset = (incomingIndex - (incomingCount - 1) / 2) * 16;
            const guidePoints = [
                {
                    x: sourceAnchor.x + 32 + outgoingIndex * 8,
                    y: sourceAnchor.y + outgoingOffset,
                },
                {
                    x: targetAnchor.x - 32 - incomingIndex * 8,
                    y: targetAnchor.y + incomingOffset,
                },
            ];
            const calculateRoute = (avoidExistingRoutes: boolean): GraphEdgePoint[] =>
                routers
                    .manhattan(
                        guidePoints,
                        {
                            padding: 24,
                            step: 8,
                            maximumLoops: routingMaximumLoops,
                            startDirections: ['right'],
                            endDirections: ['left'],
                            fallbackRouter: routers.orthogonal,
                            isPointObstacle: (point) => {
                                for (const [nodeId, bounds] of nodeBounds) {
                                    if (
                                        nodeId !== connection.source &&
                                        nodeId !== connection.target &&
                                        bounds.clone().inflate(16).containsPoint(point)
                                    ) {
                                        return true;
                                    }
                                }

                                return (
                                    avoidExistingRoutes &&
                                    reservedSegments.some((segment) =>
                                        JointLayerGraph.pointTouchesSegment(point, segment, 6),
                                    )
                                );
                            },
                        },
                        view,
                    )
                    .map((point) => ({
                        x: Math.round(point.x),
                        y: Math.round(point.y),
                    }));
            const withAnchors = (route: readonly GraphEdgePoint[]): GraphEdgePoint[] =>
                JointLayerGraph.simplifyRoute([
                    { x: sourceAnchor.x, y: sourceAnchor.y },
                    ...route,
                    { x: targetAnchor.x, y: targetAnchor.y },
                ]);
            const preferredRoute = preferredRoutes?.get(connection.id);
            let points =
                preferredRoute && preferredRoute.length > 2
                    ? rebaseRouteToAnchors(preferredRoute, sourceAnchor, targetAnchor)
                    : withAnchors(calculateRoute(true));

            if (JointLayerGraph.routeCrossesNode(points, connection, nodeBounds)) {
                points = withAnchors(calculateRoute(false));
            }

            const vertices = points.slice(1, -1);
            routes.set(connection.id, vertices);

            for (let index = 1; index < points.length; index += 1) {
                reservedSegments.push([points[index - 1]!, points[index]!]);
            }

            JointLayerGraph.applyRoute(link, vertices);
        }

        this.#applyRoutes(connections, routes, this.#layoutKey(nodes, connections));
        this.#paper.updateViews();
    }

    async #calculateLayout(
        nodes: readonly DirectorNode[],
        connections: readonly WorkflowConnection[],
    ): Promise<{ readonly layout: GraphLayout; readonly layoutKey: string } | null> {
        const run = ++this.#automaticLayoutRun;
        const layout = await GraphAutoLayout.layout(nodes, connections, this.#aspectRatio());

        if (run !== this.#automaticLayoutRun) {
            return null;
        }

        return { layout, layoutKey: this.#layoutKey(nodes, connections) };
    }

    #applyRoutes(
        connections: readonly WorkflowConnection[],
        routes: ReadonlyMap<string, readonly GraphEdgePoint[]>,
        layoutKey: string,
    ): void {
        this.#automaticRoutes = routes;
        this.#automaticRouteKey = layoutKey;

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

    resetAutomaticLayout(): void {
        this.#automaticLayoutRun += 1;
        this.#automaticPositions = new Map();
        this.#automaticRoutes = new Map();
        this.#automaticRouteKey = '';
        this.#initialLayoutPending = true;
        this.#initialLayoutInProgress = false;
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
            maximumLoops: routingMaximumLoops,
            startDirections: ['right'],
            endDirections: ['left'],
            fallbackRouter: routers.orthogonal,
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

    private selectLink(view: dia.LinkView): void {
        this.select(null);
        this.#callbacks.selectNode(null);
        this.selectConnection(String(view.model.id));
    }

    #layoutKey(nodes: readonly DirectorNode[], connections: readonly WorkflowConnection[]): string {
        return `${nodes
            .map((node) =>
                node.position
                    ? `${node.id}@${node.position.x},${node.position.y}`
                    : `${node.id}@auto`,
            )
            .join(',')}|${connections
            .map((connection) => `${connection.source}>${connection.target}`)
            .join(',')}|${this.#aspectRatio().toFixed(2)}`;
    }

    #aspectRatio(): number {
        const height = this.#paper.el.clientHeight;
        return height > 0 ? this.#paper.el.clientWidth / height : 1.6;
    }

    private static fallbackPosition(index: number): GraphNodePosition {
        return { x: 24 + (index % 3) * 280, y: 24 + Math.floor(index / 3) * 152 };
    }

    private static pointTouchesSegment(
        point: GraphEdgePoint,
        [start, end]: readonly [GraphEdgePoint, GraphEdgePoint],
        distance: number,
    ): boolean {
        if (start.x === end.x) {
            const touches =
                Math.abs(point.x - start.x) <= distance &&
                point.y >= Math.min(start.y, end.y) - distance &&
                point.y <= Math.max(start.y, end.y) + distance;
            return touches && !JointLayerGraph.isCrossingGate(point.y);
        }

        const touches =
            Math.abs(point.y - start.y) <= distance &&
            point.x >= Math.min(start.x, end.x) - distance &&
            point.x <= Math.max(start.x, end.x) + distance;
        return touches && !JointLayerGraph.isCrossingGate(point.x);
    }

    private static isCrossingGate(value: number): boolean {
        const spacing = 32;
        return Math.abs(value - Math.round(value / spacing) * spacing) <= 4;
    }

    private static simplifyRoute(route: readonly GraphEdgePoint[]): GraphEdgePoint[] {
        const simplified: GraphEdgePoint[] = [];

        for (const point of route) {
            const previous = simplified.at(-1);

            if (previous?.x === point.x && previous.y === point.y) {
                continue;
            }

            const beforePrevious = simplified.at(-2);

            if (
                beforePrevious &&
                previous &&
                ((beforePrevious.x === previous.x && previous.x === point.x) ||
                    (beforePrevious.y === previous.y && previous.y === point.y))
            ) {
                simplified[simplified.length - 1] = point;
                continue;
            }

            simplified.push(point);
        }

        return simplified;
    }

    private static routeCrossesNode(
        route: readonly GraphEdgePoint[],
        connection: WorkflowConnection,
        nodeBounds: ReadonlyMap<string, g.Rect>,
    ): boolean {
        return [...nodeBounds].some(([nodeId, bounds]) => {
            if (nodeId === connection.source || nodeId === connection.target) {
                return false;
            }

            const obstacle = bounds.clone().inflate(8);
            const left = obstacle.x;
            const right = obstacle.x + obstacle.width;
            const top = obstacle.y;
            const bottom = obstacle.y + obstacle.height;
            return route.slice(1).some((end, index) => {
                const start = route[index]!;

                if (start.x === end.x) {
                    return (
                        start.x > left &&
                        start.x < right &&
                        Math.max(start.y, end.y) > top &&
                        Math.min(start.y, end.y) < bottom
                    );
                }

                return (
                    start.y > top &&
                    start.y < bottom &&
                    Math.max(start.x, end.x) > left &&
                    Math.min(start.x, end.x) < right
                );
            });
        });
    }
}
