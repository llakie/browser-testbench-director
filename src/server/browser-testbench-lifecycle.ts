import { spawn, type ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface BrowserTestbenchStatus {
    readonly running: boolean;
    readonly managed: boolean;
}

interface BrowserTestbenchProcessState {
    process?: ChildProcess;
}

const processStateKey = Symbol.for('browser-testbench-director.lifecycle');
const processStateRegistry = globalThis as typeof globalThis & {
    [processStateKey]?: BrowserTestbenchProcessState;
};

export class BrowserTestbenchLifecycle {
    private readonly state = (processStateRegistry[processStateKey] ??= {});

    constructor(
        private readonly serverUrl: string,
        private readonly clientVersion: string,
        private readonly executable: string,
    ) {}

    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        try {
            if (request.method === 'GET') {
                this.json(response, 200, await this.status());
                return;
            }
            if (request.method === 'POST') {
                this.json(response, 200, await this.start());
                return;
            }
            if (request.method === 'DELETE') {
                this.json(response, 200, await this.stop());
                return;
            }
            this.json(response, 405, { error: 'Method not allowed.' });
        } catch (error) {
            this.json(response, 500, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async status(): Promise<BrowserTestbenchStatus> {
        return {
            running: await this.isReachable(),
            managed: this.state.process !== undefined,
        };
    }

    private async start(): Promise<BrowserTestbenchStatus> {
        if (await this.isReachable()) return this.status();

        const url = new URL(this.serverUrl);
        this.state.process = spawn(
            this.executable,
            ['start', '--no-open', '--host', url.hostname, '--port', url.port],
            { stdio: 'ignore' },
        );
        this.state.process.once('exit', () => {
            this.state.process = undefined;
        });

        for (let attempt = 0; attempt < 60; attempt += 1) {
            if (await this.isReachable()) return this.status();
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        }
        await this.stopManagedProcess();
        throw new Error('Browser Testbench did not become ready in time.');
    }

    private async stop(): Promise<BrowserTestbenchStatus> {
        if (!this.state.process && (await this.isReachable())) {
            throw new Error('Browser Testbench was started outside Director and remains running.');
        }
        await this.stopManagedProcess();
        return this.status();
    }

    private async stopManagedProcess(): Promise<void> {
        const child = this.state.process;
        if (!child) return;
        this.state.process = undefined;
        if (child.exitCode !== null || child.signalCode !== null) return;

        await new Promise<void>((resolveStopped) => {
            const forceTimer = setTimeout(() => child.kill('SIGKILL'), 3_000);
            child.once('exit', () => {
                clearTimeout(forceTimer);
                resolveStopped();
            });
            child.kill('SIGTERM');
        });
    }

    async close(): Promise<void> {
        await this.stopManagedProcess();
    }

    private async isReachable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.serverUrl}/v1/targets`, {
                headers: { 'x-browser-testbench-version': this.clientVersion },
                signal: AbortSignal.timeout(2_000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    private json(response: ServerResponse, status: number, payload: unknown): void {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(payload));
    }
}
