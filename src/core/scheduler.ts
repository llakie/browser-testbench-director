import { RealClock } from './clock.js';
import type {
    ActionNode,
    BrowserSession,
    ClipNode,
    Clock,
    MarkNode,
    Production,
    ProductionRuntimeContext,
    RenderedAudioClip,
    RunNode,
    TimelineContext,
    TimelineDefinition,
    TimelineEvent,
    TimelineExecutionResult,
    TimelineGraph,
    TimelineInterval,
    TimelineLogger,
    TimelineResult,
    TimelineState,
    WaitNode,
} from './types.js';
import { validateGraph, validateRunNode } from './validation.js';

interface ActionPlanEvent {
    readonly kind: 'action';
    readonly node: ActionNode;
    readonly offset: number;
}
interface MarkPlanEvent {
    readonly kind: 'mark';
    readonly node: MarkNode;
    readonly offset: number;
}
interface ClipPlanEvent {
    readonly kind: 'start' | 'end';
    readonly node: ClipNode;
    readonly offset: number;
}
type PlanEvent = ActionPlanEvent | MarkPlanEvent | ClipPlanEvent;
interface RunPlan {
    readonly duration: number;
    readonly events: readonly PlanEvent[];
}
interface WaitExecutionContext {
    readonly timelineId: string;
    readonly timeout: number;
    readonly productionContext: ProductionRuntimeContext;
    readonly signal?: AbortSignal;
}
interface TimelineRunnerOptions {
    readonly production: Production;
    readonly graph: TimelineGraph;
    readonly session: BrowserSession;
    readonly clock?: Clock;
    readonly logger?: TimelineLogger;
}
interface TimelineRuntimeError extends Error {
    code?: string;
    timelineResult?: TimelineResult;
}

const EVENT_PRIORITY: Readonly<Record<PlanEvent['kind'], number>> = Object.freeze({
    end: 0,
    mark: 1,
    action: 2,
    start: 3,
});

export class TimelineRunner {
    readonly #production: Production;
    readonly #graph: TimelineGraph;
    readonly #session: BrowserSession;
    readonly #clock: Clock;
    readonly #logger: TimelineLogger;
    readonly #controller = new AbortController();
    readonly #events: TimelineEvent[] = [];
    readonly #states = new Map<string, TimelineState>();
    readonly #results = new Map<string, TimelineExecutionResult>();
    readonly #intervals: TimelineInterval[] = [];
    #sequence = 0;

    constructor({
        production,
        graph,
        session,
        clock = new RealClock(),
        logger = console,
    }: TimelineRunnerOptions) {
        this.#production = production;
        this.#graph = graph;
        this.#session = session;
        this.#clock = clock;
        this.#logger = logger;
        validateGraph(graph);
        for (const entry of graph.timelines) this.#states.set(entry.id, 'pending');
    }

