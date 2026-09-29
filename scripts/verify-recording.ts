import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { RemoteTestbench } from 'browser-testbench/client';

import { ProjectFormat } from '../src/ui/client/core/project-format.js';
import { selectGraphNode } from './support/director-ui.js';

const applicationUrl = process.env['DIRECTOR_UI_URL'] ?? 'http://127.0.0.1:5173/';
const server = process.env['BROWSER_TESTBENCH_URL'] ?? 'http://127.0.0.1:55808';
const controllerTarget = process.env['DIRECTOR_CONTROLLER_TARGET'] ?? 'edge';
const recordingTarget = process.env['DIRECTOR_RECORDING_TARGET'] ?? 'chrome';
const outputDirectory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-recording-'));
const projectPath = join(outputDirectory, 'recording-verification.btd.json');
const filename = 'director-recording-verification.mp4';
const cameraImagePath = resolve(
    process.env['GTP_CARD_IMAGE'] ??
        'projects/youtube/shorts/binderium/guess-the-price/assets/int/de/20260925_142636.jpg',
);
const testbench = new RemoteTestbench({ server, requestTimeoutMs: 180_000 });

const project = ProjectFormat.create('Recording verification');
project.name = 'Director Recording Verification';
const website = project.nodes.find((node) => node.type === 'website')!;
website.url = new URL('/example-site.html', applicationUrl).toString();
project.nodes.unshift(
    {
        id: 'camera-image',
        type: 'input',
        name: 'Camera image',
        position: null,
        accept: 'image/jpeg,image/png,image/webp',
        required: true,
    },
    {
        id: 'camera-capability',
        type: 'capability',
        name: 'Virtual camera',
        position: null,
        capability: 'camera',
    },
);
project.connections.unshift(
    { id: 'camera-image--camera-capability', source: 'camera-image', target: 'camera-capability' },
    { id: 'camera-capability--website-root', source: 'camera-capability', target: 'website-root' },
);
const layer = project.nodes.find((node) => node.type === 'layer')!;
layer.name = 'Recording marker';
layer.playback = { durationMs: 1_500, removeAfter: true };
layer.source = {
    html: '<strong id="recording-marker">Director recording</strong>',
    css: `#recording-marker {
        display: block;
        padding: 3rem;
        border-radius: 1rem;
        background: #ff6d38;
        color: #090d12;
        font: 700 3rem/1 system-ui, sans-serif;
    }`,
    javascript: `director.root.dataset.recorded = 'true';`,
};
project.browserSession = {
    permissions: [],
    language: 'de',
    locale: 'DE',
};
await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');

const controller = await testbench.open({
    target: controllerTarget,
    url: applicationUrl,
    headless: true,
    capabilities: { acceptInsecureCerts: true },
    downloadDir: outputDirectory,
    lockTimeoutMs: 30_000,
});

try {
    await controller.setViewport(1440, 1000);
    await controller.waitForElement('.workspace', 10_000);
    await controller.upload('[data-testid="project-file-input"]', projectPath);
    await selectGraphNode(controller, 'camera-image');
    await controller.waitForElement('[data-testid="project-input-camera-image"]', 10_000);
    await controller.upload('[data-testid="project-input-camera-image"]', cameraImagePath);
    await controller.waitForState('[data-testid="record-workflow"]', 'enabled', 30_000);
    await controller.evaluate(`
        window.__directorRecordingRequests = [];
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...arguments_) => {
            const response = await originalFetch(...arguments_);
            const url = String(arguments_[0]);
            if (!response.ok || /recording|sessions/u.test(url)) {
                window.__directorRecordingRequests.push({
                    url,
                    status: response.status,
                    body: await response.clone().text(),
                });
            }
            return response;
        };
    `);
    await controller.click('[data-testid="record-workflow"]');
    const targetSelector = `[data-testid="recording-target-${recordingTarget}"]`;
    await controller.waitForElement(targetSelector, 5_000);
    await controller.waitForState(targetSelector, 'enabled', 5_000);
    const recordingTargetKind = await controller.evaluate<'desktop' | 'mobile'>(`
        const target = document.querySelector('${targetSelector}');
        return target?.querySelector('.bi-display') ? 'desktop' : 'mobile';
    `);
    await controller.click(targetSelector);
    let download: Awaited<ReturnType<typeof controller.waitForDownload>>;

    try {
        download = await controller.waitForDownload(filename, 60_000);
    } catch (error) {
        const diagnostic = await controller.evaluate(`return {
            notice: document.querySelector('.notice')?.textContent?.trim() || '',
            requests: window.__directorRecordingRequests ?? [],
        };`);
        throw new Error(`Recording did not produce a download: ${JSON.stringify(diagnostic)}`, {
            cause: error,
        });
    }

    await controller.waitForText(filename, 10_000);

    const bytes = await readFile(download.path);
    assert.ok(bytes.byteLength > 1_024, 'Recording must contain MP4 media data.');
    assert.equal(bytes.subarray(4, 8).toString('ascii'), 'ftyp', 'Recording must be an MP4 file.');
    const { stdout } = await promisify(execFile)('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        download.path,
    ]);
    const probe = JSON.parse(stdout) as {
        streams?: Array<{ codec_name?: string; width?: number; height?: number }>;
        format?: { duration?: string };
    };
    const stream = probe.streams?.[0];
    assert.ok(stream?.width && stream.height, 'Recording must have video dimensions.');

    if (recordingTargetKind === 'desktop') {
        assert.deepEqual(
            { width: stream.width, height: stream.height },
            { width: 1080, height: 1920 },
            'Desktop recording must derive its output from the preview preset DPR.',
        );
    }

    assert.ok(Number(probe.format?.duration) > 0, 'Recording must have a positive duration.');
    process.stdout.write(
        `Recording verification passed (${controllerTarget} → ${recordingTarget}, ${stream.width} × ${stream.height}, ${probe.format?.duration}s).\nMP4: ${download.path}\n`,
    );
} finally {
    await controller.close();
}
