import type { DirectorProject, WorkflowConnection } from './project-format.js';

export type ConnectionIssue =
    | 'self'
    | 'website-target'
    | 'input-target'
    | 'capability-target'
    | 'source-occupied'
    | 'target-occupied'
    | 'cycle';

export class WorkflowConnectionError extends TypeError {
    constructor(readonly issue: ConnectionIssue) {
        super(`Invalid workflow connection: ${issue}`);
    }
}

export class WorkflowGraph {
    static orderedNodeIds(project: DirectorProject): string[] {
        const first =
            project.nodes.find((node) => node.type === 'website')?.id ??
            project.nodes.find(
                (node) => !project.connections.some((connection) => connection.target === node.id),
            )?.id;
        if (!first) return [];
        const outgoing = new Map(
            project.connections.map((connection) => [connection.source, connection.target]),
        );
        const ordered: string[] = [];
        let current: string | undefined = first;
        while (current && !ordered.includes(current)) {
            ordered.push(current);
            current = outgoing.get(current);
        }
        return ordered;
    }

    static connectedNodeIds(project: DirectorProject): ReadonlySet<string> {
        const connected = new Set(WorkflowGraph.orderedNodeIds(project));
        const websiteId = project.nodes.find((node) => node.type === 'website')?.id;
        if (!websiteId) return connected;
        const pending = [websiteId];
        while (pending.length) {
            const target = pending.pop()!;
            for (const connection of project.connections) {
                if (connection.target !== target || connected.has(connection.source)) continue;
                connected.add(connection.source);
                pending.push(connection.source);
            }
        }
        return connected;
    }

    static componentNodeIds(project: DirectorProject, nodeId: string): string[] {
        const workflow = WorkflowGraph.orderedNodeIds(project);
        if (workflow.includes(nodeId)) return workflow;
        const incoming = new Map(
            project.connections
                .filter(
                    (connection) =>
                        project.nodes.find((node) => node.id === connection.target)?.type !==
                        'website',
                )
                .map((connection) => [connection.target, connection.source]),
        );
        let first = nodeId;
        const visited = new Set<string>();
        while (incoming.has(first) && !visited.has(first)) {
            visited.add(first);
            first = incoming.get(first)!;
        }
        const outgoing = new Map(
            project.connections.map((connection) => [connection.source, connection.target]),
        );
        const ordered: string[] = [];
        let current: string | undefined = first;
        while (current && !ordered.includes(current)) {
            ordered.push(current);
            current = outgoing.get(current);
        }
        return ordered;
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
        if (source === target) throw new WorkflowConnectionError('self');
        const targetNode = project.nodes.find((node) => node.id === target);
        const sourceNode = project.nodes.find((node) => node.id === source);
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
            !['website', 'capability'].includes(targetNode?.type ?? '')
        ) {
            throw new WorkflowConnectionError('input-target');
        }
        if (sourceNode?.type === 'capability' && targetNode?.type !== 'website') {
            throw new WorkflowConnectionError('capability-target');
        }
        if (project.connections.some((connection) => connection.source === source)) {
            throw new WorkflowConnectionError('source-occupied');
        }
        if (
            targetNode?.type !== 'website' &&
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
        const sources = new Set<string>();
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
                !['website', 'capability'].includes(targetNode?.type ?? '')
            ) {
                throw new TypeError('Input nodes must connect to a capability or website root.');
            }
            if (sourceNode?.type === 'capability' && targetNode?.type !== 'website') {
                throw new TypeError('Capability nodes must connect to the website root.');
            }
            if (sources.has(connection.source)) {
                throw new TypeError(`Node ${connection.source} has multiple outgoing connections.`);
            }
            if (targetNode?.type !== 'website' && targets.has(connection.target)) {
                throw new TypeError(`Node ${connection.target} has multiple incoming connections.`);
            }
            sources.add(connection.source);
            targets.add(connection.target);
        }
        for (const connection of project.connections) {
            if (WorkflowGraph.hasPath(project.connections, connection.target, connection.source)) {
                throw new TypeError('Workflow connections must not contain a cycle.');
            }
        }
        for (const node of project.nodes) {
            if (node.type !== 'capability') continue;
            const incoming = project.connections.filter(
                (connection) => connection.target === node.id,
            );
            const outgoing = project.connections.filter(
                (connection) => connection.source === node.id,
            );
            if (outgoing.length && incoming.length !== 1) {
                throw new TypeError('A connected capability node must receive exactly one input.');
            }
            if (incoming.length && outgoing.length !== 1) {
                throw new TypeError(
                    'A connected capability node must connect to the website root.',
                );
            }
        }
    }

    private static hasPath(
        connections: readonly WorkflowConnection[],
        source: string,
        target: string,
    ): boolean {
        const outgoing = new Map(
            connections.map((connection) => [connection.source, connection.target]),
        );
        const visited = new Set<string>();
        let current: string | undefined = source;
        while (current && !visited.has(current)) {
            if (current === target) return true;
            visited.add(current);
            current = outgoing.get(current);
        }
        return false;
    }

    private static connectionId(source: string, target: string): string {
        return `${source}--${target}`;
    }
}
