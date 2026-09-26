import type {
    ActionNode,
    AudioClipConfiguration,
    ClipConfiguration,
    ClipNode,
    CompositeRunNode,
    CompositeWaitNode,
    CustomWaitNode,
    ImmediateWaitNode,
    MarkNode,
    OverlayConfiguration,
    OverlayType,
    Production,
    ProductionDefinition,
    RunNode,
    SequentialWaitNode,
    TimedNode,
    TimelineConfiguration,
    TimelineContext,
    TimelineDefinition,
    TimelineGraph,
    TimeoutOptions,
    WaitContext,
    WaitNode,
    WaitOptions,
} from './types.js';

const RUN_NODE_TYPES = new Set<RunNode['type']>([
    'action',
    'clip',
    'delay',
    'hold',
    'mark',
    'parallel',
    'sequence',
]);
const WAIT_NODE_TYPES = new Set<WaitNode['type']>([
    'wait-all',
    'wait-any',
    'wait-custom',
    'wait-immediate',
    'wait-sequence',
]);

export function defineProduction(definition: ProductionDefinition): Readonly<Production> {
    if (!definition || typeof definition !== 'object') {
        throw new TypeError('Eine Production-Definition wird benötigt.');
    }
    if (!definition.id || typeof definition.id !== 'string') {
        throw new TypeError('Eine Production benötigt eine ID.');
    }
    return Object.freeze({ triggerTimeout: 90_000, actionTimeout: 30_000, ...definition });
}

export function graph(
    ...entries: readonly (TimelineDefinition | readonly TimelineDefinition[])[]
): Readonly<TimelineGraph> {
    return Object.freeze({ type: 'graph', timelines: entries.flat() });
}

export function timeline(configuration: TimelineConfiguration): Readonly<TimelineDefinition> {
    const { id, layer, after = [], trigger = wait.immediate(), run } = configuration;
    if (!id || typeof id !== 'string') throw new TypeError('Eine Timeline benötigt eine ID.');
    if (!layer || typeof layer !== 'string') {
        throw new TypeError(`Timeline "${id}" benötigt einen Layer.`);
    }
    if (!Array.isArray(after) || after.some((entry) => typeof entry !== 'string')) {
        throw new TypeError(`Timeline "${id}" benötigt eine Liste von Vorgänger-IDs.`);
    }
    if (!isWaitNode(trigger)) {
        throw new TypeError(`Timeline "${id}" besitzt keinen gültigen Trigger.`);
    }
    if (typeof run !== 'function' && !isRunNode(run)) {
        throw new TypeError(`Timeline "${id}" besitzt keinen gültigen Ablauf.`);
    }
    return Object.freeze({ type: 'timeline', id, layer, after: [...after], trigger, run });
}

export function sequence(
    ...entries: readonly (RunNode | readonly RunNode[])[]
): Readonly<CompositeRunNode> {
    return composite('sequence', entries);
}

export function parallel(
    ...entries: readonly (RunNode | readonly RunNode[])[]
): Readonly<CompositeRunNode> {
    return composite('parallel', entries);
}

export function repeat<Value>(
    values: readonly Value[],
    builder: (value: Value, index: number) => RunNode,
): Readonly<CompositeRunNode> {
    if (!Array.isArray(values)) throw new TypeError('repeat() benötigt eine endliche Werteliste.');
    if (typeof builder !== 'function') throw new TypeError('repeat() benötigt einen Builder.');
    return sequence(values.map((value, index) => builder(value, index)));
}

export function delay(duration: number): Readonly<TimedNode> {
    return timedNode('delay', duration);
}

export function hold(duration: number): Readonly<TimedNode> {
    return timedNode('hold', duration);
}

export function seconds(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new TypeError('Sekunden müssen endlich und positiv sein.');
    }
    return Math.round(value * 1_000);
}

export function mark(name: string, data?: unknown): Readonly<MarkNode> {
    if (!name || typeof name !== 'string') {
        throw new TypeError('Eine Markierung benötigt einen Namen.');
    }
    return Object.freeze({ type: 'mark', name, data });
}

type ActionHandler = ActionNode['handler'];
type WaitHandler = CustomWaitNode['handler'];

function action(
    name: string,
    handler: ActionHandler,
    options?: TimeoutOptions,
): Readonly<ActionNode>;
function action(handler: ActionHandler, options?: TimeoutOptions): Readonly<ActionNode>;
function action(
    nameOrHandler: string | ActionHandler,
    handlerOrOptions?: ActionHandler | TimeoutOptions,
    maybeOptions: TimeoutOptions = {},
): Readonly<ActionNode> {
    const handler =
        typeof nameOrHandler === 'function' ? nameOrHandler : (handlerOrOptions as ActionHandler);
    const name =
        typeof nameOrHandler === 'function' ? nameOrHandler.name || 'anonymous' : nameOrHandler;
    const options =
        typeof nameOrHandler === 'function'
            ? ((handlerOrOptions as TimeoutOptions | undefined) ?? {})
            : maybeOptions;
    if (!name || typeof name !== 'string') throw new TypeError('Eine Action benötigt einen Namen.');
    if (typeof handler !== 'function') {
        throw new TypeError(`Action "${name}" benötigt einen Handler.`);
    }
    assertOptionalTimeout(options.timeout, `Action "${name}"`);
    return Object.freeze({ type: 'action', name, handler, timeout: options.timeout });
}

