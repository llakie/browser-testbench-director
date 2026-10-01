import type { RuntimeStep } from './runtime-protocol.js';
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
    readonly url: string;
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

interface PlayerOrigin {
    readonly origin: string;
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

export interface RecordingMark {
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

export interface RemoteRuntimeEvent {
    readonly sequence: number;
    readonly nodeId: string;
    readonly status: 'idle' | 'running' | 'success' | 'error' | 'cancelled';
    readonly error?: string;
}

interface RemoteRuntimeStatus {
    readonly state: 'missing' | 'running' | 'success' | 'error' | 'cancelled';
    readonly error?: string;
    readonly events: readonly RemoteRuntimeEvent[];
    readonly marks?: readonly RecordingMark[];
}

export class BrowserTestbenchPreview {
    private static readonly apiBase = '/browser-testbench-api';
    private static readonly lifecycleUrl = '/director-api/browser-testbench';
    private static readonly inputChunkSize = 256 * 1024;
    private static readonly sessionLeaseTimeoutMs = 15 * 60 * 1_000;
    private static readonly sessionKinds = new Map<string, BrowserTestbenchTarget['kind']>();

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
        if (!url.trim()) {
            throw new TypeError('Website URL must not be empty.');
        }

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
        target: BrowserTestbenchTarget | string,
        nodeId: string,
        document: string,
        inputFiles: Readonly<Record<string, File>> = {},
        inputs: readonly ProjectFileInput[] = [],
        headless = false,
        configuration?: BrowserSessionConfiguration,
        recording = false,
    ): Promise<string> {
        const runtimeInputs = await this.prepareRuntimeInputs(inputFiles, inputs);
        const [preview, player] = await Promise.all([
            this.publish(nodeId, document),
            this.playerOrigin(),
        ]);
        const previewUrl = new URL(preview.url, player.origin);
        const targetId = typeof target === 'string' ? target : target.id;
        const localHttps = this.isLocalHttps(previewUrl.toString());
        const capabilities =
            typeof target === 'string'
                ? localHttps
                    ? { acceptInsecureCerts: true }
                    : {}
                : this.sessionCapabilities(target, configuration, headless, localHttps);
        const permissions = (configuration?.permissions ?? []).map((name) => ({
            name,
            origin: previewUrl.origin,
        }));
        const localReverse =
            typeof target !== 'string' &&
            target.kind === 'mobile' &&
            this.isLocalOrigin(previewUrl.toString()) &&
            target.capabilities.localOrigins.reverse;
        const session = await this.request<StartedSession>('/sessions', {
            method: 'POST',
            body: JSON.stringify({
                target: targetId,
                url: previewUrl.toString(),
                headless,
                ...(recording
                    ? { require: { recording: { viewport: true, explicitLifecycle: true } } }
                    : {}),
                leaseTimeoutMs: this.sessionLeaseTimeoutMs,
                ...(localReverse ? { localOrigins: 'reverse' } : {}),
                ...(permissions.length ? { permissions } : {}),
                ...(Object.keys(capabilities).length ? { capabilities } : {}),
            }),
        });

        try {
            await this.waitForDirectorRuntime(session.id);

            if (Object.keys(runtimeInputs).length > 0) {
                await this.setRuntimeInputs(session.id, runtimeInputs);
            }

            if (typeof target !== 'string') {
                this.sessionKinds.set(session.id, target.kind);
            }

            return session.id;
        } catch (error) {
            await this.close(session.id).catch(() => undefined);
            throw error;
        }
    }

    static async navigate(sessionId: string, nodeId: string, document: string): Promise<void> {
        const [preview, player] = await Promise.all([
            this.publish(nodeId, document),
            this.playerOrigin(),
        ]);
        await this.request(`/sessions/${encodeURIComponent(sessionId)}/navigate`, {
            method: 'POST',
            body: JSON.stringify({
                url: new URL(preview.url, player.origin).toString(),
            }),
        });
        await this.waitForDirectorRuntime(sessionId);
    }

    static startRecording(sessionId: string, filename: string): Promise<unknown> {
        return this.request(`/sessions/${encodeURIComponent(sessionId)}/recording/start`, {
            method: 'POST',
            body: JSON.stringify({ outputPath: filename, scope: 'viewport' }),
        });
    }