    async run(context: ProductionRuntimeContext = {}): Promise<TimelineResult> {
        const startedAt = this.#clock.now();
        this.#log('production.started', { productionId: this.#production.id });
        const executions = new Map<string, Promise<TimelineExecutionResult | undefined>>();
        const execute = (
            entry: TimelineDefinition,
        ): Promise<TimelineExecutionResult | undefined> => {
            const existing = executions.get(entry.id);
            if (existing) return existing;
            const task = this.#executeTimeline(entry, execute, context).catch((error: unknown) => {
                this.#controller.abort(error);
                throw error;
            });
            executions.set(entry.id, task);
            return task;
        };

        try {
            await Promise.all(this.#graph.timelines.map(execute));
            this.#log('production.completed', { productionId: this.#production.id });
            return this.#result(startedAt, this.#clock.now());
        } catch (caught: unknown) {
            await Promise.allSettled([...executions.values()]);
            const error = asTimelineError(caught);
            this.#log('production.failed', { message: error.message });
            error.timelineResult = this.#result(startedAt, this.#clock.now());
            throw error;
        }
    }

    async #executeTimeline(
        entry: TimelineDefinition,
        execute: (entry: TimelineDefinition) => Promise<TimelineExecutionResult | undefined>,
        productionContext: ProductionRuntimeContext,
    ): Promise<TimelineExecutionResult | undefined> {
        await Promise.all(entry.after.map((id) => execute(this.#timelineById(id))));
        this.#throwIfAborted();
        this.#setState(entry.id, 'armed');
        const triggerResult = await this.#executeWait(entry.trigger, {
            timelineId: entry.id,
            timeout: this.#production.triggerTimeout,
            productionContext,
        });
        this.#results.set(entry.id, Object.freeze({ trigger: triggerResult }));
        this.#throwIfAborted();

        const timelineContext: TimelineContext = Object.freeze({
            session: this.#session,
            signal: this.#controller.signal,
            triggerResult,
            productionContext,
            results: this.#results,
            timelineId: entry.id,
        });
        const runNode = typeof entry.run === 'function' ? entry.run(timelineContext) : entry.run;
        const validation = validateRunNode(runNode, `Timeline "${entry.id}"`);
        if (validation.hasOpenClip && !validation.hasDuration) {
            throw new Error(
                `Timeline "${entry.id}" enthält nur offene Clips und besitzt kein Ende.`,
            );
        }

        this.#setState(entry.id, 'running');
        const start = this.#clock.now();
        const plan = compileRun(runNode, validation.duration);
        if (plan.duration > 0) {
            this.#intervals.push({ start, end: start + plan.duration, timelineId: entry.id });
        }
        await this.#executePlan(entry, plan, timelineContext, start);
        this.#setState(entry.id, 'completed');
        return this.#results.get(entry.id);
    }

    async #executePlan(
        entry: TimelineDefinition,
        plan: RunPlan,
        context: TimelineContext,
        start: number,
    ): Promise<void> {
        const pendingActions: Promise<unknown>[] = [];
        const activeClips = new Map<string, ClipNode>();
        let index = 0;
        try {
            while (index < plan.events.length) {
                const offset = plan.events[index]?.offset ?? 0;
                await this.#clock.sleep(
                    Math.max(0, start + offset - this.#clock.now()),
                    this.#controller.signal,
                );
                this.#throwIfAborted();
                const batch: PlanEvent[] = [];
                while (index < plan.events.length && plan.events[index]?.offset === offset) {
                    const event = plan.events[index++];
                    if (event) batch.push(event);
                }
                for (const event of batch) {
                    if (event.kind === 'mark') {
                        this.#log('mark', {
                            timelineId: entry.id,
                            name: event.node.name,
                            data: event.node.data,
                        });
                    } else if (event.kind === 'action') {
                        const action = this.#executeAction(event.node, context).catch(
                            (error: unknown) => {
                                this.#controller.abort(error);
                                throw error;
                            },
                        );
                        pendingActions.push(action);
                    } else if (event.kind === 'start') {
                        await event.node.start(context);
                        activeClips.set(event.node.id, event.node);
                        this.#log(
                            event.node.mediaType === 'audio' ? 'audio.started' : 'clip.started',
                            {
                                timelineId: entry.id,
                                clipId: event.node.id,
                                ...(event.node.audio ? { audio: event.node.audio } : {}),
                            },
                        );
                    } else {
                        await event.node.end?.(context);
                        activeClips.delete(event.node.id);
                        this.#log(event.node.mediaType === 'audio' ? 'audio.ended' : 'clip.ended', {
                            timelineId: entry.id,
                            clipId: event.node.id,
                        });
                    }
                }
            }
            await this.#clock.sleep(
                Math.max(0, start + plan.duration - this.#clock.now()),
                this.#controller.signal,
            );
            await Promise.all(pendingActions);
        } finally {
            await Promise.allSettled([
                ...pendingActions,
                ...[...activeClips.values()].map((node) => Promise.resolve(node.end?.(context))),
            ]);
        }
    }

    async #executeAction(node: ActionNode, context: TimelineContext): Promise<unknown> {
        const timeout = node.timeout ?? this.#production.actionTimeout;
        this.#log('action.started', { timelineId: context.timelineId, action: node.name });
        const result = await withTimeout(
            ({ signal }) => node.handler({ ...context, signal }),
            timeout,
            this.#controller.signal,
            `Action "${node.name}"`,
        );
        this.#log('action.completed', { timelineId: context.timelineId, action: node.name });
        return result;
    }

    async #executeWait(node: WaitNode, context: WaitExecutionContext): Promise<unknown> {
        this.#throwIfAborted();
        if (node.type === 'wait-immediate') return undefined;
        if (node.type === 'wait-custom') {
            const timeout = node.timeout ?? context.timeout;
            this.#log('wait.started', { timelineId: context.timelineId, wait: node.name });
            const result = await withTimeout(
                ({ signal }) =>
                    node.handler({
                        session: this.#session,
                        signal,
                        timeout,
                        productionContext: context.productionContext,
                        results: this.#results,
                    }),
                timeout,
                context.signal ?? this.#controller.signal,
                `Wait "${node.name}"`,
            );
            this.#log('wait.completed', { timelineId: context.timelineId, wait: node.name });
            return result;
        }
        if (node.type === 'wait-sequence') {
            const results: unknown[] = [];
            for (const child of node.entries) results.push(await this.#executeWait(child, context));
            return results;
        }

        const entries = normalizedWaitEntries(node);
        if (node.type === 'wait-all') {
            const values = await Promise.all(
                entries.map(([, entry]) => this.#executeWait(entry, context)),
            );
            return node.named
                ? Object.fromEntries(entries.map(([name], index) => [name, values[index]]))
                : values;
        }

        const local = new AbortController();
        const combined = AbortSignal.any([context.signal ?? this.#controller.signal, local.signal]);
        try {
            const value = await Promise.any(
                entries.map(async ([name, entry], index) => ({
                    index,
                    name,
                    value: await this.#executeWait(entry, { ...context, signal: combined }),
                })),
            );
            return node.named ? { name: value.name, value: value.value } : value.value;
        } finally {
            local.abort(new Error('Ein anderer wait.any()-Zweig war schneller.'));
        }
    }

    #timelineById(id: string): TimelineDefinition {
        const entry = this.#graph.timelines.find((candidate) => candidate.id === id);
        if (!entry) throw new Error(`Unbekannte Vorgänger-Timeline: ${id}`);
        return entry;
    }

    #setState(timelineId: string, state: TimelineState): void {
        this.#states.set(timelineId, state);
        this.#log(`timeline.${state}`, { timelineId });
    }

    #throwIfAborted(): void {
        if (this.#controller.signal.aborted) {
            throw this.#controller.signal.reason ?? new Error('Production abgebrochen.');
        }
    }

    #log(type: string, details: Readonly<Record<string, unknown>> = {}): void {
        const event: TimelineEvent = Object.freeze({
            sequence: this.#sequence++,
            runtimeMs: this.#clock.now(),
            type,
            ...details,
        });
        this.#events.push(event);
        this.#logger.debug?.(`[timeline] ${type}`, details);
    }

    #result(startedAt: number, endedAt: number): TimelineResult {
        const intervals = mergeIntervals(this.#intervals, startedAt, endedAt);
        const audioClips = collectAudioClips(this.#events, intervals);
        return Object.freeze({
            productionId: this.#production.id,
            runtimeDurationMs: Math.max(0, endedAt - startedAt),
            mediaDurationMs: intervals.reduce(
                (sum, interval) => sum + interval.end - interval.start,
                0,
            ),
            keepIntervals: intervals,
            audioClips,
            events: [...this.#events],
            states: Object.fromEntries(this.#states),
            results: Object.fromEntries(this.#results),
        });
    }
}

function normalizedWaitEntries(
    node: Extract<WaitNode, { type: 'wait-all' | 'wait-any' }>,
): [string, WaitNode][] {
    if (node.named) return node.entries as [string, WaitNode][];
    return (node.entries as WaitNode[]).map((entry, index) => [String(index), entry]);
}

function collectAudioClips(
    events: readonly TimelineEvent[],
    intervals: readonly TimelineInterval[],
): RenderedAudioClip[] {
    const starts = new Map<string, TimelineEvent>();
    const clips: RenderedAudioClip[] = [];
    for (const event of events) {
        const key = `${event.timelineId}:${event.clipId}`;
        if (event.type === 'audio.started') starts.set(key, event);
        if (event.type !== 'audio.ended') continue;
        const start = starts.get(key);
        if (!start?.audio || !start.timelineId) continue;
        clips.push({
            ...start.audio,
            timelineId: start.timelineId,
            startMs: runtimeToMedia(start.runtimeMs, intervals),
            duration: Math.max(
                0,
                runtimeToMedia(event.runtimeMs, intervals) -
                    runtimeToMedia(start.runtimeMs, intervals),
            ),
        });
    }
    return clips;
}

function runtimeToMedia(runtime: number, intervals: readonly TimelineInterval[]): number {
    let media = 0;
    for (const interval of intervals) {
        if (runtime >= interval.end) media += interval.end - interval.start;
        else if (runtime > interval.start) return media + runtime - interval.start;
        else return media;
    }
    return media;
}

export function compileRun(node: RunNode, containingDuration: number): RunPlan {
    const events: PlanEvent[] = [];
    const compile = (entry: RunNode, offset: number): number => {
        if (entry.type === 'delay' || entry.type === 'hold') return entry.duration;
        if (entry.type === 'action') {
            events.push({ kind: 'action', node: entry, offset });
            return 0;
        }
        if (entry.type === 'mark') {
            events.push({ kind: 'mark', node: entry, offset });
            return 0;
        }
        if (entry.type === 'clip') {
            const duration = entry.duration ?? containingDuration - offset;
            events.push({ kind: 'start', node: entry, offset });
            events.push({ kind: 'end', node: entry, offset: offset + duration });
            return entry.duration ?? 0;
        }
        if (entry.type === 'sequence') {
            let cursor = offset;
            for (const child of entry.entries) cursor += compile(child, cursor);
            return cursor - offset;
        }
        if ('entries' in entry) {
            return Math.max(0, ...entry.entries.map((child) => compile(child, offset)));
        }
        throw new Error(`Unbekannter Ablaufknoten: ${entry.type}`);
    };
    const duration = compile(node, 0);
    events.sort((first, second) =>
        first.offset === second.offset
            ? EVENT_PRIORITY[first.kind] - EVENT_PRIORITY[second.kind]
            : first.offset - second.offset,
    );
    return { duration, events };
}

function mergeIntervals(
    intervals: readonly TimelineInterval[],
    minimum: number,
    maximum: number,
): TimelineInterval[] {
    const sorted = intervals
        .map(({ start, end }) => ({ start: Math.max(minimum, start), end: Math.min(maximum, end) }))
        .filter(({ start, end }) => end > start)
        .sort((first, second) => first.start - second.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of sorted) {
        const previous = merged.at(-1);
        if (previous && interval.start <= previous.end + 1) {
            previous.end = Math.max(previous.end, interval.end);
        } else {
            merged.push({ ...interval });
        }
    }
    return merged;
}

async function withTimeout<Result>(
    operation: (context: { signal: AbortSignal }) => Result | Promise<Result>,
    timeout: number,
    parentSignal: AbortSignal,
    label: string,
): Promise<Result> {
    if (!Number.isFinite(timeout) || timeout < 0) {
        throw new TypeError(`${label}: ungültiger Timeout.`);
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([parentSignal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Promise.resolve().then(() => operation({ signal })),
            new Promise<Result>((_, reject) => {
                timer = setTimeout(() => {
                    const error: TimelineRuntimeError = new Error(
                        `${label} nach ${timeout} ms abgebrochen.`,
                    );
                    error.code = 'TIMELINE_TIMEOUT';
                    controller.abort(error);
                    reject(error);
                }, timeout);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function asTimelineError(value: unknown): TimelineRuntimeError {
    return value instanceof Error ? value : new Error(String(value));
}
