import type { LayerNode } from './project-format.js';
import { DirectorRuntimeScript, type RuntimeStep } from './runtime-protocol.js';
import type { WorkflowPlan, WorkflowStep } from './workflow-planner.js';

export class PreviewDocument {
    static build(layer: LayerNode | null, websiteUrl = ''): string {
        return PreviewDocument.buildPlan({
            mode: 'node',
            inputs: [],
            cameraInputId: null,
            website: websiteUrl
                ? {
                      id: 'website-root',
                      type: 'website',
                      name: 'Website',
                      position: { x: 0, y: 0 },
                      url: websiteUrl,
                  }
                : null,
            resetWebsite: true,
            steps: layer ? [{ node: layer, speed: 'live' }] : [],
        });
    }

    static buildPlan(
        plan: WorkflowPlan,
        executionId: number | null = null,
        inputs: Readonly<Record<string, string>> = {},
    ): string {
        const websiteUrl = plan.website?.url.trim() ?? '';
        const pageBackground = websiteUrl ? 'transparent' : '#fff';
        const website = websiteUrl
            ? `<iframe class="director-website" data-director-src="${PreviewDocument.safeAttribute(websiteUrl)}" title="Website" allow="camera; microphone"></iframe>`
            : '';
        const serialized = JSON.stringify(PreviewDocument.runtimeSteps(plan));
        return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: ${pageBackground}; }
.director-website { position: fixed; inset: 0; z-index: 0; display: block; width: 100%; height: 100%; border: 0; background: #fff; }
.director-layer { position: fixed; inset: 0; z-index: 10; width: 100vw; height: 100vh; overflow: hidden; pointer-events: none; }
.director-layer__anchor { position: fixed; display: grid; pointer-events: none; }
.director-layer__anchor[data-horizontal="left"] { justify-items: start; }
.director-layer__anchor[data-horizontal="center"] { justify-items: center; }
.director-layer__anchor[data-horizontal="right"] { justify-items: end; }
.director-layer__anchor[data-vertical="top"] { align-items: start; }
.director-layer__anchor[data-vertical="center"] { align-items: center; }
.director-layer__anchor[data-vertical="bottom"] { align-items: end; }
.director-layer__content { position: relative; max-width: 100vw; max-height: 100vh; }
.preview-error { position: fixed; right: 1rem; bottom: 1rem; left: 1rem; z-index: 999999; max-height: 35%; overflow: auto; margin: 0; padding: .75rem; border: 1px solid #ff6b73; border-radius: .5rem; background: #2b1015; color: #ffd9dc; font: 12px/1.45 ui-monospace, monospace; white-space: pre-wrap; }
</style>
</head>
<body>
${website}
<div id="director-overlays"></div>
<script>
${PreviewDocument.safeScript(`
const steps = ${serialized};
const initialExecutionId = ${JSON.stringify(executionId)};
const inputs = ${JSON.stringify(inputs)};
const cameraInputId = ${JSON.stringify(plan.cameraInputId)};
const overlays = document.querySelector('#director-overlays');
const website = document.querySelector('.director-website');
let activeController = new AbortController();
const results = {};
const referenceRects = new Map();
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

async function execute(step) {
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
    activeController = new AbortController();
}

function cancel() {
    activeController.abort();
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
    for (const step of nextSteps) {
        report(executionId, step.id, 'running');
        try {
            delete results[step.id];
            const result = await execute(step);
            if (result !== undefined) results[step.id] = result;
            report(executionId, step.id, 'success');
        } catch (error) {
            const cancelled = error instanceof DOMException && error.name === 'AbortError';
            report(executionId, step.id, cancelled ? 'cancelled' : 'error', error);
            throw error;
        }
    }
}

const ready = run(steps, initialExecutionId);
window.__director = Object.freeze({ run, execute, begin, cancel, remove, ready });
ready.catch(showError);
`)}
<\/script>
</body>
</html>`;
    }

    static runtimeSteps(plan: WorkflowPlan): RuntimeStep[] {
        return plan.steps.map(PreviewDocument.serializeStep);
    }

    private static serializeStep(step: WorkflowStep): RuntimeStep {
        if (step.node.type === 'browser-action') {
            return {
                id: step.node.id,
                type: step.node.type,
                speed: step.speed,
                source: '',
                selector: step.node.selector,
            };
        }
        if (step.node.type === 'browser-wait') {
            const common = {
                id: step.node.id,
                type: step.node.type,
                speed: step.speed,
                source: '',
                condition: step.node.condition,
                timeoutMs: step.node.timeoutMs,
                omitFromRecording: step.node.omitFromRecording,
            };
            if (step.node.condition === 'element') {
                return { ...common, selector: step.node.selector };
            }
            if (step.node.condition === 'url') return { ...common, value: step.node.value };
            return { ...common, script: step.node.script };
        }
        if (step.node.type === 'javascript') {
            return {
                id: step.node.id,
                type: step.node.type,
                speed: step.speed,
                source: step.node.source,
            };
        }
        return {
            id: step.node.id,
            type: step.node.type,
            speed: step.speed,
            source: step.node.source.javascript,
            html: step.node.source.html,
            css: step.node.source.css,
            placement: step.node.placement,
            playback: step.node.playback,
        };
    }

    private static safeScript(value: string): string {
        return value.replace(/<\/script/giu, '<\\/script');
    }

    private static safeAttribute(value: string): string {
        return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    }
}