    static discardRecording(sessionId: string): Promise<unknown> {
        return this.request(`/sessions/${encodeURIComponent(sessionId)}/recording/stop`, {
            method: 'POST',
            body: '{}',
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

        if (rect.innerWidth === innerWidth && rect.innerHeight === innerHeight) {
            return;
        }

        await this.browserAction(sessionId, {
            action: 'viewport',
            width: innerWidth + Math.max(0, rect.outerWidth - rect.innerWidth),
            height: innerHeight + Math.max(0, rect.outerHeight - rect.innerHeight),
        });
    }

    static async stopRecording(
        sessionId: string,
        filename: string,
        outputSize?: ExportViewport,
        marks: readonly RecordingMark[] = [],
    ): Promise<RecordingExport> {
        const recording = await this.request<RecordingArtifact>(
            `/sessions/${encodeURIComponent(sessionId)}/recording/stop`,
            { method: 'POST', body: '{}' },
        );
        const response = await fetch(
            `${this.apiBase}/sessions/${encodeURIComponent(sessionId)}/recording/artifacts/${encodeURIComponent(recording.artifactId)}`,
        );

        if (!response.ok) {
            throw await this.responseError(response);
        }

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
        const timeline = { ...recording, marks };
        const intervals = this.layerIntervals(timeline);
        const requestedOutput = outputSize ?? {
            width: recording.width,
            height: recording.height,
        };
        const output = this.evenViewport(requestedOutput);
        const blob = await this.normalizeRecording(original, filename, output, intervals);
        return {
            blob,
            filename,
            width: output.width,
            height: output.height,
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

        if (!response.ok) {
            throw await this.responseError(response);
        }

        return response.blob();
    }

    private static evenViewport(viewport: ExportViewport): ExportViewport {
        return {
            width: Math.ceil(viewport.width / 2) * 2,
            height: Math.ceil(viewport.height / 2) * 2,
        };
    }

    static async execute(
        sessionId: string,
        steps: readonly RuntimeStep[],
        markIntervals = false,
        executionSignal?: AbortSignal,
        onEvent: (event: RemoteRuntimeEvent) => void = () => undefined,
    ): Promise<readonly RecordingMark[]> {
        const executionId = crypto.randomUUID();
        await this.setRuntimePlan(sessionId, steps);

        if (steps.some((step) => step.type === 'audio' && step.speed === 'live')) {
            await this.prepareAudio(sessionId);
        }

        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: `window.__director.start(
                JSON.parse(window.__directorPlan),
                arguments[0],
                arguments[1]
            );
            return true;`,
            arguments: [
                executionId,
                {
                    recording: markIntervals,
                    clockUrl: markIntervals
                        ? `${this.apiBase}/sessions/${encodeURIComponent(sessionId)}/recording/clock`
                        : '',
                },
            ],
        });

        let sequence = 0;

        while (true) {
            if (executionSignal?.aborted) {
                await this.cancelRuntime(sessionId).catch(() => undefined);
                throw new DOMException('The execution was stopped.', 'AbortError');
            }

            const status = await this.browserAction<RemoteRuntimeStatus>(sessionId, {
                action: 'evaluate',
                script: 'return window.__director.status(arguments[0], arguments[1]);',
                arguments: [executionId, sequence],
            });

            for (const event of status.events) {
                sequence = Math.max(sequence, event.sequence);
                onEvent(event);
            }

            if (status.state === 'success') {
                return status.marks ?? [];
            }

            if (status.state === 'error') {
                throw new Error(status.error || 'Remote runtime failed.');
            }

            if (status.state === 'cancelled') {
                throw new DOMException('The execution was stopped.', 'AbortError');
            }

            if (status.state === 'missing') {
                throw new Error('Remote runtime state is unavailable.');
            }

            await this.delay(200, executionSignal ?? new AbortController().signal);
        }
    }

    static cancelRuntime(sessionId: string): Promise<unknown> {
        return this.browserAction(sessionId, {
            action: 'evaluate',
            script: 'window.__director?.cancel();',
            arguments: [],
        });
    }

    static async prepareAudio(
        sessionId: string,
        kind = this.sessionKinds.get(sessionId) ?? 'desktop',
    ): Promise<void> {
        const point = await this.browserAction<{ x: number; y: number } | null>(sessionId, {
            action: 'evaluate',
            script: 'return window.__director.prepareAudio();',
            arguments: [],
        });

        if (!point) {
            return;
        }

        try {
            if (kind === 'mobile') {
                await this.request(`/sessions/${encodeURIComponent(sessionId)}/gesture`, {
                    method: 'POST',
                    body: JSON.stringify({ type: 'tap', ...point }),
                });
            } else {
                await this.request(`/sessions/${encodeURIComponent(sessionId)}/click`, {
                    method: 'POST',
                    body: JSON.stringify({ selector: '#director-audio-unlock' }),
                });
            }

            const ready = await this.browserAction<boolean>(sessionId, {
                action: 'evaluate',
                script: 'return window.__director.audioReady();',
                arguments: [],
            });

            if (!ready) {
                throw new Error('Audio playback could not be enabled on this device.');
            }
        } finally {
            await this.browserAction(sessionId, {
                action: 'evaluate',
                script: 'document.getElementById("director-audio-unlock")?.remove();',
                arguments: [],
            });
        }
    }

    static async stopAudio(sessionId: string, nodeId?: string): Promise<void> {
        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: 'window.__director?.stopAudio?.(arguments[0]);',
            arguments: [nodeId],
        });
    }

