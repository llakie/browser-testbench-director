import { DirectorRuntimeScript, type RuntimeStep } from './runtime-protocol.js';

interface PreviewRuntimeScriptValues {
    readonly steps: readonly RuntimeStep[];
    readonly executionId: number | null;
    readonly inputs: Readonly<Record<string, string>>;
    readonly cameraInputId: string | null;
}

export function renderPreviewRuntimeScript(values: PreviewRuntimeScriptValues): string {
    return `
const steps = ${JSON.stringify(values.steps)};
const initialExecutionId = ${JSON.stringify(values.executionId)};
const inputs = ${JSON.stringify(values.inputs)};
const cameraInputId = ${JSON.stringify(values.cameraInputId)};
const overlays = document.querySelector('#director-overlays') || (() => {
    const host = document.createElement('div');
    host.id = 'director-overlays';
    document.documentElement.append(host);
    return host;
})();
const website = document.querySelector('.director-website');
let activeController = new AbortController();
let stepControllers = new Map();
const results = {};
const referenceRects = new Map();
const activeAudio = new Map();
const audioBuffers = new Map();
let audioContext = null;
let eventSequence = 0;
let activeRun = null;
const previewCameraStream = cameraInputId && inputs[cameraInputId]
    ? createPreviewCameraStream(inputs[cameraInputId])
    : null;

if (previewCameraStream) {
    Object.defineProperty(globalThis, '__directorPreviewCameraStream', {
        configurable: true,
        value: () => previewCameraStream,
    });
}

const websiteReady = website
    ? new Promise((resolve, reject) => {
          let initialLoad = true;
          const loaded = () => {
              try {
                  installPreviewCamera();
                  if (initialLoad) {
                      initialLoad = false;
                      resolve();
                  }
              } catch (error) {
                  if (initialLoad) {
                      initialLoad = false;
                      reject(error);
                  }
                  else showError(error);
              }
          };
          website.addEventListener('load', loaded);
          try {
              if (
                  website.contentDocument?.readyState === 'complete' &&
                  website.contentDocument.URL !== 'about:blank'
              ) loaded();
          } catch {}
          website.src = website.dataset.directorSrc;
      })
    : Promise.resolve();

function createPreviewCameraStream(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            if (typeof canvas.captureStream !== 'function') {
                reject(new Error('This browser cannot simulate a camera in the local preview.'));
                return;
            }

            const stream = canvas.captureStream(30);
            const renderFrame = () => {
                context.drawImage(image, 0, 0);

                if (stream.getVideoTracks().some((track) => track.readyState === 'live')) {
                    requestAnimationFrame(renderFrame);
                }
            };
            renderFrame();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => resolve(stream));
            });
        }, { once: true });
        image.addEventListener('error', () => {
            reject(new Error('The configured preview camera image could not be loaded.'));
        }, { once: true });
        image.src = source;
    });
}

function installPreviewCamera() {
    if (!previewCameraStream || !website?.contentWindow) return;
    const websiteWindow = website.contentWindow;

    if (!websiteWindow.isSecureContext) {
        Object.defineProperty(websiteWindow, 'isSecureContext', {
            configurable: true,
            value: true,
        });
    }

    const mediaDevices = websiteWindow.navigator.mediaDevices || {};
    Object.defineProperty(websiteWindow.navigator, 'mediaDevices', {
        configurable: true,
        value: mediaDevices,
    });
    const nativeGetUserMedia = mediaDevices.getUserMedia?.bind(mediaDevices);
    Object.defineProperty(mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints = {}) => {
            if (!constraints.video && nativeGetUserMedia) return nativeGetUserMedia(constraints);
            const stream = await previewCameraStream;
            return new websiteWindow.MediaStream(
                stream.getVideoTracks().map((track) => track.clone()),
            );
        },
    });
}

function showError(error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const output = document.createElement('pre');
    output.className = 'preview-error';
    output.textContent = error instanceof Error ? error.stack || error.message : String(error);
    document.body.append(output);
}

function websiteDocument() {
    if (!website) return document;
    try {
        if (website.contentDocument) return website.contentDocument;
    } catch {}
    throw new Error('The website is cross-origin. Run JavaScript nodes through Browser Testbench.');
}

${DirectorRuntimeScript.apiFactory()}

function validRect(rect) {
    return rect && rect.width > 0 && rect.height > 0;
}

function rememberRect(key, rect) {
    if (!validRect(rect)) return null;
    const value = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    referenceRects.set(key, value);
    return value;
}

function rememberLayerRect(nodeId) {
    const content = document.querySelector(
        '[data-director-node="' + CSS.escape(nodeId) + '"] .director-layer__content'
    );
    return content ? rememberRect('layer:' + nodeId, content.getBoundingClientRect()) : null;
}

function referenceRect(reference) {
    if (reference.type === 'viewport') {
        return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    if (reference.type === 'layer') {
        return rememberLayerRect(reference.nodeId) || referenceRects.get('layer:' + reference.nodeId) ||
            (() => { throw new Error('Parent layer has no measurable content: ' + reference.nodeId); })();
    }
    const key = 'dom:' + reference.selector;
    const element = websiteDocument().querySelector(reference.selector);
    return (element && rememberRect(key, element.getBoundingClientRect())) || referenceRects.get(key) ||
        (() => { throw new Error('DOM anchor not found or not measurable: ' + reference.selector); })();
}

function placeAnchor(step, anchor) {
    const rect = referenceRect(step.placement.reference);
    Object.assign(anchor.style, {
        left: rect.left + 'px',
        top: rect.top + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
    });
}

function trackLayer(step, layer, anchor) {
    const update = () => {
        if (!layer.isConnected) return;
        try { placeAnchor(step, anchor); } catch {}
        rememberLayerRect(step.id);
        requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
}

function mountLayer(step) {
    unmountLayer(step);
    const layer = document.createElement('div');
    layer.className = 'director-layer';
    layer.dataset.directorNode = step.id;
    Object.assign(layer.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        pointerEvents: 'none',
    });
    const style = document.createElement('style');
    style.dataset.directorNode = step.id;
    style.textContent = step.css;
    const anchor = document.createElement('div');
    anchor.className = 'director-layer__anchor';
    anchor.dataset.horizontal = step.placement.horizontal;
    anchor.dataset.vertical = step.placement.vertical;
    Object.assign(anchor.style, {
        position: 'fixed',
        display: 'grid',
        pointerEvents: 'none',
        justifyItems: { left: 'start', center: 'center', right: 'end' }[
            step.placement.horizontal
        ],
        alignItems: { top: 'start', center: 'center', bottom: 'end' }[
            step.placement.vertical
        ],
    });
    const content = document.createElement('div');
    content.className = 'director-layer__content';
    Object.assign(content.style, {
        position: 'relative',
        maxWidth: '100vw',
        maxHeight: '100vh',
    });
    content.innerHTML = step.html;
    placeAnchor(step, anchor);
    anchor.append(content);
    layer.append(anchor);
    overlays.append(style, layer);
    rememberLayerRect(step.id);
    trackLayer(step, layer, anchor);
    return content;
}

function unmountLayer(step) {
    rememberLayerRect(step.id);
    document
        .querySelectorAll('[data-director-node="' + CSS.escape(step.id) + '"]')
        .forEach((element) => element.remove());
}

function scheduleAudioEnvelope(parameter, step, startTime, duration) {
    parameter.cancelScheduledValues(startTime);
    parameter.setValueAtTime(step.volume * step.envelope[0].gain, startTime);
    step.envelope.slice(1).forEach((point) => {
        parameter.linearRampToValueAtTime(
            step.volume * point.gain,
            startTime + point.time * duration,
        );
    });
}

function getAudioContext() {
    const Context = window.parent !== window
        ? window.parent.AudioContext || window.parent.webkitAudioContext
        : globalThis.AudioContext || globalThis.webkitAudioContext;

    if (!Context) {
        throw new Error('Web Audio is not supported by this browser.');
    }

    audioContext ??= new Context();
    return audioContext;
}

function loadAudioBuffer(step) {
    const source = inputs[step.inputId];

    if (!source) {
        throw new Error('Audio input is missing: ' + (step.inputId || step.id));
    }

    const cached = audioBuffers.get(source);

    if (cached) {
        return cached;
    }

    const loading = fetch(source)
        .then((response) => {
            if (!response.ok) {
                throw new Error('Audio input could not be loaded: ' + (step.inputId || step.id));
            }
            return response.arrayBuffer();
        })
        .then((data) => getAudioContext().decodeAudioData(data))
        .catch((error) => {
            audioBuffers.delete(source);
            throw error;
        });
    audioBuffers.set(source, loading);
    return loading;
}

async function preloadAudio(nextSteps, options) {
    if (options.recording) {
        return;
    }

    const audioSteps = nextSteps.filter(
        (step) => step.type === 'audio' && step.speed !== 'catchup'
    );
    const parentPlayback = window.parent !== window
        ? window.parent.__directorAudioPlayback
        : null;
    if (parentPlayback) {
        await parentPlayback.preload(audioSteps, inputs);
        return;
    }

    await Promise.all(audioSteps.map(loadAudioBuffer));
}

async function playAudio(step, signal) {
    if (step.speed === 'catchup') return;
    if (signal.aborted) throw new DOMException('The execution was stopped.', 'AbortError');
    if (activeRun?.recording) {
        if (!step.waitForEnd) return;
        if (!Number.isFinite(step.durationMs) || step.durationMs <= 0) {
            throw new Error('Audio duration is missing: ' + step.id);
        }
        const director = createDirectorRuntime(
            step.speed,
            null,
            websiteDocument(),
            signal,
            results,
            inputs,
            websiteDocument,
        );
        await director.wait(step.durationMs);
        return;
    }
    const source = inputs[step.inputId];
    if (!source) throw new Error('Audio input is missing: ' + (step.inputId || step.id));
    const parentPlayback = window.parent !== window
        ? window.parent.__directorAudioPlayback
        : null;
    if (parentPlayback) {
        return parentPlayback.play(step, source, signal);
    }
    const context = getAudioContext();
    const buffer = await loadAudioBuffer(step);
    if (signal.aborted) throw new DOMException('The execution was stopped.', 'AbortError');
    const playback = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = step.volume * step.envelope[0].gain;
    playback.buffer = buffer;
    playback.connect(gain).connect(context.destination);
    scheduleAudioEnvelope(
        gain.gain,
        step,
        context.currentTime,
        buffer.duration,
    );
    activeAudio.set(step.id, playback);
    await context.resume();
    playback.start();
    if (!step.waitForEnd) {
        const complete = () => {
            signal.removeEventListener('abort', aborted);
            activeAudio.delete(step.id);
        };
        const aborted = () => {
            try {
                playback.stop();
            } catch {}
            complete();
        };
        playback.addEventListener('ended', complete, { once: true });
        signal.addEventListener('abort', aborted, { once: true });
        return;
    }
    await new Promise((resolve, reject) => {
        const complete = () => {
            playback.removeEventListener('ended', ended);
            signal.removeEventListener('abort', aborted);
        };
        const ended = () => {
            complete();
            activeAudio.delete(step.id);
            resolve();
        };
        const aborted = () => {
            complete();
            try {
                playback.stop();
            } catch {}
            activeAudio.delete(step.id);
            reject(new DOMException('The execution was stopped.', 'AbortError'));
        };
        playback.addEventListener('ended', ended, { once: true });
        signal.addEventListener('abort', aborted, { once: true });
    });
}

async function execute(step, signal = activeController.signal) {
    if (signal.aborted) throw new DOMException('The execution was stopped.', 'AbortError');
    if (step.type === 'audio') return playAudio(step, signal);
    if (step.type === 'layer' && step.placement.reference.type === 'dom') await websiteReady;
    const root = step.type === 'layer' ? mountLayer(step) : null;
    if (step.type === 'layer') {
        signal.addEventListener('abort', () => unmountLayer(step), { once: true });
    }
    await websiteReady;
    const targetDocument = websiteDocument();
    const director = createDirectorRuntime(
        step.speed,
        root,
        targetDocument,
        signal,
        results,
        inputs,
        websiteDocument,
    );
    if (step.type === 'browser-action') {
        const element = targetDocument.querySelector(step.selector);
        if (!(element instanceof targetDocument.defaultView.HTMLElement)) {
            throw new Error('Element not found: ' + step.selector);
        }
        element.click();
        return;
    }
    if (step.type === 'browser-wait') {
        if (step.condition === 'element') {
            await director.waitFor(step.selector, step.timeoutMs);
            return;
        }
        if (step.condition === 'url') return director.waitForUrl(step.value, step.timeoutMs);
        return director.waitForScript(step.script, step.timeoutMs);
    }
    const result = await createDirectorAsyncFunction(
        targetDocument,
        'director',
        'document',
        'window',
        step.source,
    )(director, targetDocument, targetDocument.defaultView || window);
    if (step.type === 'layer') {
        if (step.playback.durationMs > 0) await director.wait(step.playback.durationMs);
        if (step.playback.removeAfter) unmountLayer(step);
    }
    return result;
}

async function executeOne(step) {
    stepControllers.get(step.id)?.abort();
    const controller = new AbortController();
    activeController.signal.addEventListener('abort', () => controller.abort(), { once: true });
    stepControllers.set(step.id, controller);
    return execute(step, controller.signal);
}

function begin() {
    activeController.abort();
    stopAudio();
    activeController = new AbortController();
    stepControllers = new Map();
}

function stopAudio(nodeId) {
    window.parent.__directorAudioPlayback?.cancel(nodeId);
    if (nodeId) {
        try {
            activeAudio.get(nodeId)?.stop();
        } catch {}
        activeAudio.delete(nodeId);
        return;
    }
    activeAudio.forEach((audio) => {
        try {
            audio.stop();
        } catch {}
    });
    activeAudio.clear();
}

function cancel() {
    if (activeRun?.state === 'running') activeRun.cancelRequested = true;
    activeController.abort();
    stopAudio();
}

function cancelStep(nodeId) {
    stepControllers.get(nodeId)?.abort();
}

function remove(nodeId) {
    unmountLayer({ id: nodeId });
}

function setInputs(nextInputs) {
    Object.assign(inputs, nextInputs);
}

function report(executionId, nodeId, status, error) {
    const message = {
        type: 'director:execution',
        executionId,
        nodeId,
        status,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
    };
    if (activeRun?.executionId === executionId) {
        activeRun.events.push({ ...message, sequence: ++eventSequence });
    }
    if (window.parent !== window) {
        window.parent.dispatchEvent(new MessageEvent('message', { data: message, source: window }));
        return;
    }
    window.postMessage(message, '*');
}

function recordingMark(name, data) {
    if (!activeRun?.recording || !activeRun.markUrl) return;
    const request = fetch(activeRun.markUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name,
            data: {
                ...data,
                runtimeTimeMs: performance.now() - activeRun.startedAt,
            },
        }),
    }).then((response) => {
        if (!response.ok) throw new Error('Recording mark failed: ' + response.status);
    });
    activeRun.markRequests.push(request);
}

function markStart(step) {
    if (step.speed !== 'live') return;
    if (step.type === 'layer' && step.playback.durationMs > 0) {
        recordingMark('director.layer.start', {
            nodeId: step.id,
            durationMs: step.playback.durationMs,
        });
    }
    if (step.type === 'browser-wait' && !step.omitFromRecording) {
        recordingMark('director.wait.start', { nodeId: step.id });
    }
    if (step.type === 'audio') {
        recordingMark('director.audio.start', { nodeId: step.id });
    }
}

function markEnd(step) {
    if (step.speed !== 'live') return;
    if (step.type === 'layer' && step.playback.durationMs > 0) {
        recordingMark('director.layer.end', { nodeId: step.id });
    }
    if (step.type === 'browser-wait' && !step.omitFromRecording) {
        recordingMark('director.wait.end', { nodeId: step.id });
    }
    if (step.type === 'audio' && step.waitForEnd) {
        recordingMark('director.audio.end', { nodeId: step.id });
    }
}

async function run(nextSteps, executionId = null, options = {}) {
    begin();
    const runState = {
        executionId,
        state: 'running',
        error: undefined,
        events: [],
        recording: Boolean(options.recording),
        markUrl: options.markUrl || '',
        markRequests: [],
        startedAt: performance.now(),
        cancelRequested: false,
    };
    activeRun = runState;
    try {
        await preloadAudio(nextSteps, options);
    } catch (error) {
        runState.state = 'error';
        runState.error = error instanceof Error ? error.message : String(error);
        throw error;
    }
    const executions = new Map();
    const stepsById = new Map(nextSteps.map((step) => [step.id, step]));
    const ancestors = (id, result = new Set()) => {
        if (result.has(id)) return result;
        result.add(id);
        const step = stepsById.get(id);
        for (const dependencyId of step?.after ?? []) {
            ancestors(dependencyId, result);
        }
        return result;
    };
    const cancelLosingBranches = (winnerId, dependencyIds) => {
        const winnerBranch = ancestors(winnerId);
        for (const dependencyId of dependencyIds) {
            if (dependencyId === winnerId) continue;
            for (const nodeId of ancestors(dependencyId)) {
                if (!winnerBranch.has(nodeId)) stepControllers.get(nodeId)?.abort();
            }
        }
    };
    for (const step of nextSteps) {
        const dependencyIds = step.after ?? [];
        const dependencies = dependencyIds.map((id) => {
            const execution = executions.get(id);
            if (!execution) throw new TypeError('Runtime dependency not found: ' + id);
            return execution;
        });
        const controller = new AbortController();
        activeController.signal.addEventListener('abort', () => controller.abort(), { once: true });
        stepControllers.set(step.id, controller);
        const ready = dependencies.length === 0
            ? Promise.resolve()
            : step.type === 'merge' && step.waitFor === 'any'
                ? Promise.race(
                    dependencies.map((dependency, index) =>
                        dependency.then(() => dependencyIds[index])
                    )
                ).then((winnerId) => cancelLosingBranches(winnerId, dependencyIds))
                : Promise.all(dependencies);
        const execution = ready.then(async () => {
            if (controller.signal.aborted) {
                report(executionId, step.id, 'cancelled');
                return;
            }
            report(executionId, step.id, 'running');
            try {
                delete results[step.id];
                markStart(step);

                if (step.type === 'audio' && !step.waitForEnd && step.speed === 'live') {
                    controller.signal.addEventListener(
                        'abort',
                        () => recordingMark('director.audio.end', { nodeId: step.id }),
                        { once: true },
                    );
                }

                let result;
                try {
                    result = step.type === 'merge'
                        ? undefined
                        : await execute(step, controller.signal);
                } finally {
                    markEnd(step);
                }
                if (result !== undefined) results[step.id] = result;
                report(executionId, step.id, 'success');
            } catch (error) {
                const cancelled = controller.signal.aborted && error?.name === 'AbortError';
                report(
                    executionId,
                    step.id,
                    cancelled ? 'cancelled' : 'error',
                    cancelled ? undefined : error,
                );
                if (cancelled) return;
                throw error;
            }
        });
        executions.set(step.id, execution);
    }
    try {
        await Promise.all(executions.values());
        await Promise.all(runState.markRequests);
        runState.state = runState.cancelRequested ? 'cancelled' : 'success';
    } catch (error) {
        await Promise.allSettled(runState.markRequests);
        runState.state = runState.cancelRequested ? 'cancelled' : 'error';
        runState.error = error instanceof Error ? error.message : String(error);
        throw error;
    }
}

function start(nextSteps, executionId, options = {}) {
    void run(nextSteps, executionId, options).catch(showError);
}

function status(executionId, afterSequence = 0) {
    if (!activeRun || activeRun.executionId !== executionId) {
        return { state: 'missing', events: [] };
    }
    return {
        state: activeRun.state,
        error: activeRun.error,
        events: activeRun.events.filter((event) => event.sequence > afterSequence),
    };
}

const ready = run(steps, initialExecutionId);
window.__director = Object.freeze({
    run,
    start,
    status,
    execute: executeOne,
    begin,
    cancel,
    cancelStep,
    stopAudio,
    remove,
    setInputs,
    ready,
});
ready.catch(showError);
`;
}
