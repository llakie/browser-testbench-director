const RUNTIME_KEY = '__browserTestbenchTimelineOverlays';

import type { OverlayConfiguration, OverlayRenderer, OverlayType } from '../../core/types.js';

interface EvaluatingSession {
    evaluate(script: string, arguments_?: readonly unknown[]): Promise<unknown> | unknown;
}

interface OverlayResult {
    readonly missing: boolean;
    readonly selector?: string;
}

type LayerDefinitions = Readonly<Record<string, Readonly<{ zIndex?: number }>>>;
type RenderableOverlay = OverlayConfiguration & { readonly type: OverlayType };

export class DomOverlayRenderer implements OverlayRenderer {
    readonly #session: EvaluatingSession;
    readonly #layers: LayerDefinitions;

    constructor(session: EvaluatingSession, { layers = {} }: { layers?: LayerDefinitions } = {}) {
        if (!session?.evaluate)
            throw new TypeError('DomOverlayRenderer benötigt eine Browser-Session.');
        this.#session = session;
        this.#layers = layers;
    }

    async show(configuration: RenderableOverlay): Promise<OverlayResult> {
        validateOverlay(configuration);
        const result = (await this.#session.evaluate(INSTALL_AND_SHOW_SCRIPT, [
            serializableOverlay(configuration, this.#layers),
            RUNTIME_KEY,
        ])) as OverlayResult;
        if (result?.missing && configuration.anchor?.missing !== 'hide') {
            throw new Error(
                `Anchor für Overlay "${configuration.id}" wurde nicht gefunden: ${result.selector}`,
            );
        }
        return result;
    }

    async hide(id: string): Promise<void> {
        await this.#session.evaluate(HIDE_SCRIPT, [id, RUNTIME_KEY]);
    }

    async clear(): Promise<void> {
        await this.#session.evaluate(CLEAR_SCRIPT, [RUNTIME_KEY]);
    }
}

function validateOverlay(configuration: RenderableOverlay): void {
    if (!configuration?.id || typeof configuration.id !== 'string') {
        throw new TypeError('Ein Overlay benötigt eine ID.');
    }
    if (!['group', 'html', 'image', 'mask', 'shape', 'text'].includes(configuration.type)) {
        throw new TypeError(`Unbekannter Overlay-Typ: ${configuration.type}`);
    }
    const anchor = configuration.anchor;
    if (anchor?.selector && anchor?.overlayId) {
        throw new TypeError(
            'Ein Overlay-Anchor darf Selector oder Overlay-ID verwenden, nicht beides.',
        );
    }
    if (anchor?.mode && !['follow', 'snapshot'].includes(anchor.mode)) {
        throw new TypeError(`Ungültiger Anchor-Modus: ${anchor.mode}`);
    }
    if (anchor?.missing && !['fail', 'hide'].includes(anchor.missing)) {
        throw new TypeError(`Ungültige Missing-Strategie: ${anchor.missing}`);
    }
}

function serializableOverlay(
    configuration: RenderableOverlay,
    layers: LayerDefinitions,
): Record<string, unknown> {
    return {
        ...configuration,
        duration: undefined,
        zIndex:
            configuration.zIndex ??
            (configuration.layer ? layers[configuration.layer]?.zIndex : undefined) ??
            0,
        style: configuration.style ?? {},
    };
}

