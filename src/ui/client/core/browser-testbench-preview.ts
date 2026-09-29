import { DirectorRuntimeScript, type RuntimeStep } from './runtime-protocol.js';
import type { BrowserSessionConfiguration, ProjectFileInput } from './project-format.js';

interface MessageDescriptor {
    readonly parameters?: Readonly<Record<string, string | number>>;
}

export interface BrowserTestbenchTarget {
    readonly id: string;
    readonly label: string | MessageDescriptor;
    readonly kind: 'desktop' | 'mobile';
    readonly browser?: string;
    readonly deviceKind?: 'emulator' | 'simulator' | 'physical';
    readonly ready: boolean;
    readonly serial: boolean;
    readonly busy?: boolean;
    readonly capabilities: BrowserTestbenchTargetCapabilities;
}

export interface BrowserTestbenchTargetCapabilities {
    readonly permissions: { readonly native: string[]; readonly origin: string[] };
    readonly localOrigins: { readonly reverse: boolean };
    readonly mediaInjection: { readonly cameraImage: boolean };
    readonly recording: { readonly viewport: boolean };
}

interface BrowserTestbenchCapabilities {
    readonly testTargets: Array<{
        readonly id: string;
        readonly capabilities: BrowserTestbenchTargetCapabilities;
    }>;
}

export interface BrowserTestbenchStatus {
    readonly running: boolean;
    readonly managed: boolean;
}

interface BrowserTestbenchError {
    readonly error?: string;
    readonly message?: unknown;
}

interface PublishedPreview {
    readonly url: string;
}

interface ProxiedWebsite {
    readonly url: string;
}

interface StartedSession {
    readonly id: string;
}

interface RecordingArtifact {
    readonly artifactId: string;
    readonly size: number;
    readonly sha256: string;
    readonly mimeType: 'video/mp4';
    readonly width: number;
    readonly height: number;
    readonly durationMs: number;
    readonly startedSessionTimeMs?: number;
    readonly endedSessionTimeMs: number;
    readonly marks: readonly RecordingMark[];
}

interface RecordingMark {
    readonly name: string;
    readonly data?: Readonly<Record<string, unknown>>;
    readonly recordingTimeMs?: number;
}

export interface RecordingInterval {
    readonly startMs: number;
    readonly endMs: number;
}

export interface RecordingExport {
    readonly blob: Blob;
    readonly filename: string;
    readonly width: number;
    readonly height: number;
    readonly durationMs: number;
}

interface ExportViewport {
    readonly width: number;
    readonly height: number;
}

interface UploadedAsset {
    readonly id: string;
    readonly name: string;
    readonly contentType: string;
    readonly size: number;
    readonly sha256: string;
}

export class BrowserTestbenchPreview {
    private static readonly apiBase = '/browser-testbench-api';
    private static readonly lifecycleUrl = '/director-api/browser-testbench';
    private static readonly inputChunkSize = 256 * 1024;
    private static readonly sessionLeaseTimeoutMs = 15 * 60 * 1_000;

    static async targets(): Promise<BrowserTestbenchTarget[]> {
        const [targets, capabilities] = await Promise.all([
            this.request<Array<Omit<BrowserTestbenchTarget, 'capabilities'>>>('/targets'),
            this.request<BrowserTestbenchCapabilities>('/capabilities'),
        ]);
        const capabilitiesByTarget = new Map(
            capabilities.testTargets.map((target) => [target.id, target.capabilities]),
        );
        return targets.flatMap((target) => {
            const targetCapabilities = capabilitiesByTarget.get(target.id);
            return targetCapabilities ? [{ ...target, capabilities: targetCapabilities }] : [];
        });
    }

    static status(): Promise<BrowserTestbenchStatus> {
        return this.lifecycleRequest();
    }

    static proxyWebsite(url: string): Promise<string> {
        if (!url.trim()) throw new TypeError('Website URL must not be empty.');
        return this.fetch<ProxiedWebsite>('/director-api/website-proxies', {
            method: 'POST',
            body: JSON.stringify({ url: this.absoluteUrl(url) }),
        }).then((website) => website.url);
    }

    static start(): Promise<BrowserTestbenchStatus> {
        return this.lifecycleRequest({ method: 'POST' });
    }

    static stop(): Promise<BrowserTestbenchStatus> {
        return this.lifecycleRequest({ method: 'DELETE' });
    }

