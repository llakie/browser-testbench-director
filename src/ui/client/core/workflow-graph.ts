import type { DirectorProject, WorkflowConnection } from './project-format.js';

export type ConnectionIssue =
    | 'self'
    | 'website-target'
    | 'input-target'
    | 'capability-target'
    | 'audio-target'
    | 'video-output-source'
    | 'screenshot-output-source'
    | 'target-occupied'
    | 'cycle';

export class WorkflowConnectionError extends TypeError {
    constructor(readonly issue: ConnectionIssue) {
        super(`Invalid workflow connection: ${issue}`);
    }
}

export class WorkflowGraph {
    static orderedNodeIds(project: DirectorProject): string[] {
        const websiteId = project.nodes.find((node) => node.type === 'website')?.id;

        if (!websiteId) {
            return [];
        }

        const reachable = WorkflowGraph.descendants(project.connections, websiteId);
        reachable.add(websiteId);
        return WorkflowGraph.topologicalNodeIds(project, reachable);
    }

    static connectedNodeIds(project: DirectorProject): ReadonlySet<string> {
        const connected = new Set(WorkflowGraph.orderedNodeIds(project));
        const websiteId = project.nodes.find((node) => node.type === 'website')?.id;

        if (!websiteId) {
            return connected;
        }

        const pending = [...connected];

        while (pending.length) {
            const target = pending.pop()!;

            for (const connection of project.connections) {
                if (connection.target !== target || connected.has(connection.source)) {
                    continue;
                }

                connected.add(connection.source);
                pending.push(connection.source);
            }
        }

        return connected;
    }

    static componentNodeIds(project: DirectorProject, nodeId: string): string[] {
        const ancestors = WorkflowGraph.ancestors(project.connections, nodeId);
        ancestors.add(nodeId);
        return WorkflowGraph.topologicalNodeIds(project, ancestors);
    }

    static predecessorIds(project: DirectorProject, nodeId: string): string[] {
        return project.connections
            .filter((connection) => connection.target === nodeId)
            .map((connection) => connection.source);
    }

    static createConnection(
        project: DirectorProject,
        source: string,
        target: string,
    ): WorkflowConnection {
        const nodeIds = new Set(project.nodes.map((node) => node.id));

        if (!nodeIds.has(source) || !nodeIds.has(target)) {
            throw new TypeError('A workflow connection must reference existing nodes.');
        }

        if (source === target) {
            throw new WorkflowConnectionError('self');
        }

        const targetNode = project.nodes.find((node) => node.id === target);
        const sourceNode = project.nodes.find((node) => node.id === source);

        if (sourceNode?.type === 'video-output') {
            throw new WorkflowConnectionError('video-output-source');
        }

        if (sourceNode?.type === 'screenshot-output') {
            throw new WorkflowConnectionError('screenshot-output-source');
        }

        if (
            targetNode?.type === 'website' &&
            !['input', 'capability'].includes(sourceNode?.type ?? '')
        ) {
            throw new WorkflowConnectionError('website-target');
        }

        if (targetNode?.type === 'input') {
            throw new WorkflowConnectionError('input-target');
        }

        if (targetNode?.type === 'capability' && sourceNode?.type !== 'input') {
            throw new WorkflowConnectionError('capability-target');
        }

        if (
            sourceNode?.type === 'input' &&
            !['website', 'capability', 'audio'].includes(targetNode?.type ?? '')
        ) {
            throw new WorkflowConnectionError('input-target');
        }

        if (sourceNode?.type === 'capability' && targetNode?.type !== 'website') {
            throw new WorkflowConnectionError('capability-target');
        }

        if (targetNode?.type === 'audio') {
            const incomingNodes = project.connections
                .filter((connection) => connection.target === target)
                .map((connection) => project.nodes.find((node) => node.id === connection.source));
            const matchingIncoming = incomingNodes.some(
                (node) => (node?.type === 'input') === (sourceNode?.type === 'input'),
            );

            if (matchingIncoming) {
                throw new WorkflowConnectionError('audio-target');
            }
        }

        if (
            project.connections.some(
                (connection) => connection.source === source && connection.target === target,
            )
        ) {
            throw new WorkflowConnectionError('target-occupied');
        }

        if (
            targetNode?.type !== 'website' &&
            targetNode?.type !== 'merge' &&
            targetNode?.type !== 'audio' &&
            project.connections.some((connection) => connection.target === target)
        ) {
            throw new WorkflowConnectionError('target-occupied');
        }

        if (WorkflowGraph.hasPath(project.connections, target, source)) {
            throw new WorkflowConnectionError('cycle');
        }

        return { id: WorkflowGraph.connectionId(source, target), source, target };
    }

