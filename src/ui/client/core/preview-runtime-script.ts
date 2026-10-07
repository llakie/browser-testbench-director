import {
    DirectorRuntimeScript,
    MERGE_RACE_ABORT_REASON,
    type RuntimeStep,
} from './runtime-protocol.js';

interface PreviewRuntimeScriptValues {
    readonly steps: readonly RuntimeStep[];
    readonly executionId: number | null;
    readonly inputs: Readonly<Record<string, string>>;
    readonly variables?: Readonly<Record<string, string>>;
    readonly cameraInputId: string | null;
    readonly globalStylesheetInputIds: readonly string[];
}

export function renderPreviewRuntimeScript(values: PreviewRuntimeScriptValues): string {
    return `
const steps = ${JSON.stringify(values.steps)};
const initialExecutionId = ${JSON.stringify(values.executionId)};
const inputs = ${JSON.stringify(values.inputs)};
const variables = ${JSON.stringify(values.variables ?? {})};
const cameraInputId = ${JSON.stringify(values.cameraInputId)};
const mergeRaceAbortReason = ${JSON.stringify(MERGE_RACE_ABORT_REASON)};
let globalStylesheetInputIds = ${JSON.stringify(values.globalStylesheetInputIds)};
const overlays = document.querySelector('#director-overlays') || (() => {
    const host = document.createElement('div');
    host.id = 'director-overlays';
    document.documentElement.append(host);
    return host;
})();
let globalStylesHost = null;
const website = document.querySelector('.director-website');
let activeController = new AbortController();
let stepControllers = new Map();
const results = {};
const referenceRects = new Map();
const activeAudio = new Map();
const pendingFades = new Set();
const audioBuffers = new Map();
const globalStylesheets = new Map();
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
        left: rect.left + rect.width * (step.placement.offsetXPercent || 0) / 100 + 'px',
        top: rect.top + rect.height * (step.placement.offsetYPercent || 0) / 100 + 'px',
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

async function mountLayer(step) {
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

    if (step.fontInputId) {
        const source = inputs[step.fontInputId];

        if (!source) {
            throw new Error('The selected project font is missing.');
        }

        const family = 'Director Font ' + step.fontInputId.replace(/[^a-zA-Z0-9_-]/g, '-');
        style.textContent = '@font-face { font-family: "' + family + '"; src: url("' + source + '"); }\\n' + step.css;
        overlays.append(style);

        try {
            await document.fonts.load('16px "' + family + '"');
        } catch (error) {
            style.remove();
            throw error;
        }
    }
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
    content.innerHTML = step.html.replace(/\\{\\{\\s*variables\\.([a-z0-9_.]+)\\s*\\}\\}/giu, (_match, key) =>
        escapeHtml(variables[key] ?? ''),
    );
    for (const [key, value] of Object.entries(variables)) {
        content.style.setProperty('--director-' + key.replace(/\./gu, '-'), value);
    }
    placeAnchor(step, anchor);
    anchor.append(content);
    layer.append(anchor);
    overlays.append(style, layer);
    rememberLayerRect(step.id);
    trackLayer(step, layer, anchor);
    return content;
}

function escapeHtml(value) {
    const element = document.createElement('span');
    element.textContent = value;
    return element.innerHTML;
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

function scheduleAudioEnvelopeFrom(parameter, step, startTime, duration, offset) {
    const points = step.envelope;
    const nextIndex = points.findIndex((point) => point.time * duration >= offset);
    const left = points[Math.max(0, nextIndex - 1)] || points[0];
    const right = points[nextIndex] || points[points.length - 1];
    const distance = (right.time - left.time) * duration;
    const progress = distance > 0 ? (offset - left.time * duration) / distance : 0;
    const level = left.gain + (right.gain - left.gain) * Math.max(0, Math.min(1, progress));
    parameter.cancelScheduledValues(startTime);
    parameter.setValueAtTime(step.volume * level, startTime);
    points.forEach((point) => {
        const pointTime = point.time * duration;
        if (pointTime > offset) {
            parameter.linearRampToValueAtTime(
                step.volume * point.gain,
                startTime + pointTime - offset,
            );
        }
    });
}

function getAudioContext() {
    const Context = window.parent !== window
        ? window.parent.AudioContext || window.parent.webkitAudioContext
        : globalThis.AudioContext || globalThis.webkitAudioContext;

    if (!Context) {
        throw new Error('Web Audio is not supported by this browser.');
    }

    if (!audioContext && navigator.audioSession) {
        navigator.audioSession.type = 'playback';
    }

    audioContext ??= new Context();
    return audioContext;
}

function prepareAudio() {
    const context = getAudioContext();

    if (context.state === 'running') {
        return null;
    }

    const button = document.createElement('button');
    button.id = 'director-audio-unlock';
    button.textContent = 'Enable audio';
    Object.assign(button.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        background: 'transparent',
        border: '0',
        color: 'transparent',
    });
    button.addEventListener('click', () => {
        void context.resume();
        button.remove();
    }, { once: true });
    document.documentElement.append(button);
    return { x: innerWidth / 2, y: innerHeight / 2 };
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

async function preloadAudio(nextSteps) {
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
    if (step.speed === 'catchup') {
        if (step.loop && step.waitForEnd) {
            await new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => {
                    reject(new DOMException('The execution was stopped.', 'AbortError'));
                }, { once: true });
            });
        }

        return;
    }
    if (signal.aborted) throw new DOMException('The execution was stopped.', 'AbortError');
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
    const requestedStartOffset = (step.startOffsetMs || 0) / 1000;
    if (requestedStartOffset >= buffer.duration) {
        throw new Error('Audio start offset must be before the file end: ' + step.id);
    }
    const requestedFadeIn = (step.fadeInMs || 0) / 1000;
    const fadeOutSeconds = (step.fadeOutMs || 0) / 1000;
    let clipOffset = 0;
    let clipDuration = buffer.duration;
    let fadeInSeconds = requestedFadeIn;
    let naturalFadeOutSeconds = fadeOutSeconds;
    let naturalFadeStart = null;
    const updateClip = (seconds) => {
        clipOffset = Math.min(buffer.duration, Math.max(0, seconds));
        clipDuration = buffer.duration - clipOffset;
        const fileFadeScale = !step.loop && requestedFadeIn + fadeOutSeconds > clipDuration
            ? clipDuration / (requestedFadeIn + fadeOutSeconds)
            : 1;
        fadeInSeconds = requestedFadeIn * fileFadeScale;
        naturalFadeOutSeconds = fadeOutSeconds * fileFadeScale;
        naturalFadeStart = step.loop || naturalFadeOutSeconds === 0
            ? null
            : clipDuration - naturalFadeOutSeconds;
    };
    updateClip(requestedStartOffset);
    await context.resume();
    await new Promise((resolve, reject) => {
        let settled = false;
        let stopRequested = false;
        let playback;
        let fade;
        let startedAt = context.currentTime;
        let startPosition = 0;
        let pausedAt = 0;
        let paused = false;
        let resolveStopped = () => undefined;
        const stopped = new Promise((complete) => {
            resolveStopped = complete;
        });
        const cleanup = () => {
            signal.removeEventListener('abort', aborted);
            if (activeAudio.get(step.id)?.cancel === cancel) {
                activeAudio.delete(step.id);
            }
            resolveStopped();
        };
        const ended = () => {
            cleanup();
            if (step.waitForEnd && !settled) {
                settled = true;
                resolve();
            }
        };
        const cancel = () => {
            cleanup();
            try {
                playback?.stop();
            } catch {}
            if (step.waitForEnd && !settled) {
                settled = true;
                reject(new DOMException('The execution was stopped.', 'AbortError'));
            }
        };
        const currentSeconds = () => paused
            ? pausedAt
            : Math.min(
                clipDuration,
                step.loop
                    ? (context.currentTime - startedAt + startPosition) % clipDuration
                    : context.currentTime - startedAt + startPosition,
            );
        const stop = () => {
            if (stopRequested) return stopped;
            stopRequested = true;
            if (paused || !playback) {
                ended();
                return stopped;
            }
            const now = context.currentTime;
            const elapsed = currentSeconds();
            const fadeInLevel = fadeInSeconds > 0
                ? Math.min(1, elapsed / fadeInSeconds)
                : 1;
            const level = naturalFadeStart !== null && elapsed > naturalFadeStart
                ? Math.max(0, (clipDuration - elapsed) / naturalFadeOutSeconds)
                : fadeInLevel;
            fade.gain.cancelScheduledValues(now);
            fade.gain.setValueAtTime(level, now);
            if (fadeOutSeconds > 0) {
                fade.gain.linearRampToValueAtTime(0, now + fadeOutSeconds);
            }
            try {
                playback.stop(now + fadeOutSeconds);
            } catch {
                ended();
            }
            return stopped;
        };
        const position = () => ({
            positionMs: currentSeconds() * 1000,
            durationMs: clipDuration * 1000,
            paused,
        });
        const startAt = (position) => {
            const previous = playback;
            const now = context.currentTime;
            const sourceOffset = clipOffset + position;
            const gain = context.createGain();
            const nextFade = context.createGain();
            const next = context.createBufferSource();
            startedAt = now;
            startPosition = position;
            paused = false;
            fade = nextFade;
            playback = next;
            next.buffer = buffer;
            next.loop = Boolean(step.loop);
            next.loopStart = clipOffset;
            next.loopEnd = buffer.duration;
            next.connect(gain).connect(nextFade).connect(context.destination);
            if (position === 0) {
                scheduleAudioEnvelope(gain.gain, step, now, clipDuration);
            } else {
                scheduleAudioEnvelopeFrom(gain.gain, step, now, clipDuration, position);
            }
            const fadeInLevel = fadeInSeconds > 0 ? Math.min(1, position / fadeInSeconds) : 1;
            const fadeLevel = naturalFadeStart !== null && position > naturalFadeStart
                ? Math.max(0, (clipDuration - position) / naturalFadeOutSeconds)
                : fadeInLevel;
            nextFade.gain.setValueAtTime(fadeLevel, now);
            if (position < fadeInSeconds) {
                nextFade.gain.linearRampToValueAtTime(1, now + fadeInSeconds - position);
            }
            if (naturalFadeStart !== null) {
                const remaining = naturalFadeStart - position;
                if (remaining > 0) {
                    nextFade.gain.cancelScheduledValues(now + remaining);
                    nextFade.gain.setValueAtTime(1, now + remaining);
                }
                nextFade.gain.linearRampToValueAtTime(0, now + clipDuration - position);
            }
            next.addEventListener('ended', () => {
                if (playback === next) {
                    ended();
                }
            }, { once: true });
            next.start(0, sourceOffset);
            if (previous) {
                previous.stop();
                previous.disconnect();
            }
        };
        const seek = (seconds) => {
            if (!stopRequested && Number.isFinite(seconds) && !step.loop) {
                const position = Math.min(clipDuration, Math.max(0, seconds));
                if (paused) {
                    pausedAt = position;
                } else {
                    startAt(position);
                }
            }
        };
        const setStartOffset = (seconds) => {
            if (!paused || stopRequested || !Number.isFinite(seconds)) {
                return;
            }
            if (seconds >= buffer.duration) {
                throw new Error('Audio start offset must be before the file end: ' + step.id);
            }
            updateClip(seconds);
            pausedAt = 0;
        };
        const pause = () => {
            if (paused || stopRequested || !playback) {
                return;
            }
            pausedAt = currentSeconds();
            paused = true;
            const current = playback;
            playback = null;
            current.stop();
            current.disconnect();
        };
        const resume = () => {
            if (paused && !stopRequested) {
                startAt(pausedAt);
            }
        };
        const aborted = () => {
            if (signal.reason === mergeRaceAbortReason) {
                void stop();
                return;
            }

            cancel();
        };
        activeAudio.set(step.id, { cancel, stop, position, seek, setStartOffset, pause, resume });
        signal.addEventListener('abort', aborted, { once: true });
        startAt(0);
        if (!step.waitForEnd) {
            settled = true;
            resolve();
        }
    });
}

async function execute(step, signal = activeController.signal) {
    if (signal.aborted) throw new DOMException('The execution was stopped.', 'AbortError');
    if (step.type === 'audio') return playAudio(step, signal);
    if (step.type === 'layer' && step.placement.reference.type === 'dom') await websiteReady;
    const root = step.type === 'layer' ? await mountLayer(step) : null;
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
        variables,
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
    if (nodeId) {
        const completion = window.parent.__directorAudioPlayback?.stop(nodeId)
            || activeAudio.get(nodeId)?.stop()
            || Promise.resolve();
        pendingFades.add(completion);
        void completion.finally(() => pendingFades.delete(completion));
        return completion;
    }
    window.parent.__directorAudioPlayback?.cancel();
    activeAudio.forEach((audio) => {
        audio.cancel();
    });
    activeAudio.clear();
    pendingFades.clear();
    return Promise.resolve();
}

function seekAudio(nodeId, seconds) {
    if (window.parent.__directorAudioPlayback) {
        window.parent.__directorAudioPlayback.seek(nodeId, seconds);
        return;
    }

    activeAudio.get(nodeId)?.seek(seconds);
}

function setAudioStartOffset(nodeId, seconds) {
    if (window.parent.__directorAudioPlayback) {
        window.parent.__directorAudioPlayback.setStartOffset(nodeId, seconds);
        return;
    }

    activeAudio.get(nodeId)?.setStartOffset(seconds);
}

function setAudioPaused(nodeId, paused) {
    const playback = window.parent.__directorAudioPlayback || activeAudio.get(nodeId);
    playback?.[paused ? 'pause' : 'resume'](nodeId);
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

function setGlobalStylesheetInputIds(inputIds) {
    globalStylesheetInputIds = [...inputIds];

    for (const [inputId, current] of globalStylesheets) {
        if (!globalStylesheetInputIds.includes(inputId)) {
            current.element.remove();
            globalStylesheets.delete(inputId);
        }
    }
}

async function installGlobalStylesheets() {
    if (globalStylesheetInputIds.length === 0) {
        return;
    }

    if (!globalStylesHost) {
        globalStylesHost = document.createElement('div');
        globalStylesHost.id = 'director-global-styles';
        overlays.prepend(globalStylesHost);
    }

    for (const inputId of globalStylesheetInputIds) {
        const source = inputs[inputId];

        if (!source) {
            throw new Error('The global stylesheet is missing: ' + inputId);
        }

        const current = globalStylesheets.get(inputId);

        if (current?.source === source) {
            continue;
        }

        const response = await fetch(source);

        if (!response.ok) {
            throw new Error('The global stylesheet could not be loaded: ' + inputId);
        }

        const style = document.createElement('style');
        style.dataset.directorStylesheet = inputId;
        style.textContent = await response.text();
        if (current) {
            current.element.replaceWith(style);
        } else {
            globalStylesHost.append(style);
        }

        globalStylesheets.set(inputId, { source, element: style });
    }
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
    if (!activeRun?.recording || activeRun.recordingClockOffsetMs === null) return;
    const now = performance.now();
    activeRun.recordingMarks.push({
        name,
        data: {
            ...data,
            runtimeTimeMs: now - activeRun.startedAt,
        },
        recordingTimeMs: Math.max(0, activeRun.recordingClockOffsetMs + now),
    });
}


async function synchronizeRecordingClock(clockUrl) {
    const samples = [];
    for (let index = 0; index < 5; index += 1) {
        const sentAt = performance.now();
        const response = await fetch(clockUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            cache: 'no-store',
        });
        const receivedAt = performance.now();
        if (!response.ok) throw new Error('Recording clock synchronization failed: ' + response.status);
        const clock = await response.json();
        if (!Number.isFinite(clock.recordingTimeMs)) {
            throw new TypeError('Recording clock returned an invalid time.');
        }
        samples.push({
            roundTripMs: receivedAt - sentAt,
            offsetMs: clock.recordingTimeMs - (sentAt + receivedAt) / 2,
        });
    }
    samples.sort((left, right) => left.roundTripMs - right.roundTripMs);
    return samples[0].offsetMs;
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
}

function markEnd(step) {
    if (step.speed !== 'live') return;
    if (step.type === 'layer' && step.playback.durationMs > 0) {
        recordingMark('director.layer.end', { nodeId: step.id });
    }
    if (step.type === 'browser-wait' && !step.omitFromRecording) {
        recordingMark('director.wait.end', { nodeId: step.id });
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
        recordingClockOffsetMs: null,
        recordingMarks: [],
        startedAt: 0,
        cancelRequested: false,
    };
    activeRun = runState;
    try {
        if (nextSteps.length > 0) {
            await installGlobalStylesheets();
        }

        await preloadAudio(nextSteps);
        if (runState.recording) {
            if (!options.clockUrl) throw new TypeError('Recording clock URL is missing.');
            runState.recordingClockOffsetMs = await synchronizeRecordingClock(options.clockUrl);
        }
        runState.startedAt = performance.now();
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
                if (!winnerBranch.has(nodeId)) {
                    stepControllers.get(nodeId)?.abort(mergeRaceAbortReason);
                }
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
                report(
                    executionId,
                    step.id,
                    controller.signal.reason === mergeRaceAbortReason ? 'success' : 'cancelled',
                );
                return;
            }
            report(executionId, step.id, 'running');
            try {
                delete results[step.id];
                markStart(step);
                let result;
                try {
                    result = step.type === 'merge'
                        ? undefined
                        : await execute(step, controller.signal);

                    if (controller.signal.aborted) {
                        throw new DOMException('The execution was stopped.', 'AbortError');
                    }
                } finally {
                    markEnd(step);
                }
                if (result !== undefined) results[step.id] = result;
                report(executionId, step.id, 'success');
            } catch (error) {
                const cancelled = controller.signal.aborted && error?.name === 'AbortError';
                const plannedCancellation =
                    cancelled && controller.signal.reason === mergeRaceAbortReason;
                report(
                    executionId,
                    step.id,
                    plannedCancellation ? 'success' : cancelled ? 'cancelled' : 'error',
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
        await Promise.all(pendingFades);
        runState.state = runState.cancelRequested ? 'cancelled' : 'success';
    } catch (error) {
        runState.state = runState.cancelRequested ? 'cancelled' : 'error';
        runState.error = error instanceof Error ? error.message : String(error);
        throw error;
    } finally {
        if (activeRun === runState) {
            stopAudio();
        }
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
        audioPositions: Object.fromEntries(
            [...activeAudio].map(([nodeId, audio]) => [nodeId, audio.position()]),
        ),
        marks: activeRun.state === 'running' ? [] : activeRun.recordingMarks,
    };
}

const ready = run(steps, initialExecutionId);
window.__director = Object.freeze({
    prepareAudio,
    audioReady: () => audioContext?.state === 'running',
    run,
    start,
    status,
    execute: executeOne,
    begin,
    cancel,
    cancelStep,
    stopAudio,
    seekAudio,
    setAudioStartOffset,
    setAudioPaused,
    remove,
    setInputs,
    setGlobalStylesheetInputIds,
    ready,
});
ready.catch(showError);
`;
}
