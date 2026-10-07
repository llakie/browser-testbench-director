import type { AudioEnvelopePoint, BrowserWaitNode, LayerNode } from './project-format.js';

export const MERGE_RACE_ABORT_REASON = 'director:merge-race';

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
    readonly fontInputId?: string;
    readonly volume?: number;
    readonly envelope?: readonly AudioEnvelopePoint[];
    readonly waitForEnd?: boolean;
    readonly loop?: boolean;
    readonly startOffsetMs?: number;
    readonly fadeInMs?: number;
    readonly fadeOutMs?: number;
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
    variables = {},
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
        variables: Object.freeze({ ...variables }),
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
        stopAudio(nodeId) {
            if (typeof nodeId !== 'string' || !nodeId) {
                throw new TypeError('An audio node ID is required.');
            }

            return stopAudio(nodeId);
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
