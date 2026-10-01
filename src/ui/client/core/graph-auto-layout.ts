import type { ElkNode } from 'elkjs/lib/elk.bundled.js';

import type { DirectorNode, WorkflowConnection } from './project-format.js';

export interface GraphNodePosition {
    readonly x: number;
    readonly y: number;
}

export interface GraphEdgePoint {
    readonly x: number;
    readonly y: number;
}

export interface GraphLayout {
    readonly positions: ReadonlyMap<string, GraphNodePosition>;
    readonly routes: ReadonlyMap<string, readonly GraphEdgePoint[]>;
}

const nodeWidth = 216;
const nodeHeight = 112;

export class GraphAutoLayout {
    static async layout(
        nodes: readonly DirectorNode[],
        connections: readonly WorkflowConnection[],
        aspectRatio = 1.6,
    ): Promise<GraphLayout> {
        const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
        const elk = new ELK();
        const graph: ElkNode = GraphAutoLayout.graph(nodes, connections, aspectRatio);
        const result = await elk.layout(graph);
        const positions = new Map(
            (result.children ?? []).map((node) => [
                node.id,
                { x: Math.round(node.x ?? 0), y: Math.round(node.y ?? 0) },
            ]),
        );
        const routes = new Map(
            (result.edges ?? []).flatMap((edge) => {
                const section = edge.sections?.[0];
                const connection = connections.find((candidate) => candidate.id === edge.id);

                if (!section || !connection) {
                    return [];
                }

                const route = [
                    section.startPoint,
                    ...(section.bendPoints ?? []),
                    section.endPoint,
                ].map((point) => ({ x: point.x, y: point.y }));

                if (!GraphAutoLayout.routeFitsModel(route, connection, nodes, positions)) {
                    return [];
                }

                return [[edge.id, route] as const];
            }),
        );
        return { positions, routes };
    }

    static async positions(
        nodes: readonly DirectorNode[],
        connections: readonly WorkflowConnection[],
        aspectRatio = 1.6,
    ): Promise<ReadonlyMap<string, GraphNodePosition>> {
        return (await GraphAutoLayout.layout(nodes, connections, aspectRatio)).positions;
    }

    private static graph(
        nodes: readonly DirectorNode[],
        connections: readonly WorkflowConnection[],
        aspectRatio: number,
    ): ElkNode {
        return {
            id: 'director-workflow',
            layoutOptions: {
                'elk.algorithm': 'layered',
                'elk.direction': 'RIGHT',
                'elk.edgeRouting': 'ORTHOGONAL',
                'elk.aspectRatio': String(Math.min(2.4, Math.max(1, aspectRatio))),
                'elk.layered.wrapping.strategy': 'MULTI_EDGE',
                'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
                'elk.spacing.nodeNode': '36',
                'elk.layered.spacing.nodeNodeBetweenLayers': '64',
                'elk.layered.wrapping.additionalEdgeSpacing': '24',
                'elk.spacing.edgeEdge': '18',
                'elk.layered.spacing.edgeEdgeBetweenLayers': '18',
                'elk.layered.mergeEdges': 'false',
                'elk.padding': '[top=24,left=24,bottom=24,right=24]',
            },
            children: nodes.map((node) => ({
                id: node.id,
                width: nodeWidth,
                height: nodeHeight,
            })),
            edges: connections.map((connection) => ({
                id: connection.id,
                sources: [connection.source],
                targets: [connection.target],
            })),
        };
    }

    private static routeFitsModel(
        route: readonly GraphEdgePoint[],
        connection: WorkflowConnection,
        nodes: readonly DirectorNode[],
        automaticPositions: ReadonlyMap<string, GraphNodePosition>,
    ): boolean {
        const source = nodes.find((node) => node.id === connection.source);
        const target = nodes.find((node) => node.id === connection.target);

        if (source?.position || target?.position) {
            return false;
        }

        return !nodes.some((node) => {
            if (node.id === connection.source || node.id === connection.target) {
                return false;
            }

            const position = node.position ?? automaticPositions.get(node.id);

            if (!position) {
                return false;
            }

            return GraphAutoLayout.routeCrossesNode(route, position);
        });
    }

    private static routeCrossesNode(
        route: readonly GraphEdgePoint[],
        position: GraphNodePosition,
    ): boolean {
        const padding = 8;
        const left = position.x - padding;
        const right = position.x + nodeWidth + padding;
        const top = position.y - padding;
        const bottom = position.y + nodeHeight + padding;

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
    }
}
