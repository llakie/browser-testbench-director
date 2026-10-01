import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { RemoteTestbench } from 'browser-testbench/client';

import { ProjectFormat, type VideoOutputNode } from '../src/ui/client/core/project-format.js';
import { selectGraphNode } from './support/director-ui.js';

const applicationUrl = process.env['DIRECTOR_UI_URL'] ?? 'https://127.0.0.1:5173/';
const server = process.env['BROWSER_TESTBENCH_URL'] ?? 'http://127.0.0.1:55808';
const controllerTarget = process.env['DIRECTOR_CONTROLLER_TARGET'] ?? 'edge';
const projectPath = resolve(
    process.env['GTP_PROJECT'] ??
        'projects/youtube/shorts/binderium/guess-the-price/guess-the-price-produktion.btd.json',
);
const targets = (
    process.env['GTP_RECORDING_TARGETS'] ??
    'chrome,chrome-android-pixel8a-37-1,safari-ios-iphone-17-pro-26-5'
)
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean);
const outputDirectory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-gtp-'));
const execFileAsync = promisify(execFile);
const source = ProjectFormat.parse(await readFile(projectPath, 'utf8'));
const testbench = new RemoteTestbench({ server, requestTimeoutMs: 8 * 60_000 });
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

    for (const target of targets) {
        const project = ProjectFormat.clone(source);
        const output = project.nodes.find(
            (node): node is VideoOutputNode => node.type === 'video-output',
        );

        assert.ok(output, 'The GTP project must contain a video-output node.');
        const safeTarget = target.replaceAll(/[^a-z0-9-]+/giu, '-').toLowerCase();
        const filename = `guess-the-price-${safeTarget}.mp4`;
        output.targetId = target;
        output.filename = filename;
        const targetProject = join(outputDirectory, `gtp-${safeTarget}.btd.json`);
        await writeFile(targetProject, ProjectFormat.stringify(project), 'utf8');
        await controller.upload('[data-testid="project-file-input"]', targetProject);
        await selectGraphNode(controller, output.id);
        await controller.waitForElement(
            `[data-testid="video-output-target"] option[value="${target}"]`,
            30_000,
        );
        await controller.evaluate(`
            window.__gtpRequests = [];
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (...arguments_) => {
                const response = await originalFetch(...arguments_);
                const url = String(arguments_[0]);
                if (!response.ok || /recording|sessions|execution|video-exports/u.test(url)) {
                    window.__gtpRequests.push({
                        url,
                        status: response.status,
                        body: url.includes('video-exports') ? null : await response.clone().text(),
                        intervals: arguments_[1]?.headers?.['x-director-video-intervals'] ?? null,
                    });
                }
                return response;
            };
        `);
        await controller.waitForScript(
            `return document.querySelector('[data-testid="record-video-output"]')?.disabled === false;`,
            [],
            60_000,
        );
        await controller.click('[data-testid="record-video-output"]');
        let download: Awaited<ReturnType<typeof controller.waitForDownload>>;

        try {
            download = await controller.waitForDownload(filename, 6 * 60_000);
        } catch (error) {
            const diagnostic = await controller.evaluate(`return {
                notice: document.querySelector('.notice')?.textContent?.trim() || '',
                requests: window.__gtpRequests ?? [],
                running: document.querySelector('[data-testid="recording-status"]')?.textContent?.trim() || '',
            };`);
            throw new Error(`GTP recording failed for ${target}: ${JSON.stringify(diagnostic)}`, {
                cause: error,
            });
        }

        const probe = await inspectVideo(download.path);
        const intervals = await controller.evaluate<Array<{ startMs: number; endMs: number }>>(`
            const exported = window.__gtpRequests.find((request) =>
                request.url.includes('/director-api/video-exports')
            );
            return JSON.parse(exported?.intervals ?? '[]');
        `);
        assert.ok(intervals.length > 0, `${target}: no recording segments were retained.`);
        process.stdout.write(
            `${target}: ${intervals.length} retained segments, ` +
                `${intervals.reduce((total, interval) => total + interval.endMs - interval.startMs, 0)} ms\n`,
        );
        const video = probe.streams.find((stream) => stream.codec_type === 'video');
        const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
        assert.ok(video?.width && video.height, `${target}: missing video stream.`);
        assert.equal(audio?.codec_name, 'aac', `${target}: missing captured AAC audio stream.`);
        assert.ok(
            Number(probe.format.duration) >= 10,
            `${target}: recording is unexpectedly short.`,
        );
        await representativeFrames(download.path, safeTarget, Number(probe.format.duration));
        process.stdout.write(
            `${target}: ${video.width} x ${video.height}, ${probe.format.duration}s, ${basename(download.path)}\n`,
        );
    }

    process.stdout.write(`GTP production verification passed. Artifacts: ${outputDirectory}\n`);
} finally {
    await controller.close();
}

async function inspectVideo(path: string): Promise<{
    streams: Array<{
        codec_name?: string;
        codec_type?: string;
        width?: number;
        height?: number;
    }>;
    format: { duration: string };
}> {
    const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name,codec_type,width,height',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        path,
    ]);
    return JSON.parse(stdout) as {
        streams: Array<{
            codec_name?: string;
            codec_type?: string;
            width?: number;
            height?: number;
        }>;
        format: { duration: string };
    };
}

async function representativeFrames(
    path: string,
    target: string,
    durationSeconds: number,
): Promise<void> {
    for (const [name, ratio] of [
        ['early', 0.2],
        ['middle', 0.5],
        ['late', 0.8],
    ] as const) {
        await execFileAsync('ffmpeg', [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-ss',
            (durationSeconds * ratio).toFixed(3),
            '-i',
            path,
            '-frames:v',
            '1',
            join(outputDirectory, `${target}-${name}.png`),
        ]);
    }
}
