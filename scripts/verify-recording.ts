import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { RemoteTestbench } from 'browser-testbench/client';

import { ProjectFormat } from '../src/ui/client/core/project-format.js';
import { playGraphNode, selectGraphNode } from './support/director-ui.js';

const applicationUrl = process.env['DIRECTOR_UI_URL'] ?? 'http://127.0.0.1:5173/';
const server = process.env['BROWSER_TESTBENCH_URL'] ?? 'http://127.0.0.1:55808';
const controllerTarget = process.env['DIRECTOR_CONTROLLER_TARGET'] ?? 'edge';
const recordingTarget = process.env['DIRECTOR_RECORDING_TARGET'] ?? 'chrome';
const outputDirectory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-recording-'));
const projectPath = join(outputDirectory, 'recording-verification.btd.json');
const audioPath = join(outputDirectory, 'recording-tone.wav');
const cameraImagePath = join(outputDirectory, 'recording-camera.png');
const filename = 'director-recording-verification.mp4';
const testbench = new RemoteTestbench({ server, requestTimeoutMs: 180_000 });

const project = ProjectFormat.create('Recording verification');
project.name = 'Director Recording Verification';
const website = project.nodes.find((node) => node.type === 'website')!;
website.url = new URL('/example-site.html', applicationUrl).toString();
project.nodes.unshift(
    {
        id: 'recording-audio',
        type: 'input',
        name: 'Recording audio',
        position: null,
        accept: 'audio/wav',
        required: true,
    },
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
project.nodes.push({
    id: 'play-recording-audio',
    type: 'audio',
    name: 'Play recording audio',
    position: null,
    volume: 0.5,
    envelope: [
        { time: 0, gain: 1 },
        { time: 1, gain: 1 },
    ],
    waitForEnd: true,
    fadeInMs: 200,
    fadeOutMs: 200,
});
project.nodes.push({
    id: 'video-output',
    type: 'video-output',
    name: 'Recording output',
    position: null,
    targetId: '',
    filename,
});
project.connections.unshift(
    { id: 'recording-audio--play', source: 'recording-audio', target: 'play-recording-audio' },
    { id: 'camera-image--camera-capability', source: 'camera-image', target: 'camera-capability' },
    { id: 'camera-capability--website-root', source: 'camera-capability', target: 'website-root' },
);
project.connections.push({
    id: 'website-root--play-recording-audio',
    source: 'website-root',
    target: 'play-recording-audio',
});
project.connections.push({
    id: 'layer-1--video-output',
    source: 'layer-1',
    target: 'video-output',
});
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
const execFileAsync = promisify(execFile);
await Promise.all([
    writeFile(projectPath, ProjectFormat.stringify(project), 'utf8'),
    writeFile(
        cameraImagePath,
        Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL04wAAAABJRU5ErkJggg==',
            'base64',
        ),
    ),
    execFileAsync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:a',
        'pcm_s16le',
        audioPath,
    ]),
]);

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
    await selectGraphNode(controller, 'recording-audio');
    await controller.waitForElement('[data-testid="project-input-recording-audio"]', 10_000);
    await controller.upload('[data-testid="project-input-recording-audio"]', audioPath);
    await selectGraphNode(controller, 'video-output');
    await controller.waitForElement(
        `[data-testid="video-output-target"] option[value="${recordingTarget}"]`,
        30_000,
    );
    await controller.evaluate(`
        const select = document.querySelector('[data-testid="video-output-target"]');
        select.value = '${recordingTarget}';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    `);
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
                    body: (await response.clone().text()).slice(0, 500),
                    requestBody: String(arguments_[1]?.body ?? '').slice(0, 500),
                });
            }
            return response;
        };
    `);
    const recordingTargetKind = await controller.evaluate<'desktop' | 'mobile'>(`
        const option = [...document.querySelectorAll('[data-testid="video-output-target"] option')]
            .find(candidate => candidate.value === '${recordingTarget}');
        return /desktop/iu.test(option?.textContent ?? '') ? 'desktop' : 'mobile';
    `);
    await playGraphNode(controller, 'video-output');
    let download: Awaited<ReturnType<typeof controller.waitForDownload>>;

    try {
        download = await controller.waitForDownload(filename, 60_000);
    } catch (error) {
        const diagnostic = await controller.evaluate(`return {
            notice: document.querySelector('.notice')?.textContent?.trim() || '',
            requests: window.__directorRecordingRequests ?? [],
            recordButton: document.querySelector('[data-testid="record-video-output"]')?.outerHTML.slice(0, 500),
        };`);
        throw new Error(`Recording did not produce a download: ${JSON.stringify(diagnostic)}`, {
            cause: error,
        });
    }

    await controller.waitForText(filename, 10_000);

    const bytes = await readFile(download.path);
    assert.ok(bytes.byteLength > 1_024, 'Recording must contain MP4 media data.');
    assert.equal(bytes.subarray(4, 8).toString('ascii'), 'ftyp', 'Recording must be an MP4 file.');
    const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name,codec_type,width,height',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        download.path,
    ]);
    const probe = JSON.parse(stdout) as {
        streams?: Array<{
            codec_name?: string;
            codec_type?: string;
            width?: number;
            height?: number;
        }>;
        format?: { duration?: string };
    };
    const stream = probe.streams?.find((candidate) => candidate.codec_type === 'video');
    const audioStream = probe.streams?.find((candidate) => candidate.codec_type === 'audio');
    assert.ok(stream?.width && stream.height, 'Recording must have video dimensions.');
    assert.equal(
        audioStream?.codec_name,
        'aac',
        'Recording must preserve the captured target audio.',
    );

    const sessionRequest = await controller.evaluate<string | null>(`
        return window.__directorRecordingRequests.find(
            request => request.url.endsWith('/browser-testbench-api/sessions')
        )?.requestBody ?? null;
    `);
    assert.equal(
        (JSON.parse(sessionRequest ?? '{}') as { headless?: boolean }).headless,
        false,
        'Desktop recording sessions must open visibly.',
    );

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
