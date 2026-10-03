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

export function rebaseRouteToAnchors(
    route: readonly GraphEdgePoint[],
    sourceAnchor: GraphEdgePoint,
    targetAnchor: GraphEdgePoint,
): GraphEdgePoint[] {
    const interior = route.slice(1, -1);

    if (interior.length === 0) {
        return [sourceAnchor, targetAnchor];
    }

    const first = interior[0]!;
    const last = interior.at(-1)!;

    return simplifyRoute([
        sourceAnchor,
        { x: first.x, y: sourceAnchor.y },
        ...interior,
        { x: last.x, y: targetAnchor.y },
        targetAnchor,
    ]);
}

const nodeWidth = 216;
const nodeHeight = 112;

function simplifyRoute(route: readonly GraphEdgePoint[]): GraphEdgePoint[] {
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
        GraphAutoLayout.resolveOverlaps(nodes, positions);
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
                ].map((point) => ({
                    x: Math.round(point.x),
                    y: Math.round(point.y),
                }));

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

    private static resolveOverlaps(
        nodes: readonly DirectorNode[],
        positions: Map<string, GraphNodePosition>,
    ): void {
        const fixed = nodes.filter((node) => node.position !== null);
        const automatic = nodes.filter((node) => node.position === null);
        const occupied = fixed.map((node) => node.position!);

        for (const node of fixed) {
            positions.set(node.id, node.position!);
        }

        for (const node of automatic) {
            const desired = positions.get(node.id) ?? { x: 0, y: 0 };
            const position = GraphAutoLayout.closestFreePosition(desired, occupied);
            positions.set(node.id, position);
            occupied.push(position);
        }
    }

    private static closestFreePosition(
        desired: GraphNodePosition,
        occupied: readonly GraphNodePosition[],
    ): GraphNodePosition {
        if (!occupied.some((position) => GraphAutoLayout.positionsOverlap(desired, position))) {
            return desired;
        }

        const horizontalStep = nodeWidth + 36;
        const verticalStep = nodeHeight + 36;

        for (let radius = 1; radius <= occupied.length + 1; radius += 1) {
            for (let vertical = -radius; vertical <= radius; vertical += 1) {
                const horizontal = radius - Math.abs(vertical);
                const directions = horizontal === 0 ? [0] : [-horizontal, horizontal];

                for (const direction of directions) {
                    const candidate = {
                        x: desired.x + direction * horizontalStep,
                        y: desired.y + vertical * verticalStep,
                    };

                    if (
                        !occupied.some((position) =>
                            GraphAutoLayout.positionsOverlap(candidate, position),
                        )
                    ) {
                        return candidate;
                    }
                }
            }
        }

        return {
            x: desired.x,
            y: desired.y + (occupied.length + 1) * verticalStep,
        };
    }

    private static positionsOverlap(left: GraphNodePosition, right: GraphNodePosition): boolean {
        const spacing = 24;
        return (
            left.x < right.x + nodeWidth + spacing &&
            left.x + nodeWidth + spacing > right.x &&
            left.y < right.y + nodeHeight + spacing &&
            left.y + nodeHeight + spacing > right.y
        );
    }
}
