import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { playGraphNode, selectGraphNode } from '../support/director-ui.js';
import { exampleSiteUrl, outputDirectory } from '../support/ui-verification-context.js';
import type { DOMRectSnapshot } from './responsive-layout.js';

export async function verifyProjectRoundtrip(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create('Roundtrip project');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = exampleSiteUrl;
    project.nodes.unshift({
        id: 'roundtrip-input',
        type: 'input',
        name: 'Roundtrip input',
        position: null,
        accept: 'text/plain',
        required: false,
    });
    project.connections.push({
        id: 'roundtrip-input--website-root',
        source: 'roundtrip-input',
        target: 'website-root',
    });
    const fixtureDirectory = join(outputDirectory, 'roundtrip-fixtures');
    await mkdir(fixtureDirectory);
    const projectPath = join(fixtureDirectory, 'roundtrip-source.btd.json');
    const inputPath = join(fixtureDirectory, 'roundtrip-input.txt');
    await Promise.all([
        writeFile(projectPath, ProjectFormat.stringify(project), 'utf8'),
        writeFile(inputPath, 'persistent input', 'utf8'),
    ]);
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await selectGraphNode(session, 'roundtrip-input');
    await session.waitForElement('[data-testid="project-input-roundtrip-input"]', 5_000);
    await session.evaluate(`
        Object.defineProperty(window, 'showSaveFilePicker', {
            configurable: true,
            value: undefined,
        });
    `);
    await session.fill('.project-title input', 'Roundtrip project');
    await session.evaluate(`
        window.__roundtripOriginalFetch = window.fetch;
        window.fetch = async (...args) => {
            const [input, options] = args;
            if (String(input) === '/director-api/assets' && options?.method === 'POST') {
                await new Promise(resolve => setTimeout(resolve, 600));
            }
            return window.__roundtripOriginalFetch(...args);
        };
    `);
    await session.upload('[data-testid="project-input-roundtrip-input"]', inputPath);
    await session.waitForScript(
        `return document.querySelector(
            '[model-id="roundtrip-input"] [joint-selector="fileName"]'
        )?.textContent.includes('roundtrip-input.txt');`,
        [],
        5_000,
    );
    await session.click('[data-testid="save-project"]');
    await session.waitForElement('[data-testid="save-project"] .icon-spinner', 5_000);
    const download = await session.waitForDownload('roundtrip-source.btd.json', 10_000);
    await session.evaluate(`
        window.fetch = window.__roundtripOriginalFetch;
        delete window.__roundtripOriginalFetch;
    `);
    await session.click('[data-testid="new-project"]');
    assert.notEqual(
        (await session.state('.project-title input')).value,
        'Roundtrip project',
        'project: New must replace the current project.',
    );
    await session.upload('[data-testid="project-file-input"]', download.path);
    await session.waitForValue('.project-title input', 'Roundtrip project', 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);
    await session.waitForScript(
        `return document.querySelector(
            '[model-id="roundtrip-input"] [joint-selector="fileName"]'
        )?.textContent.includes('roundtrip-input.txt');`,
        [],
        10_000,
    );
    await session.waitForState('.preview-viewport iframe', 'present', 5_000);
    await playGraphNode(session, 'layer-1');
    await session.switchFrame('.preview-viewport iframe');
    await session.waitForElement(
        '.director-layer__anchor[data-horizontal="center"][data-vertical="center"]',
        5_000,
    );
    await session.switchFrame();
}