    static async open(
        target: string,
        nodeId: string,
        document: string,
        inputFiles: Readonly<Record<string, File>> = {},
        inputs: readonly ProjectFileInput[] = [],
        headless = false,
    ): Promise<string> {
        const preview = await this.publish(nodeId, document);
        const previewUrl = new URL(preview.url, globalThis.location.origin);
        const session = await this.request<StartedSession>('/sessions', {
            method: 'POST',
            body: JSON.stringify({
                target,
                url: previewUrl.toString(),
                headless,
                leaseTimeoutMs: this.sessionLeaseTimeoutMs,
                ...(this.isLocalHttps(previewUrl.toString())
                    ? { capabilities: { acceptInsecureCerts: true } }
                    : {}),
            }),
        });
        await this.waitForDirectorRuntime(session.id);
        return session.id;
    }

    static async openWebsite(
        target: BrowserTestbenchTarget,
        url: string,
        configuration?: BrowserSessionConfiguration,
        inputFiles: Readonly<Record<string, File>> = {},
        inputs: readonly ProjectFileInput[] = [],
        cameraInputId: string | null = null,
        headless = false,
    ): Promise<string> {
        const absoluteUrl = this.absoluteUrl(url);
        const cameraInput = inputs.find((input) => input.id === cameraInputId);
        const cameraFile = cameraInput ? inputFiles[cameraInput.id] : undefined;
        if (cameraInput && !cameraFile) {
            throw new Error(`Missing project input: ${cameraInput.id}`);
        }
        const runtimeInputs = await this.prepareRuntimeInputs(inputFiles, inputs, cameraInput?.id);
        const preparedCameraFile = cameraFile
            ? await this.prepareInput(cameraFile, cameraInput?.prepare)
            : undefined;
        const nativeCamera = Boolean(
            preparedCameraFile && target.capabilities.mediaInjection.cameraImage,
        );
        if (preparedCameraFile && !nativeCamera) {
            throw new Error('Desktop camera previews must use the Director preview shell.');
        }
        const cameraAsset = nativeCamera ? await this.uploadAsset(preparedCameraFile!) : undefined;
        const configuredPermissions = [
            ...(configuration?.permissions ?? []),
            ...(nativeCamera ? (['camera'] as const) : []),
        ];
        const permissions = [...new Set(configuredPermissions)]
            .filter((name) => name !== 'camera' || nativeCamera)
            .map((name) => ({ name, origin: new URL(absoluteUrl).origin }));
        const localHttps = this.isLocalHttps(absoluteUrl);
        const androidLocalHttps = localHttps && target.browser === 'chrome-android';
        const androidLocalOrigin =
            target.browser === 'chrome-android' &&
            this.isLocalOrigin(absoluteUrl) &&
            Boolean(configuration?.localOrigins && target.capabilities.localOrigins.reverse);
        const session = await this.request<StartedSession>('/sessions', {
            method: 'POST',
            body: JSON.stringify({
                target: target.id,
                url: absoluteUrl,
                headless,
                leaseTimeoutMs: this.sessionLeaseTimeoutMs,
                ...(configuration?.localOrigins && target.capabilities.localOrigins.reverse
                    ? { localOrigins: configuration.localOrigins }
                    : {}),
                ...(permissions?.length ? { permissions } : {}),
                ...(cameraAsset
                    ? { media: { camera: { facing: 'back', source: cameraAsset } } }
                    : {}),
                ...(nativeCamera
                    ? {
                          require: {
                              localOrigins: { reverse: true },
                              permissions: { native: ['camera'], origin: ['camera'] },
                              mediaInjection: { cameraImage: true },
                          },
                      }
                    : {}),
                ...(configuration?.language || configuration?.locale || localHttps
                    ? {
                          capabilities: {
                              ...(localHttps ? { acceptInsecureCerts: true } : {}),
                              ...(androidLocalHttps
                                  ? {
                                        'goog:chromeOptions': {
                                            args: [
                                                '--allow-insecure-localhost',
                                                '--disable-features=Translate,TranslateUI',
                                            ],
                                        },
                                    }
                                  : {}),
                              ...(target.kind === 'mobile' && configuration?.language
                                  ? { 'appium:language': configuration.language }
                                  : {}),
                              ...(target.kind === 'mobile' && configuration?.locale
                                  ? { 'appium:locale': configuration.locale }
                                  : {}),
                          },
                      }
                    : {}),
            }),
        });
        if (androidLocalOrigin) {
            await this.navigateWebsite(session.id, absoluteUrl);
        }
        if (Object.keys(runtimeInputs).length > 0) {
            await this.setRuntimeInputs(session.id, runtimeInputs);
        }
        return session.id;
    }

