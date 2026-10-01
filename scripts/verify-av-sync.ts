import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { RemoteTestbench } from 'browser-testbench/client';

import {
    ProjectFormat,
    type AudioNode,
    type DirectorProject,
    type JavaScriptNode,
    type LayerNode,
} from '../src/ui/client/core/project-format.js';
import { selectGraphNode } from './support/director-ui.js';

const applicationUrl = process.env['DIRECTOR_UI_URL'] ?? 'https://127.0.0.1:5173/';
const server = process.env['BROWSER_TESTBENCH_URL'] ?? 'http://127.0.0.1:55808';
const controllerTarget = process.env['DIRECTOR_CONTROLLER_TARGET'] ?? 'edge';
const targets = (
    process.env['DIRECTOR_AV_SYNC_TARGETS'] ??
    'chrome,chrome-android-pixel8a-37-1,safari-ios-iphone-11-pro-26-5'
)
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean);
const outputDirectory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-av-sync-'));
const audioPath = join(outputDirectory, 'sync-beep.wav');
const execFileAsync = promisify(execFile);
const testbench = new RemoteTestbench({ server, requestTimeoutMs: 8 * 60_000 });

await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1200:duration=0.12',
    '-af',
    'afade=t=in:st=0:d=0.005,afade=t=out:st=0.105:d=0.015',
    '-c:a',
    'pcm_s16le',
    audioPath,
]);

for (const target of targets) {
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
        await controller.waitForElement('.workspace', 15_000);
        const safeTarget = target.replaceAll(/[^a-z0-9-]+/giu, '-').toLowerCase();
        const filename = `av-sync-${safeTarget}.mp4`;
        const projectPath = join(outputDirectory, `av-sync-${safeTarget}.btd.json`);
        await writeFile(
            projectPath,
            ProjectFormat.stringify(createSyncProject(target, filename)),
            'utf8',
        );
        await controller.upload('[data-testid="project-file-input"]', projectPath);
        await selectGraphNode(controller, 'sync-audio');
        await controller.waitForElement('[data-testid="project-input-sync-audio"]', 10_000);
        await controller.upload('[data-testid="project-input-sync-audio"]', audioPath);
        await selectGraphNode(controller, 'video-output');
        await controller.waitForElement(
            `[data-testid="video-output-target"] option[value="${target}"]`,
            30_000,
        );
        await controller.waitForScript(
            `return document.querySelector('[data-testid="record-video-output"]')?.disabled === false;`,
            [],
            30_000,
        );
        await controller.click('[data-testid="record-video-output"]');
        const download = await controller.waitForDownload(filename, 6 * 60_000);
        const result = await analyzeSynchronization(download.path);

        assert.equal(result.comparisons.length, 3, `${target}: expected three flash/beep pairs.`);

        for (const comparison of result.comparisons) {
            assert.ok(
                Math.abs(comparison.differenceMs) <= result.toleranceMs,
                `${target}: A/V offset ${comparison.differenceMs.toFixed(1)} ms exceeds ` +
                    `${result.toleranceMs.toFixed(1)} ms at event ${comparison.event}.`,
            );
        }

        process.stdout.write(
            `${target}: ${result.comparisons
                .map((comparison) => `${comparison.differenceMs.toFixed(1)} ms`)
                .join(', ')} (limit ${result.toleranceMs.toFixed(1)} ms)\n`,
        );
    } finally {
        await controller.close();
    }
}

process.stdout.write(`A/V synchronization verification passed. Artifacts: ${outputDirectory}\n`);

function createSyncProject(targetId: string, filename: string): DirectorProject {
    const project = ProjectFormat.create('A/V synchronization verification');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = new URL('/example-site.html', applicationUrl).toString();
    const nodes: DirectorProject['nodes'] = [
        {
            id: 'sync-audio',
            type: 'input',
            name: 'Synchronization beep',
            position: null,
            accept: 'audio/wav',
            required: true,
        },
        website,
        backgroundLayer(),
        delayNode('initial-delay', 500),
        {
            id: 'video-output',
            type: 'video-output',
            name: 'Synchronization recording',
            position: null,
            targetId,
            filename,
        },
    ];
    const connections: DirectorProject['connections'] = [
        { id: 'website--background', source: website.id, target: 'background' },
        { id: 'website--initial-delay', source: website.id, target: 'initial-delay' },
    ];
    let predecessor = 'initial-delay';

    for (let index = 1; index <= 3; index += 1) {
        const flashId = `flash-${index}`;
        const beepId = `beep-${index}`;
        const mergeId = `event-${index}`;
        const delayId = `delay-${index}`;
        nodes.push(
            flashLayer(flashId),
            audioNode(beepId),
            {
                id: mergeId,
                type: 'merge',
                name: `Synchronization event ${index}`,
                position: null,
                waitFor: 'all',
            },
            delayNode(delayId, 700),
        );
        connections.push(
            { id: `sync-audio--${beepId}`, source: 'sync-audio', target: beepId },
            { id: `${predecessor}--${flashId}`, source: predecessor, target: flashId },
            { id: `${predecessor}--${beepId}`, source: predecessor, target: beepId },
            { id: `${flashId}--${mergeId}`, source: flashId, target: mergeId },
            { id: `${beepId}--${mergeId}`, source: beepId, target: mergeId },
            { id: `${mergeId}--${delayId}`, source: mergeId, target: delayId },
        );
        predecessor = delayId;
    }

    nodes.push({
        id: 'sync-complete',
        type: 'merge',
        name: 'Synchronization complete',
        position: null,
        waitFor: 'all',
    });
    connections.push(
        { id: 'background--complete', source: 'background', target: 'sync-complete' },
        { id: `${predecessor}--complete`, source: predecessor, target: 'sync-complete' },
        { id: 'complete--video-output', source: 'sync-complete', target: 'video-output' },
    );
    project.nodes = nodes;
    project.connections = connections;
    return project;
}

