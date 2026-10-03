import type { RuntimeStep } from '../../src/ui/client/core/runtime-protocol.js';
import { MERGE_RACE_ABORT_REASON } from '../../src/ui/client/core/runtime-protocol.js';

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
                    controllers.get(nodeId)?.abort(MERGE_RACE_ABORT_REASON);
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
