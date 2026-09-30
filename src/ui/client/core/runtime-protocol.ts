import type { AudioEnvelopePoint, BrowserWaitNode, LayerNode } from './project-format.js';

export interface RuntimeStep {
    readonly id: string;
    readonly type: 'layer' | 'javascript' | 'browser-action' | 'browser-wait' | 'merge' | 'audio';
    readonly speed: 'catchup' | 'live';
    readonly after?: readonly string[];
    readonly source: string;
    readonly html?: string;
    readonly css?: string;
    readonly placement?: LayerNode['placement'];
    readonly playback?: LayerNode['playback'];
    readonly condition?: BrowserWaitNode['condition'];
    readonly selector?: string;
    readonly value?: string;
    readonly script?: string;
    readonly timeoutMs?: number;
    readonly omitFromRecording?: boolean;
    readonly waitFor?: 'all' | 'any';
    readonly inputId?: string;
    readonly volume?: number;
    readonly envelope?: readonly AudioEnvelopePoint[];
    readonly waitForEnd?: boolean;
    readonly durationMs?: number;
}

export async function executeRuntimeGraph(
    steps: readonly RuntimeStep[],
    execute: (step: RuntimeStep, signal: AbortSignal) => Promise<void>,
): Promise<void> {
    const executions = new Map<string, Promise<void>>();
    const controllers = new Map<string, AbortController>();
    const stepsById = new Map(steps.map((step) => [step.id, step]));
    let previousId: string | undefined;

    const ancestors = (id: string, result = new Set<string>()): Set<string> => {
        if (result.has(id)) {
            return result;
        }

        result.add(id);
        const step = stepsById.get(id);

        for (const dependencyId of step?.after ?? []) {
            ancestors(dependencyId, result);
        }

        return result;
    };

    const cancelLosingBranches = (winnerId: string, dependencyIds: readonly string[]): void => {
        const winnerBranch = ancestors(winnerId);

        for (const dependencyId of dependencyIds) {
            if (dependencyId === winnerId) {
                continue;
            }

            for (const nodeId of ancestors(dependencyId)) {
                if (!winnerBranch.has(nodeId)) {
                    controllers.get(nodeId)?.abort();
                }
            }
        }
    };

    for (const step of steps) {
        const dependencyIds = step.after ?? (previousId ? [previousId] : []);
        const dependencies = dependencyIds.map((id) => {
            const execution = executions.get(id);

            if (!execution) {
                throw new TypeError(`Runtime dependency not found: ${id}`);
            }

            return execution;
        });
        const controller = new AbortController();
        controllers.set(step.id, controller);
        const ready = (() => {
            if (dependencies.length === 0) {
                return Promise.resolve();
            }

            if (step.type !== 'merge' || step.waitFor !== 'any') {
                return Promise.all(dependencies).then(() => undefined);
            }

            return Promise.race(
                dependencies.map((dependency, index) =>
                    dependency.then(() => dependencyIds[index]!),
                ),
            ).then((winnerId) => cancelLosingBranches(winnerId, dependencyIds));
        })();
        executions.set(
            step.id,
            ready.then(async () => {
                if (step.type === 'merge' || controller.signal.aborted) {
                    return;
                }

                try {
                    await execute(step, controller.signal);
                } catch (error) {
                    if (controller.signal.aborted && isAbortError(error)) {
                        return;
                    }

                    throw error;
                }
            }),
        );
        previousId = step.id;
    }

    await Promise.all(executions.values());
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

export class DirectorRuntimeScript {
    static apiFactory(): string {
        return `
function createDirectorRuntime(
    speed,
    root,
    targetDocument,
    signal,
    previousResults = {},
    inputs = {},
    currentDocument = () => targetDocument,
) {
    const aborted = () => {
        if (!signal?.aborted) return;
        throw new DOMException('The execution was stopped.', 'AbortError');
    };
    return Object.freeze({
        root,
        document: targetDocument,
        results: Object.freeze({ ...previousResults }),
        inputs: Object.freeze({ ...inputs }),
        speed,
        wait(milliseconds) {
            aborted();
            if (speed === 'catchup') return Promise.resolve();
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(resolve, Math.max(0, milliseconds));
                signal?.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    reject(new DOMException('The execution was stopped.', 'AbortError'));
                }, { once: true });
            });
        },
        async waitFor(selector, timeout = 5000) {
            const started = Date.now();
            while (Date.now() - started <= timeout) {
                aborted();
                const match = currentDocument().querySelector(selector);
                if (match) return match;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            throw new Error('Timed out waiting for ' + selector);
        },
        async waitForUrl(value, timeout = 5000) {
            const started = Date.now();
            while (Date.now() - started <= timeout) {
                aborted();
                if (currentDocument().defaultView?.location.href.includes(value)) return value;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            throw new Error('Timed out waiting for URL ' + value);
        },
        async waitForScript(source, timeout = 5000) {
            const started = Date.now();
            while (Date.now() - started <= timeout) {
                aborted();
                const document = currentDocument();
                const evaluate = createDirectorAsyncFunction(
                    document,
                    'document',
                    'window',
                    source,
                );
                const result = await evaluate(document, document.defaultView || window);
                if (result) return result;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            throw new Error('Timed out waiting for script condition.');
        },
    });
}

function createDirectorAsyncFunction(targetDocument, ...parameters) {
    const targetWindow = targetDocument.defaultView || window;
    const AsyncFunction = targetWindow.Function(
        'return Object.getPrototypeOf(async function () {}).constructor',
    )();
    return new AsyncFunction(...parameters);
}`;
    }
}