    static async navigate(sessionId: string, nodeId: string, document: string): Promise<void> {
        const preview = await this.publish(nodeId, document);
        await this.request(`/sessions/${encodeURIComponent(sessionId)}/navigate`, {
            method: 'POST',
            body: JSON.stringify({
                url: new URL(preview.url, globalThis.location.origin).toString(),
            }),
        });
        await this.waitForDirectorRuntime(sessionId);
    }

    static async navigateWebsite(sessionId: string, url: string): Promise<void> {
        await this.request(`/sessions/${encodeURIComponent(sessionId)}/navigate`, {
            method: 'POST',
            body: JSON.stringify({ url: this.absoluteUrl(url) }),
        });
    }

    static startRecording(sessionId: string, filename: string): Promise<unknown> {
        return this.request(`/sessions/${encodeURIComponent(sessionId)}/recording/start`, {
            method: 'POST',
            body: JSON.stringify({ outputPath: filename, scope: 'viewport' }),
        });
    }

    static async setViewport(
        sessionId: string,
        viewport: Readonly<{ width: number; height: number }>,
    ): Promise<void> {
        await this.browserAction(sessionId, {
            action: 'viewport',
            width: viewport.width,
            height: viewport.height,
        });
        const rect = await this.browserAction<{
            innerWidth: number;
            innerHeight: number;
            outerWidth: number;
            outerHeight: number;
        }>(sessionId, {
            action: 'evaluate',
            script: `return {
                innerWidth, innerHeight, outerWidth, outerHeight,
            };`,
            arguments: [],
        });
        const scale = Math.max(1, rect.innerWidth / viewport.width);
        const innerWidth = Math.round(viewport.width * scale);
        const innerHeight = Math.round(viewport.height * scale);
        if (rect.innerWidth === innerWidth && rect.innerHeight === innerHeight) return;
        await this.browserAction(sessionId, {
            action: 'viewport',
            width: innerWidth + Math.max(0, rect.outerWidth - rect.innerWidth),
            height: innerHeight + Math.max(0, rect.outerHeight - rect.innerHeight),
        });
    }

    static async stopRecording(
        sessionId: string,
        filename: string,
        viewport?: ExportViewport,
    ): Promise<RecordingExport> {
        const recording = await this.request<RecordingArtifact>(
            `/sessions/${encodeURIComponent(sessionId)}/recording/stop`,
            { method: 'POST', body: '{}' },
        );
        const response = await fetch(
            `${this.apiBase}/sessions/${encodeURIComponent(sessionId)}/recording/artifacts/${encodeURIComponent(recording.artifactId)}`,
        );
        if (!response.ok) throw await this.responseError(response);
        const content = await response.arrayBuffer();
        if (content.byteLength !== recording.size) {
            throw new Error('Recording artifact size does not match its metadata.');
        }
        const digest = await crypto.subtle.digest('SHA-256', content);
        const sha256 = [...new Uint8Array(digest)]
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('');
        if (sha256 !== recording.sha256) {
            throw new Error('Recording artifact integrity verification failed.');
        }
        const original = new Blob([content], { type: recording.mimeType });
        const intervals = this.layerIntervals(recording);
        const blob = viewport
            ? await this.normalizeRecording(original, filename, viewport, intervals)
            : original;
        return {
            blob,
            filename,
            width: viewport?.width ?? recording.width,
            height: viewport?.height ?? recording.height,
            durationMs: intervals.length
                ? intervals.reduce(
                      (total, interval) => total + interval.endMs - interval.startMs,
                      0,
                  )
                : recording.durationMs,
        };
    }