export const call = Object.freeze({ action });

export const clip = Object.freeze({
    custom(configuration: ClipConfiguration): Readonly<ClipNode> {
        const { id, duration, start, end, continuous = false } = configuration;
        if (!id || typeof id !== 'string') throw new TypeError('Ein Clip benötigt eine ID.');
        if (duration !== undefined) assertDuration(duration, `Clip "${id}"`);
        if (typeof start !== 'function') throw new TypeError(`Clip "${id}" benötigt start().`);
        if (end !== undefined && typeof end !== 'function') {
            throw new TypeError(`Clip "${id}" besitzt kein gültiges end().`);
        }
        return Object.freeze({ type: 'clip', id, duration, start, end, continuous });
    },
});

function overlayClip(type: OverlayType, configuration: OverlayConfiguration): Readonly<ClipNode> {
    if (!configuration?.id || typeof configuration.id !== 'string') {
        throw new TypeError(`Ein ${type}-Overlay benötigt eine ID.`);
    }
    return clip.custom({
        id: configuration.id,
        duration: configuration.duration,
        start: ({ productionContext, timelineId, ...context }) => {
            if (!productionContext.overlays) {
                throw new Error(`Overlay "${configuration.id}" benötigt einen DOM-Renderer.`);
            }
            const resolved = resolveOverlayConfiguration(configuration, {
                ...context,
                productionContext,
                timelineId,
            } as TimelineContext);
            return productionContext.overlays.show({ ...resolved, type });
        },
        end: ({ productionContext }) => productionContext.overlays?.hide(configuration.id),
    });
}

export const overlay = Object.freeze({
    text: (configuration: OverlayConfiguration) => overlayClip('text', configuration),
    image: (configuration: OverlayConfiguration) => overlayClip('image', configuration),
    html: (configuration: OverlayConfiguration) => overlayClip('html', configuration),
    shape: (configuration: OverlayConfiguration) => overlayClip('shape', configuration),
    mask: (configuration: OverlayConfiguration) => overlayClip('mask', configuration),
    group: (configuration: OverlayConfiguration) => overlayClip('group', configuration),
});

export const audio = Object.freeze({
    clip(configuration: AudioClipConfiguration): Readonly<ClipNode> {
        if (!configuration?.id || typeof configuration.id !== 'string') {
            throw new TypeError('Ein Audio-Clip benötigt eine ID.');
        }
        if (!configuration.src || typeof configuration.src !== 'string') {
            throw new TypeError(`Audio-Clip "${configuration.id}" benötigt eine Quelle.`);
        }
        assertDuration(configuration.duration, `Audio-Clip "${configuration.id}"`);
        return Object.freeze({
            type: 'clip',
            id: configuration.id,
            duration: Math.round(configuration.duration),
            mediaType: 'audio',
            audio: Object.freeze({ ...configuration }),
            continuous: false,
            start() {},
        });
    },
});

export const browser = Object.freeze({
    click(selector: string, options?: TimeoutOptions): Readonly<ActionNode> {
        return call.action(
            `browser.click:${selector}`,
            ({ session }) => session.click(selector),
            options,
        );
    },
    evaluate(
        name: string,
        script: string,
        arguments_: readonly unknown[] = [],
        options?: TimeoutOptions,
    ): Readonly<ActionNode> {
        return call.action(name, ({ session }) => session.evaluate(script, arguments_), options);
    },
    navigate(url: string, options?: TimeoutOptions): Readonly<ActionNode> {
        return call.action(
            `browser.navigate:${url}`,
            ({ session }) => session.navigate(url),
            options,
        );
    },
});

function customWait(
    name: string,
    handler: WaitHandler,
    options?: TimeoutOptions,
): Readonly<CustomWaitNode>;
function customWait(handler: WaitHandler, options?: TimeoutOptions): Readonly<CustomWaitNode>;
function customWait(
    nameOrHandler: string | WaitHandler,
    handlerOrOptions?: WaitHandler | TimeoutOptions,
    maybeOptions: TimeoutOptions = {},
): Readonly<CustomWaitNode> {
    const handler =
        typeof nameOrHandler === 'function' ? nameOrHandler : (handlerOrOptions as WaitHandler);
    const name =
        typeof nameOrHandler === 'function' ? nameOrHandler.name || 'custom' : nameOrHandler;
    const options =
        typeof nameOrHandler === 'function'
            ? ((handlerOrOptions as TimeoutOptions | undefined) ?? {})
            : maybeOptions;
    if (!name || typeof name !== 'string') throw new TypeError('Ein Wait benötigt einen Namen.');
    if (typeof handler !== 'function')
        throw new TypeError(`Wait "${name}" benötigt einen Handler.`);
    assertOptionalTimeout(options.timeout, `Wait "${name}"`);
    return Object.freeze({ type: 'wait-custom', name, handler, timeout: options.timeout });
}

