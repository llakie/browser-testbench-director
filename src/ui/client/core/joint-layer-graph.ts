import { dia, shapes } from '@joint/core';

import type { NodeExecutionState } from './execution-controller.js';
import { GraphAutoLayout, type GraphNodePosition } from './graph-auto-layout.js';
import type { DirectorNode, WorkflowConnection } from './project-format.js';

const GraphNode = dia.Element.define(
    'director.Node',
    {
        size: { width: 216, height: 112 },
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
                d: 'M 186 78 L 197 85 L 186 92 Z',
                fill: 'var(--color-accent)',
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
    #selectedConnectionId: string | null = null;
    #automaticPositions: ReadonlyMap<string, GraphNodePosition> = new Map();
    #automaticLayoutKey = '';
    #automaticLayoutRun = 0;
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
            interactive: { elementMove: true },
            defaultLink: () => JointLayerGraph.createLink(),
            linkPinning: false,
            validateConnection: (sourceView, sourceMagnet, targetView, targetMagnet) =>
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
        this.#paper.on('link:label:pointerclick', (view: dia.LinkView) => {
            this.selectLink(view);
        });
        this.#paper.on('connection:select', (view: dia.LinkView, event: Event) => {
            event.stopPropagation();
            this.selectLink(view);
        });
        this.#paper.on('element:pointerdown', (view: dia.ElementView) => {
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
            this.#callbacks.playNode(String(view.model.id));
        });
        this.#paper.on('input:choose', (view: dia.ElementView, event: Event) => {
            event.stopPropagation();
            this.#callbacks.chooseInputFile(String(view.model.id));
        });
        this.#paper.on('input:clear', (view: dia.ElementView, event: Event) => {
            event.stopPropagation();
            this.#callbacks.clearInputFile(String(view.model.id));
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
    ): void {
        this.#states = states;
        this.#selectedConnectionId = selectedConnectionId;
        this.#paper.freeze();
        this.#graph.clear();
        const incomingConnections = JointLayerGraph.incomingConnections(connections);
        const targetPorts = new Map<string, string>();

        for (const [index, node] of nodes.entries()) {
            const execution = states[node.id];
            const connected = connectedNodeIds.has(node.id);
            const inputFileName = node.type === 'input' ? inputFileNames[node.id] : undefined;
            const incoming = incomingConnections.get(node.id) ?? [];
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

            const cell = new GraphNode({
                id: node.id,
                ports: {
                    groups: JointLayerGraph.portGroups(),
                    items: [
                        ...(node.type === 'input' ? [] : inputPorts),
                        { id: 'out', group: 'out' },
                    ],
                },
            });
            const position =
                node.position ??
                this.#automaticPositions.get(node.id) ??
                JointLayerGraph.fallbackPosition(index);
            cell.position(position.x, position.y);
            cell.attr({
                root: { cursor: 'pointer' },
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
                    display: ['input', 'capability'].includes(node.type) ? 'none' : 'block',
                    class: staleNodeIds.has(node.id) ? 'is-stale' : '',
                    stroke: staleNodeIds.has(node.id)
                        ? 'var(--color-accent)'
                        : 'var(--color-border-strong)',
                    strokeWidth: staleNodeIds.has(node.id) ? 2.5 : 1,
                },
                playIcon: {
                    display: ['input', 'capability'].includes(node.type) ? 'none' : 'block',
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
                statusRing: JointLayerGraph.statusRing(execution),
                statusText: JointLayerGraph.statusText(execution),
            });
            const title = [connected ? '' : disconnectedLabel, JointLayerGraph.nodeDetail(node)]
                .filter(Boolean)
                .join(' · ');
            cell.attr('body/title', title);
            cell.addTo(this.#graph);
        }

        for (const connection of connections) {
            const link = JointLayerGraph.createLink(connection.id);
            link.source({ id: connection.source, port: 'out' });
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
                void this.arrangeAutomatically(nodes, connections, true)
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
        const positions = await GraphAutoLayout.positions(nodes, connections, aspectRatio);

        if (run !== this.#automaticLayoutRun) {
            return this.#zoom;
        }

        this.#automaticPositions = positions;
        this.#automaticLayoutKey = this.#layoutKey(nodes, connections);

        for (const node of nodes) {
            if (node.position !== null) {
                continue;
            }

            const position = positions.get(node.id);
            const cell = this.#graph.getCell(node.id);

            if (position && cell?.isElement()) {
                cell.position(position.x, position.y);
            }
        }

        return fit ? this.fitToContent() : this.#zoom;
    }

    panBy(x: number, y: number): void {
        this.#panX += x;
        this.#panY += y;
        this.#paper.translate(this.#panX, this.#panY);
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
            link.label(0, {
                attrs: {
                    connectionHandle: {
                        fill: selected ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    },
                },
            });
        }

        this.#callbacks.selectConnection(id);
    }

    private static createLink(id?: string): shapes.standard.Link {
        const link = new shapes.standard.Link(id ? { id } : undefined);
        link.router('manhattan', {
            padding: 24,
            step: 8,
            maximumLoops: 20_000,
            startDirections: ['right'],
            endDirections: ['left'],
        });
        link.connector('jumpover', { jump: 'gap', size: 7, radius: 8 });
        link.attr({
            line: {
                stroke: 'var(--color-text-muted)',
                strokeWidth: 1.5,
                pointerEvents: 'stroke',
                cursor: 'pointer',
                event: 'connection:select',
                targetMarker: { type: 'path', d: 'M 8 -4 0 0 8 4 z' },
            },
        });
        link.appendLabel({
            position: { distance: 0.5 },
            markup: [{ tagName: 'circle', selector: 'connectionHandle' }],
            attrs: {
                connectionHandle: {
                    r: 6,
                    fill: 'var(--color-text-muted)',
                    stroke: 'var(--color-surface-raised)',
                    strokeWidth: 2,
                    cursor: 'pointer',
                    event: 'connection:select',
                },
            },
        });
        return link;
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
        return `${nodes.map((node) => node.id).join(',')}|${connections
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

    private static statusRing(state?: NodeExecutionState): Record<string, unknown> {
        if (!state || state.status === 'idle') {
            return { display: 'none' };
        }

        const colors = {
            running: 'var(--color-status-running)',
            success: 'var(--color-status-success)',
            error: 'var(--color-status-error)',
            cancelled: 'var(--color-status-cancelled)',
        } as const;
        return {
            display: 'block',
            class: `graph-node-status is-${state.status}`,
            fill: state.status === 'running' ? 'none' : colors[state.status],
            stroke: colors[state.status],
            strokeWidth: state.status === 'running' ? 2 : 0,
            strokeDasharray: state.status === 'running' ? '8 5' : 'none',
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
