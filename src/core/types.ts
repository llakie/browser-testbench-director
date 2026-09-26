export type MaybePromise<T> = T | Promise<T>;

export interface BrowserSession {
    click(selector: string): MaybePromise<unknown>;
    evaluate(script: string, arguments_?: readonly unknown[]): MaybePromise<unknown>;
    navigate(url: string): MaybePromise<unknown>;
    waitForElement(selector: string, timeout?: number): Promise<unknown>;
    waitForNetworkIdle(quiet: number, timeout?: number): Promise<unknown>;
    waitForScript(
        script: string,
        arguments_?: readonly unknown[],
        timeout?: number,
    ): Promise<unknown>;
    waitForUrl(value: string, timeout?: number): Promise<unknown>;
}

export interface Clock {
    now(): number;
    sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface TimelineLogger {
    debug?(message: string, details?: Readonly<Record<string, unknown>>): void;
}

export interface ProductionDefinition {
    readonly id: string;
    readonly triggerTimeout?: number;
    readonly actionTimeout?: number;
}

export interface Production extends ProductionDefinition {
    readonly triggerTimeout: number;
    readonly actionTimeout: number;
}

export interface ProductionRuntimeContext extends Record<string, unknown> {
    readonly overlays?: OverlayRenderer;
}

export interface TimelineContext<ProductionContext = ProductionRuntimeContext> {
    readonly session: BrowserSession;
    readonly signal: AbortSignal;
    readonly triggerResult: unknown;
    readonly productionContext: ProductionContext;
    readonly results: ReadonlyMap<string, TimelineExecutionResult>;
    readonly timelineId: string;
}

export interface TimelineExecutionResult {
    readonly trigger: unknown;
}

export interface WaitContext<ProductionContext = ProductionRuntimeContext> {
    readonly session: BrowserSession;
    readonly signal: AbortSignal;
    readonly timeout: number;
    readonly productionContext: ProductionContext;
    readonly results: ReadonlyMap<string, TimelineExecutionResult>;
}

export interface TimeoutOptions {
    readonly timeout?: number;
}

export interface WaitOptions extends TimeoutOptions {
    readonly name?: string;
    readonly quiet?: number;
}

export interface ActionNode {
    readonly type: 'action';
    readonly name: string;
    readonly handler: (context: TimelineContext) => MaybePromise<unknown>;
    readonly timeout?: number;
}

export interface ClipNode {
    readonly type: 'clip';
    readonly id: string;
    readonly duration?: number;
    readonly start: (context: TimelineContext) => MaybePromise<unknown>;
    readonly end?: (context: TimelineContext) => MaybePromise<unknown>;
    readonly continuous: boolean;
    readonly mediaType?: 'audio';
    readonly audio?: AudioClipConfiguration;
}

export interface TimedNode {
    readonly type: 'delay' | 'hold';
    readonly duration: number;
}

export interface MarkNode {
    readonly type: 'mark';
    readonly name: string;
    readonly data?: unknown;
}

export interface CompositeRunNode {
    readonly type: 'parallel' | 'sequence';
    readonly entries: readonly RunNode[];
}

export type RunNode = ActionNode | ClipNode | TimedNode | MarkNode | CompositeRunNode;

export interface ImmediateWaitNode {
    readonly type: 'wait-immediate';
}

export interface CustomWaitNode {
    readonly type: 'wait-custom';
    readonly name: string;
    readonly handler: (context: WaitContext) => MaybePromise<unknown>;
    readonly timeout?: number;
}

export interface SequentialWaitNode {
    readonly type: 'wait-sequence';
    readonly entries: readonly WaitNode[];
}

export interface CompositeWaitNode {
    readonly type: 'wait-all' | 'wait-any';
    readonly named: boolean;
    readonly entries: readonly WaitNode[] | readonly (readonly [string, WaitNode])[];
}

export type WaitNode = ImmediateWaitNode | CustomWaitNode | SequentialWaitNode | CompositeWaitNode;

export interface TimelineDefinition {
    readonly type: 'timeline';
    readonly id: string;
    readonly layer: string;
    readonly after: readonly string[];
    readonly trigger: WaitNode;
    readonly run: RunNode | ((context: TimelineContext) => RunNode);
}

export interface TimelineConfiguration {
    readonly id: string;
    readonly layer: string;
    readonly after?: readonly string[];
    readonly trigger?: WaitNode;
    readonly run: TimelineDefinition['run'];
}

export interface TimelineGraph {
    readonly type: 'graph';
    readonly timelines: readonly TimelineDefinition[];
}

export interface ClipConfiguration {
    readonly id: string;
    readonly duration?: number;
    readonly start: ClipNode['start'];
    readonly end?: ClipNode['end'];
    readonly continuous?: boolean;
}

export interface AudioClipConfiguration {
    readonly id: string;
    readonly src: string;
    readonly duration: number;
    readonly gainDb?: number;
    readonly fadeIn?: number;
    readonly fadeOut?: number;
    readonly trim?: Readonly<{ from?: number; duration?: number }>;
}

export type OverlayType = 'group' | 'html' | 'image' | 'mask' | 'shape' | 'text';
export type AnchorPoint =
    | 'topLeft'
    | 'top'
    | 'topRight'
    | 'left'
    | 'center'
    | 'right'
    | 'bottomLeft'
    | 'bottom'
    | 'bottomRight';

export interface OverlayAnchor {
    readonly selector?: string;
    readonly overlayId?: string;
    readonly point?: AnchorPoint;
    readonly overlayPoint?: AnchorPoint;
    readonly offset?: Readonly<{ x?: number; y?: number }>;
    readonly mode?: 'follow' | 'snapshot';
    readonly missing?: 'fail' | 'hide';
}

export interface OverlayConfiguration {
    readonly id: string;
    readonly layer?: string;
    readonly duration?: number;
    readonly anchor?: OverlayAnchor;
    readonly x?: number | string;
    readonly y?: number | string;
    readonly zIndex?: number;
    readonly style?: Readonly<Record<string, string | number>>;
    readonly text?: string;
    readonly html?: string;
    readonly src?: string;
    readonly alt?: string;
    readonly color?: string;
    readonly [key: string]: unknown;
}

export interface OverlayRenderer {
    show(configuration: OverlayConfiguration & { readonly type: OverlayType }): Promise<unknown>;
    hide(id: string): Promise<void>;
    clear(): Promise<void>;
}

export interface TimelineInterval {
    readonly start: number;
    readonly end: number;
    readonly timelineId?: string;
}

export type TimelineState = 'pending' | 'armed' | 'running' | 'completed';

export interface TimelineEvent extends Readonly<Record<string, unknown>> {
    readonly sequence: number;
    readonly runtimeMs: number;
    readonly type: string;
    readonly timelineId?: string;
    readonly clipId?: string;
    readonly audio?: AudioClipConfiguration;
}

export interface RenderedAudioClip extends AudioClipConfiguration {
    readonly timelineId: string;
    readonly startMs: number;
}

export interface TimelineResult {
    readonly productionId: string;
    readonly runtimeDurationMs: number;
    readonly mediaDurationMs: number;
    readonly keepIntervals: readonly TimelineInterval[];
    readonly audioClips: readonly RenderedAudioClip[];
    readonly events: readonly TimelineEvent[];
    readonly states: Readonly<Record<string, TimelineState>>;
    readonly results: Readonly<Record<string, TimelineExecutionResult>>;
}