function backgroundLayer(): LayerNode {
    return {
        ...flashLayer('background'),
        name: 'Continuous recording interval',
        playback: { durationMs: 3_500, removeAfter: true },
        source: {
            html: '<div class="sync-background"></div>',
            css: '.sync-background { width: 100vw; height: 100vh; background: black; }',
            javascript: '',
        },
    };
}

function flashLayer(id: string): LayerNode {
    return {
        id,
        type: 'layer',
        name: id,
        position: null,
        placement: {
            reference: { type: 'viewport' },
            horizontal: 'center',
            vertical: 'center',
        },
        playback: { durationMs: 300, removeAfter: true },
        source: {
            html: `<div class="sync-${id}"></div>`,
            css: `.sync-${id} { width: 100vw; height: 100vh; background: white; }`,
            javascript: '',
        },
    };
}

function audioNode(id: string): AudioNode {
    return {
        id,
        type: 'audio',
        name: id,
        position: null,
        volume: 1,
        envelope: [
            { time: 0, gain: 1 },
            { time: 1, gain: 1 },
        ],
        waitForEnd: true,
    };
}

function delayNode(id: string, durationMs: number): JavaScriptNode {
    return {
        id,
        type: 'javascript',
        name: id,
        position: null,
        source: `await director.wait(${durationMs});`,
    };
}

async function analyzeSynchronization(path: string): Promise<{
    comparisons: Array<{ event: number; differenceMs: number }>;
    toleranceMs: number;
}> {
    const [{ stderr: videoLog }, { stdout: audioBytes }, { stdout: probeOutput }] =
        await Promise.all([
            execFileAsync('ffmpeg', [
                '-hide_banner',
                '-loglevel',
                'info',
                '-i',
                path,
                '-vf',
                'scale=1:1,format=gray,showinfo',
                '-an',
                '-f',
                'null',
                '-',
            ]),
            execFileAsync(
                'ffmpeg',
                [
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-i',
                    path,
                    '-vn',
                    '-ac',
                    '1',
                    '-ar',
                    '48000',
                    '-f',
                    'f32le',
                    '-',
                ],
                { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
            ),
            execFileAsync('ffprobe', [
                '-v',
                'error',
                '-select_streams',
                'v:0',
                '-show_entries',
                'stream=avg_frame_rate',
                '-of',
                'json',
                path,
            ]),
        ]);
    const frames = [...videoLog.matchAll(/pts_time:([0-9.]+).*mean:\[([0-9.]+)\]/gu)].map(
        (match) => ({ time: Number(match[1]), brightness: Number(match[2]) }),
    );
    assert.ok(frames.length > 0, 'No video frames were available for A/V analysis.');
    const brightness = frames.map((frame) => frame.brightness);
    const threshold = (Math.min(...brightness) + Math.max(...brightness)) / 2;
    const flashStarts = frames.flatMap((frame, index) => {
        const previous = frames[index - 1];
        return previous && previous.brightness <= threshold && frame.brightness > threshold
            ? [frame.time]
            : [];
    });
    const samples = Array.from({ length: audioBytes.length / 4 }, (_, index) =>
        Math.abs(audioBytes.readFloatLE(index * 4)),
    );
    const peak = samples.reduce((maximum, value) => Math.max(maximum, value), 0);
    assert.ok(peak > 0.00001, 'The recorded target audio is silent.');
    const beepStarts: number[] = [];
    let previousAudible = -Infinity;

    for (const [index, sample] of samples.entries()) {
        if (sample < peak * 0.2) {
            continue;
        }

        const time = index / 48000;

        if (time - previousAudible > 0.25) {
            beepStarts.push(time);
        }

        previousAudible = time;
    }

    assert.equal(flashStarts.length, 3, 'Expected three visible flashes.');
    assert.equal(beepStarts.length, 3, 'Expected three audible beeps.');
    const probe = JSON.parse(probeOutput) as {
        streams?: Array<{ avg_frame_rate?: string }>;
    };
    const [numerator = '30', denominator = '1'] =
        probe.streams?.[0]?.avg_frame_rate?.split('/') ?? [];
    const frameRate = Number(numerator) / Number(denominator);
    const eventCount = Math.min(flashStarts.length, beepStarts.length);
    return {
        comparisons: Array.from({ length: eventCount }, (_, index) => ({
            event: index + 1,
            differenceMs: (beepStarts[index]! - flashStarts[index]!) * 1_000,
        })),
        toleranceMs: (2 * 1_000) / frameRate,
    };
}
