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
const overlays = document.querySelector('#director-overlays');
const website = document.querySelector('.director-website');
let activeController = new AbortController();
const results = {};
const referenceRects = new Map();
const activeAudio = new Map();
const previewCameraStream = cameraInputId && inputs[cameraInputId]
    ? createPreviewCameraStream(inputs[cameraInputId])
    : null;
Object.defineProperty(globalThis, '__directorPreviewCameraStream', {
    configurable: true,
    value: () => previewCameraStream,
});
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
            canvas.getContext('2d').drawImage(image, 0, 0);
            if (typeof canvas.captureStream !== 'function') {
                reject(new Error('This browser cannot simulate a camera in the local preview.'));
                return;
            }
            resolve(canvas.captureStream(30));
        }, { once: true });
        image.addEventListener('error', () => {
            reject(new Error('The configured preview camera image could not be loaded.'));
        }, { once: true });
        image.src = source;
    });
}

function installPreviewCamera() {
    if (!previewCameraStream || !website?.contentWindow) return;
    const mediaDevices = website.contentWindow.navigator.mediaDevices;
    if (!mediaDevices) throw new Error('The website does not expose the MediaDevices API.');
    const nativeGetUserMedia = mediaDevices.getUserMedia?.bind(mediaDevices);
    Object.defineProperty(mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints = {}) => {
            if (!constraints.video && nativeGetUserMedia) return nativeGetUserMedia(constraints);
            const stream = await previewCameraStream;
            return new website.contentWindow.MediaStream(
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
    const style = document.createElement('style');
    style.dataset.directorNode = step.id;
    style.textContent = step.css;
    const anchor = document.createElement('div');
    anchor.className = 'director-layer__anchor';
    anchor.dataset.horizontal = step.placement.horizontal;
    anchor.dataset.vertical = step.placement.vertical;
    const content = document.createElement('div');
    content.className = 'director-layer__content';
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

async function playAudio(step) {
    if (step.speed === 'catchup') return;
    const source = inputs[step.inputId];
    if (!source) throw new Error('Audio input is missing: ' + (step.inputId || step.id));
    const parentPlayback = window.parent !== window
        ? window.parent.__directorAudioPlayback
        : null;
    if (parentPlayback) {
        return parentPlayback.play(step, source, activeController.signal);
    }
    const AudioConstructor = window.parent !== window ? window.parent.Audio : Audio;
    const audio = new AudioConstructor(source);
    audio.volume = step.volume;
    activeAudio.set(step.id, audio);
    await audio.play();
    if (!step.waitForEnd) return;
    await new Promise((resolve, reject) => {
        const complete = () => {
            audio.removeEventListener('ended', ended);
            audio.removeEventListener('error', failed);
            activeController.signal.removeEventListener('abort', aborted);
        };
        const ended = () => {
            complete();
            activeAudio.delete(step.id);
            resolve();
        };
        const failed = () => {
            complete();
            reject(new Error('Audio playback failed: ' + step.id));
        };
        const aborted = () => {
            complete();
            audio.pause();
            activeAudio.delete(step.id);
            reject(new DOMException('The execution was stopped.', 'AbortError'));
        };
        audio.addEventListener('ended', ended, { once: true });
        audio.addEventListener('error', failed, { once: true });
        activeController.signal.addEventListener('abort', aborted, { once: true });
    });
}

async function execute(step) {
    if (step.type === 'audio') return playAudio(step);
    if (step.type === 'layer' && step.placement.reference.type === 'dom') await websiteReady;
    const root = step.type === 'layer' ? mountLayer(step) : null;
    await websiteReady;
    const targetDocument = websiteDocument();
    const director = createDirectorRuntime(
        step.speed,
        root,
        targetDocument,
        activeController.signal,
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

function begin() {
    activeController.abort();
    window.parent.__directorAudioPlayback?.cancel();
    activeAudio.forEach((audio) => audio.pause());
    activeAudio.clear();
    activeController = new AbortController();
}

function cancel() {
    activeController.abort();
    window.parent.__directorAudioPlayback?.cancel();
    activeAudio.forEach((audio) => audio.pause());
    activeAudio.clear();
}

function remove(nodeId) {
    unmountLayer({ id: nodeId });
}

function report(executionId, nodeId, status, error) {
    window.parent.postMessage({
        type: 'director:execution',
        executionId,
        nodeId,
        status,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
    }, '*');
}

async function run(nextSteps, executionId = null) {
    begin();
    const executions = new Map();
    for (const step of nextSteps) {
        const dependencies = step.after.map((id) => {
            const execution = executions.get(id);
            if (!execution) throw new TypeError('Runtime dependency not found: ' + id);
            return execution;
        });
        const ready = dependencies.length === 0
            ? Promise.resolve()
            : step.type === 'merge' && step.waitFor === 'any'
                ? Promise.race(dependencies)
                : Promise.all(dependencies);
        const execution = ready.then(async () => {
            report(executionId, step.id, 'running');
            try {
                delete results[step.id];
                const result = step.type === 'merge' ? undefined : await execute(step);
                if (result !== undefined) results[step.id] = result;
                report(executionId, step.id, 'success');
            } catch (error) {
                const cancelled = error instanceof DOMException && error.name === 'AbortError';
                report(executionId, step.id, cancelled ? 'cancelled' : 'error', error);
                throw error;
            }
        });
        executions.set(step.id, execution);
    }
    await Promise.all(executions.values());
}

const ready = run(steps, initialExecutionId);
window.__director = Object.freeze({ run, execute, begin, cancel, remove, ready });
ready.catch(showError);
`;
}