    static layerIntervals(recording: RecordingArtifact): RecordingInterval[] {
        const starts = new Map<string, { timeMs: number; durationMs?: number }>();
        const intervals: RecordingInterval[] = [];

        for (const mark of recording.marks ?? []) {
            const nodeId = typeof mark.data?.['nodeId'] === 'string' ? mark.data['nodeId'] : null;

            if (!nodeId || !Number.isFinite(mark.recordingTimeMs)) {
                continue;
            }

            const timeMs = Math.max(0, Math.min(recording.durationMs, mark.recordingTimeMs!));

            if (mark.name === 'director.layer.start' || mark.name === 'director.wait.start') {
                const durationMs = Number(mark.data?.['durationMs']);
                starts.set(nodeId, {
                    timeMs,
                    ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
                });
            } else if (mark.name === 'director.layer.end' || mark.name === 'director.wait.end') {
                const start = starts.get(nodeId);
                starts.delete(nodeId);

                if (start && timeMs > start.timeMs) {
                    intervals.push({
                        startMs: start.timeMs,
                        endMs: Math.min(
                            timeMs,
                            start.durationMs === undefined
                                ? timeMs
                                : start.timeMs + start.durationMs,
                        ),
                    });
                }
            }
        }

        const sorted = intervals.sort((left, right) => left.startMs - right.startMs);
        const merged: RecordingInterval[] = [];

        for (const interval of sorted) {
            const previous = merged.at(-1);

            if (previous && interval.startMs <= previous.endMs) {
                merged[merged.length - 1] = {
                    startMs: previous.startMs,
                    endMs: Math.max(previous.endMs, interval.endMs),
                };
            } else {
                merged.push(interval);
            }
        }

        return merged;
    }