const INSTALL_AND_SHOW_SCRIPT = String.raw`
    const config = arguments[0];
    const runtimeKey = arguments[1];
    let runtime = window[runtimeKey];
    if (!runtime) {
        const host = document.createElement('div');
        host.id = 'video-timeline-overlays';
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;contain:layout style paint;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = ':host{all:initial}.layer{position:absolute;inset:0;pointer-events:none}.overlay{position:absolute;box-sizing:border-box;margin:0}.overlay img{display:block;width:100%;height:100%;object-fit:contain}';
        shadow.append(style);
        document.documentElement.append(host);
        runtime = { host, shadow, overlays: new Map(), frames: new Map() };
        window[runtimeKey] = runtime;
    }

    const previous = runtime.overlays.get(config.id);
    if (previous) {
        cancelAnimationFrame(runtime.frames.get(config.id));
        previous.remove();
    }

    let layer = runtime.shadow.querySelector('[data-layer="' + CSS.escape(config.layer || 'default') + '"]');
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'layer';
        layer.dataset.layer = config.layer || 'default';
        runtime.shadow.append(layer);
    }
    layer.style.zIndex = String(config.zIndex || 0);

    const element = document.createElement(config.type === 'image' ? 'img' : 'div');
    element.className = 'overlay overlay--' + config.type;
    element.dataset.overlayId = config.id;
    element.style.left = '0';
    element.style.top = '0';
    if (config.type === 'text') element.textContent = config.text || '';
    else if (config.type === 'html' || config.type === 'group') element.innerHTML = config.html || '';
    else if (config.type === 'image') {
        element.src = config.src;
        element.alt = config.alt || '';
    }
    if (config.type === 'mask') {
        element.style.background = config.color || 'rgba(0, 0, 0, 0.78)';
    }
    for (const [property, value] of Object.entries(config.style || {})) {
        element.style.setProperty(property, String(value));
    }
    layer.append(element);
    runtime.overlays.set(config.id, element);

    const points = {
        topLeft: [0, 0], top: [0.5, 0], topRight: [1, 0],
        left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
        bottomLeft: [0, 1], bottom: [0.5, 1], bottomRight: [1, 1],
    };
    const anchor = config.anchor;
    if (!anchor) {
        if (config.x !== undefined) element.style.left = typeof config.x === 'number' ? config.x + 'px' : config.x;
        if (config.y !== undefined) element.style.top = typeof config.y === 'number' ? config.y + 'px' : config.y;
        return { missing: false };
    }

    let found = false;
    const position = () => {
        const target = anchor.selector
            ? document.querySelector(anchor.selector)
            : runtime.overlays.get(anchor.overlayId);
        if (!target) {
            if (!found && (anchor.missing || 'fail') === 'hide') element.style.visibility = 'hidden';
            return false;
        }
        const targetBounds = target.getBoundingClientRect();
        const ownBounds = element.getBoundingClientRect();
        const targetPoint = points[anchor.point || 'center'];
        const ownPoint = points[anchor.overlayPoint || 'center'];
        const offset = anchor.offset || {};
        element.style.left = targetBounds.left + targetBounds.width * targetPoint[0] - ownBounds.width * ownPoint[0] + (offset.x || 0) + 'px';
        element.style.top = targetBounds.top + targetBounds.height * targetPoint[1] - ownBounds.height * ownPoint[1] + (offset.y || 0) + 'px';
        element.style.visibility = '';
        found = true;
        return true;
    };
    const initiallyFound = position();
    if ((anchor.mode || 'follow') === 'follow') {
        const follow = () => {
            if (!runtime.overlays.has(config.id)) return;
            position();
            runtime.frames.set(config.id, requestAnimationFrame(follow));
        };
        runtime.frames.set(config.id, requestAnimationFrame(follow));
    }
    return {
        missing: !initiallyFound,
        selector: anchor.selector || ('overlay:' + anchor.overlayId),
    };
`;

const HIDE_SCRIPT = String.raw`
    const runtime = window[arguments[1]];
    if (!runtime) return;
    cancelAnimationFrame(runtime.frames.get(arguments[0]));
    runtime.frames.delete(arguments[0]);
    runtime.overlays.get(arguments[0])?.remove();
    runtime.overlays.delete(arguments[0]);
`;

const CLEAR_SCRIPT = String.raw`
    const runtime = window[arguments[0]];
    if (!runtime) return;
    for (const frame of runtime.frames.values()) cancelAnimationFrame(frame);
    runtime.host.remove();
    delete window[arguments[0]];
`;