    static downloadRecording(recording: RecordingExport): void {
        const url = URL.createObjectURL(recording.blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = recording.filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    private static async normalizeRecording(
        recording: Blob,
        filename: string,
        viewport: ExportViewport,
        intervals: readonly RecordingInterval[],
    ): Promise<Blob> {
        const response = await fetch('/director-api/video-exports', {
            method: 'POST',
            body: recording,
            headers: {
                'Content-Type': 'video/mp4',
                'x-director-video-name': encodeURIComponent(filename),
                'x-director-video-width': String(viewport.width),
                'x-director-video-height': String(viewport.height),
                ...(intervals.length
                    ? { 'x-director-video-intervals': JSON.stringify(intervals) }
                    : {}),
            },
        });
        if (!response.ok) throw await this.responseError(response);
        return response.blob();
    }

    static async execute(
        sessionId: string,
        steps: readonly RuntimeStep[],
        markIntervals = false,
    ): Promise<void> {
        for (const step of steps) {
            if (markIntervals && step.type === 'layer') {
                const playback = step.playback!;
                await this.executeRuntimeStep(sessionId, {
                    ...step,
                    playback: { durationMs: 0, removeAfter: false },
                });
                await this.mark(sessionId, 'director.layer.start', { nodeId: step.id });
                try {
                    if (step.speed === 'live' && playback.durationMs > 0) {
                        await new Promise((resolve) => setTimeout(resolve, playback.durationMs));
                    }
                } finally {
                    await this.mark(sessionId, 'director.layer.end', { nodeId: step.id });
                    if (playback.removeAfter) await this.removeRuntimeLayer(sessionId, step.id);
                }
                continue;
            }
            const includeInterval =
                markIntervals &&
                step.type === 'browser-wait' &&
                !step.omitFromRecording;
            if (includeInterval) {
                await this.mark(sessionId, 'director.wait.start', {
                    nodeId: step.id,
                });
            }
            try {
                await this.executeRuntimeStep(sessionId, step);
            } finally {
                if (includeInterval) {
                    await this.mark(
                        sessionId,
                        'director.wait.end',
                        { nodeId: step.id },
                    );
                }
            }
        }
    }

    static async executeOnWebsite(
        sessionId: string,
        steps: readonly RuntimeStep[],
        markLayerIntervals = false,
        inputs: Readonly<Record<string, string>> = {},
        excludedInputId: string | null = null,
    ): Promise<void> {
        for (const step of steps) {
            if (step.source.includes('director.inputs')) {
                await this.setRuntimeInputs(sessionId, inputs, excludedInputId);
            }
            if (step.type === 'browser-action') {
                await this.clearResult(sessionId, step.id);
                await this.click(sessionId, step.selector!);
                continue;
            }
            if (step.type === 'browser-wait') {
                await this.clearResult(sessionId, step.id);
                const includeWait = markLayerIntervals && !step.omitFromRecording;
                if (includeWait)
                    await this.mark(sessionId, 'director.wait.start', { nodeId: step.id });
                try {
                    const result = await this.wait(sessionId, step);
                    if (result !== undefined) await this.storeResult(sessionId, step.id, result);
                } finally {
                    if (includeWait)
                        await this.mark(sessionId, 'director.wait.end', { nodeId: step.id });
                }
                continue;
            }
            if (step.type === 'layer') {
                await this.mountLayerOnWebsite(sessionId, step);
                await this.executeSourceOnWebsite(sessionId, step, {
                    durationMs: 0,
                    removeAfter: false,
                });
                if (markLayerIntervals)
                    await this.mark(sessionId, 'director.layer.start', { nodeId: step.id });
                try {
                    if (step.speed === 'live' && step.playback!.durationMs > 0) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, step.playback!.durationMs),
                        );
                    }
                } finally {
                    if (markLayerIntervals)
                        await this.mark(sessionId, 'director.layer.end', { nodeId: step.id });
                    if (step.playback!.removeAfter) await this.removeLayer(sessionId, step.id);
                }
                continue;
            }
            await this.executeSourceOnWebsite(sessionId, step);
        }
    }

    static layerIntervals(recording: RecordingArtifact): RecordingInterval[] {
        const starts = new Map<string, number>();
        const intervals: RecordingInterval[] = [];

        for (const mark of recording.marks ?? []) {
            const nodeId = typeof mark.data?.['nodeId'] === 'string' ? mark.data['nodeId'] : null;
            if (!nodeId || !Number.isFinite(mark.recordingTimeMs)) continue;
            const timeMs = Math.max(0, Math.min(recording.durationMs, mark.recordingTimeMs!));
            if (mark.name === 'director.layer.start' || mark.name === 'director.wait.start') {
                starts.set(nodeId, timeMs);
            } else if (mark.name === 'director.layer.end' || mark.name === 'director.wait.end') {
                const startMs = starts.get(nodeId);
                starts.delete(nodeId);
                if (startMs !== undefined && timeMs > startMs) {
                    intervals.push({ startMs, endMs: timeMs });
                }
            }
        }
        return intervals.sort((left, right) => left.startMs - right.startMs);
    }

    private static async mountLayerOnWebsite(sessionId: string, step: RuntimeStep): Promise<void> {
        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: `
                const step = arguments[0];
                const anchoring = window.__directorAnchoring ??= (() => {
                    const rects = new Map();
                    const valid = rect => rect && rect.width > 0 && rect.height > 0;
                    const remember = (key, rect) => {
                        if (!valid(rect)) return null;
                        const value = {
                            left: rect.left, top: rect.top,
                            width: rect.width, height: rect.height,
                        };
                        rects.set(key, value);
                        return value;
                    };
                    const rememberLayer = nodeId => {
                        const content = document.querySelector(
                            '[data-director-node="' + CSS.escape(nodeId) + '"] ' +
                            '.director-layer__content'
                        );
                        return content
                            ? remember('layer:' + nodeId, content.getBoundingClientRect())
                            : null;
                    };
                    const referenceRect = reference => {
                        if (reference.type === 'viewport') {
                            return {
                                left: 0, top: 0,
                                width: window.innerWidth, height: window.innerHeight,
                            };
                        }
                        if (reference.type === 'layer') {
                            const rect = rememberLayer(reference.nodeId) ||
                                rects.get('layer:' + reference.nodeId);
                            if (rect) return rect;
                            throw new Error(
                                'Parent layer has no measurable content: ' + reference.nodeId
                            );
                        }
                        const key = 'dom:' + reference.selector;
                        const element = document.querySelector(reference.selector);
                        const rect = (element && remember(key, element.getBoundingClientRect())) ||
                            rects.get(key);
                        if (rect) return rect;
                        throw new Error(
                            'DOM anchor not found or not measurable: ' + reference.selector
                        );
                    };
                    const place = (placement, anchor) => {
                        const rect = referenceRect(placement.reference);
                        Object.assign(anchor.style, {
                            left: rect.left + 'px', top: rect.top + 'px',
                            width: rect.width + 'px', height: rect.height + 'px',
                        });
                    };
                    return { place, rememberLayer };
                })();
                anchoring.rememberLayer(step.id);
                document
                    .querySelectorAll('[data-director-node="' + CSS.escape(step.id) + '"]')
                    .forEach((element) => element.remove());
                const layer = document.createElement('div');
                layer.className = 'director-layer';
                layer.dataset.directorNode = step.id;
                Object.assign(layer.style, {
                    position: 'fixed', inset: '0', zIndex: '2147483646',
                    width: '100vw', height: '100vh', overflow: 'hidden', pointerEvents: 'none',
                });
                const style = document.createElement('style');
                style.dataset.directorNode = step.id;
                style.textContent = step.css;
                const anchor = document.createElement('div');
                anchor.className = 'director-layer__anchor';
                const horizontal = { left: 'start', center: 'center', right: 'end' };
                const vertical = { top: 'start', center: 'center', bottom: 'end' };
                Object.assign(anchor.style, {
                    position: 'fixed', display: 'grid', pointerEvents: 'none',
                    justifyItems: horizontal[step.placement.horizontal],
                    alignItems: vertical[step.placement.vertical],
                });
                const content = document.createElement('div');
                content.className = 'director-layer__content';
                content.style.position = 'relative';
                content.style.maxWidth = '100vw';
                content.style.maxHeight = '100vh';
                content.innerHTML = step.html;
                anchoring.place(step.placement, anchor);
                anchor.append(content);
                layer.append(anchor);
                document.documentElement.append(style, layer);
                anchoring.rememberLayer(step.id);
                const track = () => {
                    if (!layer.isConnected) return;
                    try { anchoring.place(step.placement, anchor); } catch {}
                    anchoring.rememberLayer(step.id);
                    requestAnimationFrame(track);
                };
                requestAnimationFrame(track);
            `,
            arguments: [step],
        });
    }

    private static async executeSourceOnWebsite(
        sessionId: string,
        step: RuntimeStep,
        playback = step.type === 'layer' ? step.playback! : { durationMs: 0, removeAfter: false },
    ): Promise<void> {
        const rootExpression =
            step.type === 'layer'
                ? `document.querySelector('[data-director-node="' + CSS.escape(arguments[1]) + '"] .director-layer__content')`
                : 'null';
        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: `${DirectorRuntimeScript.apiFactory()}
                return (async () => {
                    window.__directorResults ??= {};
                    delete window.__directorResults[arguments[1]];
                    const root = ${rootExpression};
                    const director = createDirectorRuntime(
                        arguments[0], root, document, undefined, window.__directorResults,
                        window.__directorInputs ?? {}
                    );
                    const result = await (async (director, document, window) => {
                        ${step.source}
                    })(director, document, window);
                    if (arguments[2].durationMs > 0) {
                        await director.wait(arguments[2].durationMs);
                    }
                    if (arguments[2].removeAfter) {
                        window.__directorAnchoring?.rememberLayer?.(arguments[1]);
                        document
                            .querySelectorAll('[data-director-node="' + CSS.escape(arguments[1]) + '"]')
                            .forEach((element) => element.remove());
                    }
                    if (result !== undefined) window.__directorResults[arguments[1]] = result;
                    return result;
                })();`,
            arguments: [step.speed, step.id, playback],
        });
    }

    private static removeLayer(sessionId: string, nodeId: string): Promise<unknown> {
        return this.browserAction(sessionId, {
            action: 'evaluate',
            script: `
                window.__directorAnchoring?.rememberLayer?.(arguments[0]);
                document
                    .querySelectorAll('[data-director-node="' + CSS.escape(arguments[0]) + '"]')
                    .forEach((element) => element.remove());
            `,
            arguments: [nodeId],
        });
    }

    private static async executeRuntimeStep(sessionId: string, step: RuntimeStep): Promise<void> {
        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: 'return window.__director.run(arguments[0]);',
            arguments: [[step]],
        });
    }

    private static removeRuntimeLayer(sessionId: string, nodeId: string): Promise<unknown> {
        return this.browserAction(sessionId, {
            action: 'evaluate',
            script: 'window.__director.remove(arguments[0]);',
            arguments: [nodeId],
        });
    }

    static async close(sessionId: string): Promise<void> {
        await this.request(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    }

    static async setRuntimeInputs(
        sessionId: string,
        inputs: Readonly<Record<string, string>>,
        excludedInputId?: string | null,
    ): Promise<void> {
        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: `window.__directorInputs = {};
                window.__directorInputChunks = {};`,
            arguments: [],
        });
        for (const [inputId, value] of Object.entries(inputs)) {
            if (inputId === excludedInputId) continue;
            for (let offset = 0; offset < value.length; offset += this.inputChunkSize) {
                const chunk = value.slice(offset, offset + this.inputChunkSize);
                const complete = offset + this.inputChunkSize >= value.length;
                await this.browserAction(sessionId, {
                    action: 'evaluate',
                    script: `const inputId = arguments[0];
                        const value = (window.__directorInputChunks[inputId] ?? '') + arguments[1];
                        if (arguments[2]) {
                            window.__directorInputs[inputId] = value;
                            delete window.__directorInputChunks[inputId];
                        } else {
                            window.__directorInputChunks[inputId] = value;
                        }`,
                    arguments: [inputId, chunk, complete],
                });
            }
        }
    }

    static async startSelectorPicker(sessionId: string): Promise<void> {
        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: `
                window.__directorSelectorPicker?.cleanup?.();
                const state = { status: 'picking', selector: null, cleanup: null };
                window.__directorSelectorPicker = state;
                const targetDocument =
                    document.querySelector('.director-website')?.contentDocument ?? document;
                const TargetElement = targetDocument.defaultView?.Element ?? Element;
                const marker = 'data-director-selector-picker-hover';
                const style = targetDocument.createElement('style');
                style.dataset.directorSelectorPicker = 'true';
                style.textContent =
                    '* { cursor: crosshair !important; } [' + marker + '] {' +
                    'outline: 3px solid #f3b34c !important;' +
                    'outline-offset: 2px !important;' +
                    '}';
                targetDocument.documentElement.append(style);
                let highlighted = null;

                const unique = selector => {
                    try { return targetDocument.querySelectorAll(selector).length === 1; }
                    catch { return false; }
                };
                const attributeSelector = (name, value) =>
                    '[' + name + '="' + CSS.escape(value) + '"]';
                const selectorFor = element => {
                    if (element.id) {
                        const selector = '#' + CSS.escape(element.id);
                        if (unique(selector)) return selector;
                    }
                    const stableAttributes = [
                        'data-testid', 'data-test', 'aria-label', 'name', 'placeholder'
                    ];
                    let stableCandidate = element;
                    while (stableCandidate && stableCandidate instanceof TargetElement) {
                        if (stableCandidate !== element && stableCandidate.id) {
                            const selector = '#' + CSS.escape(stableCandidate.id);
                            if (unique(selector)) return selector;
                        }
                        for (const name of stableAttributes) {
                            const value = stableCandidate.getAttribute(name);
                            if (!value) continue;
                            const attribute = attributeSelector(name, value);
                            if (unique(attribute)) return attribute;
                            const tagged = stableCandidate.tagName.toLowerCase() + attribute;
                            if (unique(tagged)) return tagged;
                        }
                        stableCandidate = stableCandidate.parentElement;
                    }
                    const classes = [...element.classList]
                        .filter(value => value && !value.startsWith('director-'))
                        .slice(0, 4);
                    for (let count = 1; count <= classes.length; count += 1) {
                        const selector = element.tagName.toLowerCase() + classes
                            .slice(0, count)
                            .map(value => '.' + CSS.escape(value))
                            .join('');
                        if (unique(selector)) return selector;
                    }
                    const path = [];
                    let current = element;
                    while (current && current instanceof TargetElement) {
                        let segment = current.tagName.toLowerCase();
                        const parent = current.parentElement;
                        if (parent) {
                            const siblings = [...parent.children]
                                .filter(child => child.tagName === current.tagName);
                            if (siblings.length > 1) {
                                segment += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
                            }
                        }
                        path.unshift(segment);
                        const selector = path.join(' > ');
                        if (unique(selector)) return selector;
                        current = parent;
                    }
                    return path.join(' > ');
                };
                const highlight = element => {
                    highlighted?.removeAttribute(marker);
                    highlighted = element instanceof TargetElement ? element : null;
                    highlighted?.setAttribute(marker, '');
                };
                const cleanup = () => {
                    targetDocument.removeEventListener('pointerover', onPointerOver, true);
                    targetDocument.removeEventListener('click', onClick, true);
                    targetDocument.removeEventListener('keydown', onKeyDown, true);
                    highlighted?.removeAttribute(marker);
                    style.remove();
                };
                const onPointerOver = event => highlight(event.target);
                const onClick = event => {
                    if (!(event.target instanceof TargetElement)) return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    state.selector = selectorFor(event.target);
                    state.status = 'selected';
                    cleanup();
                };
                const onKeyDown = event => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    state.status = 'cancelled';
                    cleanup();
                };
                state.cleanup = cleanup;
                targetDocument.addEventListener('pointerover', onPointerOver, true);
                targetDocument.addEventListener('click', onClick, true);
                targetDocument.addEventListener('keydown', onKeyDown, true);
            `,
            arguments: [],
        });
    }

    static async selectorPickerResult(sessionId: string): Promise<{
        readonly status: 'picking' | 'selected' | 'cancelled';
        readonly selector: string | null;
    }> {
        return (await this.browserAction(sessionId, {
            action: 'evaluate',
            script: `
                const state = window.__directorSelectorPicker;
                return state
                    ? { status: state.status, selector: state.selector }
                    : { status: 'cancelled', selector: null };
            `,
            arguments: [],
        })) as { status: 'picking' | 'selected' | 'cancelled'; selector: string | null };
    }

    static async cancelSelectorPicker(sessionId: string): Promise<void> {
        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: `
                window.__directorSelectorPicker?.cleanup?.();
                if (window.__directorSelectorPicker) window.__directorSelectorPicker.status = 'cancelled';
            `,
            arguments: [],
        });
    }

    private static publish(nodeId: string, document: string): Promise<PublishedPreview> {
        return this.fetch<PublishedPreview>(
            `/director-api/previews/nodes/${encodeURIComponent(nodeId)}`,
            {
                method: 'POST',
                body: document,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            },
        );
    }

    private static waitForDirectorRuntime(sessionId: string): Promise<unknown> {
        return this.request(`/sessions/${encodeURIComponent(sessionId)}/wait`, {
            method: 'POST',
            body: JSON.stringify({
                type: 'script',
                script: 'return Boolean(window.__director?.run);',
                arguments: [],
                timeoutMs: 10_000,
            }),
        });
    }

    private static browserAction<T = unknown>(sessionId: string, body: unknown): Promise<T> {
        return this.request<T>(`/sessions/${encodeURIComponent(sessionId)}/browser`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }

    private static mark(
        sessionId: string,
        name: string,
        data: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        return this.request(`/sessions/${encodeURIComponent(sessionId)}/marks`, {
            method: 'POST',
            body: JSON.stringify({ name, data }),
        });
    }

    private static click(sessionId: string, selector: string): Promise<unknown> {
        return this.request(`/sessions/${encodeURIComponent(sessionId)}/click`, {
            method: 'POST',
            body: JSON.stringify({ selector }),
        });
    }

    private static async wait(sessionId: string, step: RuntimeStep): Promise<unknown> {
        const condition =
            step.condition === 'url'
                ? { type: 'url', value: step.value, timeoutMs: step.timeoutMs }
                : step.condition === 'script'
                  ? {
                        type: 'script',
                        script: step.script,
                        arguments: [],
                        timeoutMs: step.timeoutMs,
                    }
                  : { type: 'element', selector: step.selector, timeoutMs: step.timeoutMs };
        await this.request(`/sessions/${encodeURIComponent(sessionId)}/wait`, {
            method: 'POST',
            body: JSON.stringify(condition),
        });
        if (step.condition !== 'script') return undefined;
        return this.browserAction(sessionId, {
            action: 'evaluate',
            script: step.script,
            arguments: [],
        });
    }

    private static storeResult(
        sessionId: string,
        nodeId: string,
        result: unknown,
    ): Promise<unknown> {
        return this.browserAction(sessionId, {
            action: 'evaluate',
            script: `window.__directorResults ??= {};
                window.__directorResults[arguments[0]] = arguments[1];`,
            arguments: [nodeId, result],
        });
    }

    private static clearResult(sessionId: string, nodeId: string): Promise<unknown> {
        return this.browserAction(sessionId, {
            action: 'evaluate',
            script: `window.__directorResults ??= {};
                delete window.__directorResults[arguments[0]];`,
            arguments: [nodeId],
        });
    }

    private static absoluteUrl(url: string): string {
        return /^https?:\/\//iu.test(url)
            ? new URL(url).toString()
            : new URL(url, globalThis.location.origin).toString();
    }

    private static isLocalHttps(url: string): boolean {
        const parsed = new URL(url);
        return (
            parsed.protocol === 'https:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase())
        );
    }

    private static isLocalOrigin(url: string): boolean {
        return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname.toLowerCase());
    }

    private static async uploadAsset(file: File): Promise<UploadedAsset> {
        const content = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', content);
        const sha256 = [...new Uint8Array(digest)]
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('');
        return this.request<UploadedAsset>('/assets', {
            method: 'POST',
            body: content,
            headers: {
                'Content-Type': 'application/octet-stream',
                'x-browser-testbench-asset-name': encodeURIComponent(file.name),
                'x-browser-testbench-asset-size': String(file.size),
                'x-browser-testbench-asset-sha256': sha256,
                'x-browser-testbench-asset-content-type': file.type || 'application/octet-stream',
            },
        });
    }

    private static async prepareInput(
        file: File,
        preparation: ProjectFileInput['prepare'],
    ): Promise<File> {
        if (!preparation) return file;
        let prepared = file;
        for (const module of preparation.modules) {
            prepared = await this.prepareInputWithModule(prepared, module);
        }
        return prepared;
    }

    private static async prepareInputWithModule(file: File, module: string): Promise<File> {
        const query = new URLSearchParams({ module });
        const response = await fetch(`/director-api/inputs/prepare?${query}`, {
            method: 'POST',
            body: file,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!response.ok) throw await this.responseError(response);
        const filename = decodeURIComponent(
            response.headers.get('x-director-file-name') ?? 'prepared-input',
        );
        return new File([await response.blob()], filename, {
            type: response.headers.get('content-type') ?? 'application/octet-stream',
        });
    }

    static async runtimeInputs(
        inputFiles: Readonly<Record<string, File>>,
        excludedInputId?: string | null,
    ): Promise<Readonly<Record<string, string>>> {
        const entries = await Promise.all(
            Object.entries(inputFiles)
                .filter(([inputId]) => inputId !== excludedInputId)
                .map(async ([inputId, file]) => [inputId, await this.dataUrl(file)] as const),
        );
        return Object.fromEntries(entries);
    }

    static async prepareRuntimeInputs(
        inputFiles: Readonly<Record<string, File>>,
        inputs: readonly ProjectFileInput[],
        excludedInputId?: string | null,
    ): Promise<Readonly<Record<string, string>>> {
        const entries = await Promise.all(
            Object.entries(inputFiles)
                .filter(([inputId]) => inputId !== excludedInputId)
                .map(async ([inputId, file]) => {
                    const input = inputs.find((candidate) => candidate.id === inputId);
                    const prepared = await this.prepareInput(file, input?.prepare);
                    return [inputId, await this.dataUrl(prepared)] as const;
                }),
        );
        return Object.fromEntries(entries);
    }

    private static async dataUrl(file: File): Promise<string> {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        const chunkSize = 32_768;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
    }

    static label(target: BrowserTestbenchTarget): string {
        if (typeof target.label === 'string') return target.label;
        const deviceName = target.label.parameters?.['deviceName'];
        const version = target.label.parameters?.['version'];
        if (deviceName) return version ? `${deviceName} · ${version}` : String(deviceName);
        return target.id;
    }

    private static async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
        return this.fetch<T>(`${this.apiBase}${path}`, options);
    }

    private static async lifecycleRequest(
        options: RequestInit = {},
    ): Promise<BrowserTestbenchStatus> {
        return this.fetch<BrowserTestbenchStatus>(this.lifecycleUrl, options);
    }

    private static async fetch<T>(url: string, options: RequestInit): Promise<T> {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });
        if (response.ok) return (await response.json()) as T;

        throw await this.responseError(response);
    }

    private static async responseError(response: Response): Promise<Error> {
        const payload = (await response.json().catch(() => ({}))) as BrowserTestbenchError;
        const message = typeof payload.message === 'string' ? payload.message : payload.error;
        return new Error(message ?? `Browser Testbench responded with HTTP ${response.status}.`);
    }
}