export async function verifyLandscapeDock(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create('Landscape');
    project.preview.preset = 'desktop';
    const projectPath = join(outputDirectory, 'landscape.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'Landscape', 10_000);
    const layout = await session.evaluate<{
        preview: DOMRectSnapshot;
        graph: DOMRectSnapshot;
        editor: DOMRectSnapshot;
        ratio: number;
    }>(`
        const rect = (selector) => {
            const value = document.querySelector(selector).getBoundingClientRect();
            return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height };
        };
        const viewport = rect('.preview-viewport');
        return {
            preview: rect('.preview-panel'),
            graph: rect('.graph-panel'),
            editor: rect('.editor-panel'),
            ratio: viewport.width / viewport.height,
        };
    `);
    assert.ok(
        layout.preview.bottom <= layout.graph.top && layout.preview.bottom <= layout.editor.top,
        'landscape: preview must dock above graph and editor.',
    );
    assert.ok(Math.abs(layout.ratio - 16 / 9) < 0.02, 'landscape: viewport ratio must be 16:9.');
    await session.screenshot(join(outputDirectory, 'landscape.png'), true);
}

export async function verifyRecordingExport(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create();
    project.name = 'Recording UI';
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = exampleSiteUrl;
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.playback = { durationMs: 1_200, removeAfter: true };
    layer.source = {
        html: '<div id="recording-ui">Recording</div>',
        css: '#recording-ui { width: 10rem; height: 10rem; background: white; }',
        javascript: `director.root.dataset.recorded = 'true';`,
    };
    const projectPath = join(outputDirectory, 'recording-ui.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForState('[data-testid="record-workflow"]', 'enabled', 10_000);
    await session.evaluate(`
        window.__directorRecordingOriginalFetch = window.fetch;
        window.__directorRecordingRequests = [];
        const video = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
        window.fetch = async (input, init = {}) => {
            const url = String(input);
            window.__directorRecordingRequests.push({ url, body: init.body || null });
            if (url.endsWith('/browser-testbench-api/sessions')) {
                return new Response(JSON.stringify({ id: 'recording-ui-session' }), {
                    status: 201,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.endsWith('/recording/start')) {
                return new Response(JSON.stringify({ id: 'recording-ui-capture' }), {
                    status: 201,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.endsWith('/recording/stop')) {
                return new Response(JSON.stringify({
                    artifactId: 'recording-ui-artifact',
                    size: video.byteLength,
                    sha256: 'd9f1cb99ee21291800d5e62bd9bca07850461d7d8096afc4150a52dc8554d49f',
                    mimeType: 'video/mp4',
                    width: 1080,
                    height: 1920,
                    durationMs: 250,
                }), { headers: { 'Content-Type': 'application/json' } });
            }
            if (url.includes('/recording/artifacts/')) {
                return new Response(video, { headers: { 'Content-Type': 'video/mp4' } });
            }
            if (url.endsWith('/director-api/video-exports')) {
                return new Response(video, { headers: { 'Content-Type': 'video/mp4' } });
            }
            if (url.endsWith('/browser')) {
                await new Promise(resolve => setTimeout(resolve, 1_200));
                return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
            }
            if (url.includes('/browser-testbench-api/sessions/')) {
                return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
            }
            return window.__directorRecordingOriginalFetch(input, init);
        };
    `);
    await session.click('[data-testid="record-workflow"]');
    await session.waitForElement('.recording-target-option:not(:disabled)', 5_000);
    await session.click('.recording-target-option:not(:disabled)');
    await session.waitForElement('[data-testid="recording-status"]', 5_000);
    await session.waitForElement('[data-testid="stop-recording"]', 5_000);
    const recordingIndicator = await session.evaluate<{
        label: string;
        tinted: boolean;
        stopIcon: boolean;
    }>(`
        const header = document.querySelector('.topbar');
        return {
            label: document.querySelector('[data-testid="recording-status"]')?.textContent?.trim() || '',
            tinted: header?.classList.contains('topbar--recording') || false,
            stopIcon: Boolean(document.querySelector('[data-testid="stop-recording"] .bi-stop-fill')),
        };
    `);
    assert.match(recordingIndicator.label, /Aufnahme läuft|Recording/iu);
    assert.equal(recordingIndicator.tinted, true, 'recording: header must show the active state.');
    assert.equal(recordingIndicator.stopIcon, true, 'recording: record control must become stop.');
    await session.screenshot(join(outputDirectory, 'recording-active.png'), true);
    const download = await session.waitForDownload('recording-ui.mp4', 15_000);
    await session.waitForText('recording-ui.mp4', 5_000);
    const recording = await session.evaluate<{ urls: string[] }>(`
        const value = { urls: window.__directorRecordingRequests.map((request) => request.url) };
        window.fetch = window.__directorRecordingOriginalFetch;
        delete window.__directorRecordingOriginalFetch;
        delete window.__directorRecordingRequests;
        return value;
    `);
    const start = recording.urls.findIndex((url) => url.endsWith('/recording/start'));
    const execution = recording.urls.findIndex(
        (url, index) => index > start && url.endsWith('/browser'),
    );
    const stop = recording.urls.findIndex((url) => url.endsWith('/recording/stop'));
    const artifact = recording.urls.findIndex((url) => url.includes('/recording/artifacts/'));
    assert.ok(
        start >= 0 && execution > start && stop > execution && artifact > stop,
        `recording: lifecycle order is invalid (${JSON.stringify(recording.urls)}).`,
    );
    assert.ok(download.path.endsWith('recording-ui.mp4'));
    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}