    static assertValid(project: DirectorProject): void {
        const nodeIds = new Set(project.nodes.map((node) => node.id));
        const connectionIds = new Set<string>();
        const targets = new Set<string>();
        const nodes = new Map(project.nodes.map((node) => [node.id, node]));

        for (const connection of project.connections) {
            if (!connection.id || connectionIds.has(connection.id)) {
                throw new TypeError(`Duplicate or empty connection id: ${connection.id}`);
            }

            connectionIds.add(connection.id);

            if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) {
                throw new TypeError(`Connection ${connection.id} references an unknown node.`);
            }

            if (connection.source === connection.target) {
                throw new TypeError(`Connection ${connection.id} connects a node to itself.`);
            }

            const sourceNode = nodes.get(connection.source);
            const targetNode = nodes.get(connection.target);

            if (targetNode?.type === 'input') {
                throw new TypeError('Input nodes cannot have incoming connections.');
            }

            if (
                targetNode?.type === 'website' &&
                !['input', 'capability'].includes(sourceNode?.type ?? '')
            ) {
                throw new TypeError(
                    'Only input and capability nodes may connect to the website root.',
                );
            }

            if (targetNode?.type === 'capability' && sourceNode?.type !== 'input') {
                throw new TypeError('Capability nodes must receive an input node.');
            }

            if (
                sourceNode?.type === 'input' &&
                !['website', 'capability', 'audio'].includes(targetNode?.type ?? '')
            ) {
                throw new TypeError(
                    'Input nodes must connect to an audio node, capability, or website root.',
                );
            }

            if (sourceNode?.type === 'capability' && targetNode?.type !== 'website') {
                throw new TypeError('Capability nodes must connect to the website root.');
            }

            if (sourceNode?.type === 'video-output') {
                throw new TypeError('Video output nodes cannot have outgoing connections.');
            }

            if (sourceNode?.type === 'screenshot-output') {
                throw new TypeError('Screenshot output nodes cannot have outgoing connections.');
            }

            if (
                targetNode?.type !== 'website' &&
                targetNode?.type !== 'merge' &&
                targetNode?.type !== 'audio' &&
                targets.has(connection.target)
            ) {
                throw new TypeError(
                    `Only merge nodes may have multiple incoming connections: ${connection.target}.`,
                );
            }

            targets.add(connection.target);
        }

        if (
            WorkflowGraph.containsCycle(
                project.nodes.map((node) => node.id),
                project.connections,
            )
        ) {
            throw new TypeError('Workflow connections must not contain a cycle.');
        }

