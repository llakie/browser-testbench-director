export type NodeExecutionStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled';

export interface NodeExecutionState {
    readonly status: NodeExecutionStatus;
    readonly error?: string;
}

export interface ExecutionSnapshot {
    readonly runId: number;
    readonly running: boolean;
    readonly activeNodeId: string | null;
    readonly nodes: Readonly<Record<string, NodeExecutionState>>;
}

export class ExecutionController {
    #runId = 0;
    #running = false;
    #activeNodeId: string | null = null;
    #nodes: Record<string, NodeExecutionState> = {};

    begin(nodeIds: readonly string[]): number | null {
        if (this.#running) return null;
        this.#runId += 1;
        this.#running = true;
        this.#activeNodeId = null;
        this.#nodes = Object.fromEntries(
            nodeIds.map((nodeId) => [nodeId, { status: 'idle' as const }]),
        );
        return this.#runId;
    }

    update(runId: number, nodeId: string, status: NodeExecutionStatus, error?: string): boolean {
        if (!this.#running || runId !== this.#runId || !(nodeId in this.#nodes)) return false;
        this.#nodes[nodeId] = error ? { status, error } : { status };
        if (status === 'running') this.#activeNodeId = nodeId;
        else if (this.#activeNodeId === nodeId) this.#activeNodeId = null;
        return true;
    }

    complete(runId: number): boolean {
        if (!this.#running || runId !== this.#runId) return false;
        for (const [nodeId, state] of Object.entries(this.#nodes)) {
            if (state.status === 'running') this.#nodes[nodeId] = { status: 'success' };
        }
        this.#running = false;
        this.#activeNodeId = null;
        return true;
    }

    stop(): boolean {
        if (!this.#running) return false;
        for (const [nodeId, state] of Object.entries(this.#nodes)) {
            if (state.status === 'running') this.#nodes[nodeId] = { status: 'cancelled' };
        }
        this.#running = false;
        this.#activeNodeId = null;
        this.#runId += 1;
        return true;
    }

    clear(nodeId: string): boolean {
        if (this.#running || !(nodeId in this.#nodes)) return false;
        delete this.#nodes[nodeId];
        return true;
    }

    snapshot(): ExecutionSnapshot {
        return {
            runId: this.#runId,
            running: this.#running,
            activeNodeId: this.#activeNodeId,
            nodes: structuredClone(this.#nodes),
        };
    }
}