    private static delay(milliseconds: number, signal: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, milliseconds);
            signal.addEventListener(
                'abort',
                () => {
                    clearTimeout(timeout);
                    reject(new DOMException('The execution was stopped.', 'AbortError'));
                },
                { once: true },
            );
        });
    }

    static async close(sessionId: string): Promise<void> {
        try {
            await this.request(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
        } finally {
            this.sessionKinds.delete(sessionId);
        }
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
            if (inputId === excludedInputId) {
                continue;
            }

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

        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: 'window.__director?.setInputs(window.__directorInputs);',
            arguments: [],
        });
    }

    private static async setRuntimePlan(
        sessionId: string,
        steps: readonly RuntimeStep[],
    ): Promise<void> {
        const plan = JSON.stringify(steps);
        await this.browserAction(sessionId, {
            action: 'evaluate',
            script: 'window.__directorPlan = "";',
            arguments: [],
        });

        for (let offset = 0; offset < plan.length; offset += this.inputChunkSize) {
            await this.browserAction(sessionId, {
                action: 'evaluate',
                script: 'window.__directorPlan += arguments[0];',
                arguments: [plan.slice(offset, offset + this.inputChunkSize)],
            });
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

    private static playerOrigin(): Promise<PlayerOrigin> {
        if (globalThis.location.protocol === 'http:') {
            return Promise.resolve({ origin: globalThis.location.origin });
        }

        return this.fetch<PlayerOrigin>('/director-api/player-origin', { method: 'GET' });
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

    private static sessionCapabilities(
        target: BrowserTestbenchTarget,
        configuration: BrowserSessionConfiguration | undefined,
        headless: boolean,
        localHttps: boolean,
    ): Record<string, unknown> {
        const language = this.browserLanguage(configuration);
        const locale = language ? new Intl.Locale(language) : null;
        const capabilities: Record<string, unknown> = {
            ...(localHttps ? { acceptInsecureCerts: true } : {}),
        };

        if (target.kind === 'mobile') {
            const mobileLanguage = configuration?.language.trim();
            const mobileLocale = configuration?.locale.trim().toUpperCase();

            if (mobileLanguage) {
                capabilities['appium:language'] = locale?.language ?? mobileLanguage;
            }

            if (mobileLocale || locale?.region) {
                capabilities['appium:locale'] = mobileLocale || locale!.region;
            }

            if (target.browser === 'chrome-android') {
                const args = ['--disable-translate', '--disable-features=Translate,TranslateUI'];

                if (localHttps) {
                    args.unshift('--allow-insecure-localhost');
                }

                capabilities['goog:chromeOptions'] = {
                    args,
                };
            }

            return capabilities;
        }

        if (!language) {
            return capabilities;
        }

        const acceptLanguages = locale?.language ? `${language},${locale.language}` : language;

        if (target.browser === 'chrome') {
            capabilities['goog:chromeOptions'] = {
                args: [
                    '--remote-allow-origins=https://chrome-devtools-frontend.appspot.com',
                    ...(headless ? ['--headless=new'] : []),
                    `--lang=${language}`,
                    '--disable-features=Translate,TranslateUI',
                    ...(localHttps ? ['--allow-insecure-localhost'] : []),
                ],
                prefs: { 'intl.accept_languages': acceptLanguages },
            };
        } else if (target.browser === 'edge') {
            capabilities['ms:edgeOptions'] = {
                args: [
                    ...(headless ? ['--headless=new'] : []),
                    `--lang=${language}`,
                    '--disable-features=Translate,TranslateUI',
                    ...(localHttps ? ['--allow-insecure-localhost'] : []),
                ],
                prefs: { 'intl.accept_languages': acceptLanguages },
            };
        } else if (target.browser === 'firefox') {
            capabilities['moz:firefoxOptions'] = {
                ...(headless ? { args: ['-headless'] } : {}),
                prefs: { 'intl.accept_languages': acceptLanguages },
            };
        }

        return capabilities;
    }

    private static browserLanguage(configuration: BrowserSessionConfiguration | undefined): string {
        const language = configuration?.language.trim().replaceAll('_', '-');
        const region = configuration?.locale.trim().toUpperCase();

        if (!language) {
            return '';
        }

        try {
            const parsed = new Intl.Locale(language);
            return new Intl.Locale(
                !parsed.region && region ? `${language}-${region}` : language,
            ).toString();
        } catch {
            return region && !language.includes('-') ? `${language}-${region}` : language;
        }
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

    private static async prepareInput(
        file: File,
        preparation: ProjectFileInput['prepare'],
    ): Promise<File> {
        if (!preparation) {
            return file;
        }

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

        if (!response.ok) {
            throw await this.responseError(response);
        }

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
        if (typeof target.label === 'string') {
            return target.label;
        }

        const deviceName = target.label.parameters?.['deviceName'];
        const version = target.label.parameters?.['version'];

        if (deviceName) {
            return version ? `${deviceName} · ${version}` : String(deviceName);
        }

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

        if (response.ok) {
            return (await response.json()) as T;
        }

        throw await this.responseError(response);
    }

    private static async responseError(response: Response): Promise<Error> {
        const payload = (await response.json().catch(() => ({}))) as BrowserTestbenchError;
        const message = typeof payload.message === 'string' ? payload.message : payload.error;
        return new Error(message ?? `Browser Testbench responded with HTTP ${response.status}.`);
    }
}