export const wait = Object.freeze({
    immediate(): Readonly<ImmediateWaitNode> {
        return Object.freeze({ type: 'wait-immediate' });
    },
    custom: customWait,
    element(selector: string, options: WaitOptions = {}): Readonly<CustomWaitNode> {
        return browserWait(`element:${selector}`, options, ({ session, timeout }) =>
            session.waitForElement(selector, timeout),
        );
    },
    url(value: string, options: WaitOptions = {}): Readonly<CustomWaitNode> {
        return browserWait(`url:${value}`, options, ({ session, timeout }) =>
            session.waitForUrl(value, timeout),
        );
    },
    networkIdle(options: WaitOptions = {}): Readonly<CustomWaitNode> {
        const quiet = options.quiet ?? 500;
        return browserWait('network-idle', options, ({ session, timeout }) =>
            session.waitForNetworkIdle(quiet, timeout),
        );
    },
    script(
        script: string,
        arguments_: readonly unknown[] = [],
        options: WaitOptions = {},
    ): Readonly<CustomWaitNode> {
        return browserWait(options.name ?? 'script', options, ({ session, timeout }) =>
            session.waitForScript(script, arguments_, timeout),
        );
    },
    all(
        entries: WaitNode | readonly WaitNode[] | Readonly<Record<string, WaitNode>>,
        ...rest: readonly WaitNode[]
    ): Readonly<CompositeWaitNode> {
        return waitComposite('wait-all', entries, rest);
    },
    any(
        entries: WaitNode | readonly WaitNode[] | Readonly<Record<string, WaitNode>>,
        ...rest: readonly WaitNode[]
    ): Readonly<CompositeWaitNode> {
        return waitComposite('wait-any', entries, rest);
    },
    sequence(
        ...entries: readonly (WaitNode | readonly WaitNode[])[]
    ): Readonly<SequentialWaitNode> {
        const nodes = entries.flat();
        if (nodes.some((node) => !isWaitNode(node))) {
            throw new TypeError('wait.sequence() akzeptiert nur Waits.');
        }
        return Object.freeze({ type: 'wait-sequence', entries: nodes });
    },
});

export function isRunNode(node: unknown): node is RunNode {
    return Boolean(
        node &&
        typeof node === 'object' &&
        'type' in node &&
        RUN_NODE_TYPES.has((node as RunNode).type),
    );
}

export function isWaitNode(node: unknown): node is WaitNode {
    return Boolean(
        node &&
        typeof node === 'object' &&
        'type' in node &&
        WAIT_NODE_TYPES.has((node as WaitNode).type),
    );
}

function composite(
    type: CompositeRunNode['type'],
    entries: readonly (RunNode | readonly RunNode[])[],
): Readonly<CompositeRunNode> {
    const nodes = entries.flat();
    if (nodes.some((node) => !isRunNode(node))) {
        throw new TypeError(`${type}() akzeptiert nur Ablaufknoten.`);
    }
    return Object.freeze({ type, entries: nodes });
}

function timedNode(type: TimedNode['type'], duration: number): Readonly<TimedNode> {
    assertDuration(duration, type);
    return Object.freeze({ type, duration: Math.round(duration) });
}

function browserWait(
    name: string,
    options: TimeoutOptions,
    handler: (context: WaitContext) => unknown,
): Readonly<CustomWaitNode> {
    return wait.custom(name, handler, options);
}

function resolveOverlayConfiguration(
    configuration: OverlayConfiguration,
    context: TimelineContext,
): OverlayConfiguration {
    return Object.fromEntries(
        Object.entries(configuration).map(([key, value]) => [
            key,
            typeof value === 'function'
                ? (value as (context: TimelineContext) => unknown)(context)
                : value,
        ]),
    ) as OverlayConfiguration;
}

function waitComposite(
    type: CompositeWaitNode['type'],
    first: WaitNode | readonly WaitNode[] | Readonly<Record<string, WaitNode>>,
    rest: readonly WaitNode[],
): Readonly<CompositeWaitNode> {
    if (first && !Array.isArray(first) && !isWaitNode(first) && typeof first === 'object') {
        const entries = Object.entries(first) as [string, WaitNode][];
        if (entries.some(([, node]) => !isWaitNode(node))) {
            throw new TypeError(`${type}() akzeptiert nur Waits.`);
        }
        return Object.freeze({ type, named: true, entries });
    }
    const entries = [first, ...rest].flat().filter(Boolean) as WaitNode[];
    if (entries.some((node) => !isWaitNode(node))) {
        throw new TypeError(`${type}() akzeptiert nur Waits.`);
    }
    return Object.freeze({ type, named: false, entries });
}

function assertDuration(value: number, owner: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(`${owner} benötigt eine endliche, nicht negative Dauer.`);
    }
}

function assertOptionalTimeout(value: number | undefined, owner: string): void {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        throw new TypeError(`${owner} benötigt einen endlichen, positiven Timeout.`);
    }
}