        for (const node of project.nodes) {
            if (node.type === 'capability') {
                const incoming = project.connections.filter(
                    (connection) => connection.target === node.id,
                );
                const outgoing = project.connections.filter(
                    (connection) => connection.source === node.id,
                );

                if (outgoing.length && incoming.length !== 1) {
                    throw new TypeError(
                        'A connected capability node must receive exactly one input.',
                    );
                }

                if (incoming.length && outgoing.length !== 1) {
                    throw new TypeError(
                        'A connected capability node must connect to the website root.',
                    );
                }
            }

            if (node.type === 'merge') {
                const incoming = project.connections.filter(
                    (connection) => connection.target === node.id,
                );

                if (incoming.length > 0 && incoming.length < 2) {
                    throw new TypeError(
                        'A connected merge node must receive at least two branches.',
                    );
                }
            }

            if (node.type === 'audio') {
                const incoming = project.connections
                    .filter((connection) => connection.target === node.id)
                    .map((connection) => nodes.get(connection.source));
                const inputs = incoming.filter((candidate) => candidate?.type === 'input');
                const flow = incoming.filter((candidate) => candidate?.type !== 'input');

                if (inputs.length > 1 || flow.length > 1) {
                    throw new TypeError(
                        'An audio node may receive one file input and one workflow predecessor.',
                    );
                }

                if (flow.length > 0 && inputs.length !== 1) {
                    throw new TypeError(
                        'A connected audio node must receive exactly one file input.',
                    );
                }
            }

            if (node.type === 'video-output') {
                const incoming = project.connections.filter(
                    (connection) => connection.target === node.id,
                );
                const outgoing = project.connections.filter(
                    (connection) => connection.source === node.id,
                );

                if (incoming.length > 1 || outgoing.length !== 0) {
                    throw new TypeError(
                        'A video output node may have one input and must have no output.',
                    );
                }
            }

            if (node.type === 'screenshot-output') {
                const incoming = project.connections.filter(
                    (connection) => connection.target === node.id,
                );
                const outgoing = project.connections.filter(
                    (connection) => connection.source === node.id,
                );

                if (incoming.length > 1 || outgoing.length !== 0) {
                    throw new TypeError(
                        'A screenshot output node may have one input and must have no output.',
                    );
                }
            }
        }
    }

    private static topologicalNodeIds(
        project: DirectorProject,
        included: ReadonlySet<string>,
    ): string[] {
        const modelOrder = new Map(project.nodes.map((node, index) => [node.id, index]));
        const incomingCounts = new Map(
            [...included].map((id) => [
                id,
                project.connections.filter(
                    (connection) => connection.target === id && included.has(connection.source),
                ).length,
            ]),
        );
        const ready = [...included].filter((id) => incomingCounts.get(id) === 0);
        const sortReady = (): void => {
            ready.sort(
                (left, right) =>
                    (modelOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
                    (modelOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
            );
        };
        sortReady();
        const result: string[] = [];

        while (ready.length) {
            const id = ready.shift()!;
            result.push(id);

            for (const connection of project.connections) {
                if (connection.source !== id || !included.has(connection.target)) {
                    continue;
                }

                const remaining = (incomingCounts.get(connection.target) ?? 1) - 1;
                incomingCounts.set(connection.target, remaining);

                if (remaining === 0) {
                    ready.push(connection.target);
                }
            }

            sortReady();
        }

        return result;
    }

    private static ancestors(
        connections: readonly WorkflowConnection[],
        nodeId: string,
    ): Set<string> {
        const result = new Set<string>();
        const pending = [nodeId];

        while (pending.length) {
            const target = pending.pop()!;

            for (const connection of connections) {
                if (connection.target !== target || result.has(connection.source)) {
                    continue;
                }

                result.add(connection.source);
                pending.push(connection.source);
            }
        }

        return result;
    }

    private static descendants(
        connections: readonly WorkflowConnection[],
        nodeId: string,
    ): Set<string> {
        const result = new Set<string>();
        const pending = [nodeId];

        while (pending.length) {
            const source = pending.pop()!;

            for (const connection of connections) {
                if (connection.source !== source || result.has(connection.target)) {
                    continue;
                }

                result.add(connection.target);
                pending.push(connection.target);
            }
        }

        return result;
    }

    private static containsCycle(
        nodeIds: readonly string[],
        connections: readonly WorkflowConnection[],
    ): boolean {
        const outgoing = new Map<string, string[]>();

        for (const connection of connections) {
            const targets = outgoing.get(connection.source) ?? [];
            targets.push(connection.target);
            outgoing.set(connection.source, targets);
        }

        const visiting = new Set<string>();
        const visited = new Set<string>();
        const visit = (id: string): boolean => {
            if (visiting.has(id)) {
                return true;
            }

            if (visited.has(id)) {
                return false;
            }

            visiting.add(id);

            if ((outgoing.get(id) ?? []).some(visit)) {
                return true;
            }

            visiting.delete(id);
            visited.add(id);
            return false;
        };
        return nodeIds.some(visit);
    }

    private static hasPath(
        connections: readonly WorkflowConnection[],
        source: string,
        target: string,
    ): boolean {
        const visited = new Set<string>();
        const pending = [source];

        while (pending.length) {
            const current = pending.pop()!;

            if (current === target) {
                return true;
            }

            if (visited.has(current)) {
                continue;
            }

            visited.add(current);

            for (const connection of connections) {
                if (connection.source === current) {
                    pending.push(connection.target);
                }
            }
        }

        return false;
    }

    private static connectionId(source: string, target: string): string {
        return `${source}--${target}`;
    }
}
