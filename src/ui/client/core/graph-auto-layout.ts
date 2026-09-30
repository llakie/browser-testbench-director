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

                if (!section) {
                    return [];
                }

                return [
                    [
                        edge.id,
                        [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
                            (point) => ({ x: point.x, y: point.y }),
                        ),
                    ] as const,
                ];
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
}
