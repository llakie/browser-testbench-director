import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

import { VideoUtilities } from '../video/video-utilities.js';

const maximumUploadBytes = 2 * 1024 * 1024 * 1024;

interface VideoInterval {
    readonly startMs: number;
    readonly endMs: number;
}

export class DirectorVideoExports {
    static ffmpegArguments(
        inputPath: string,
        outputPath: string,
        width: number,
        height: number,
        intervals: readonly VideoInterval[] = [],
    ) {
        const transform = `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0d110f,setsar=1,fps=30`;
        const filterArguments = intervals.length
            ? [
                  '-filter_complex',
                  DirectorVideoExports.intervalFilter(intervals, transform),
                  '-map',
                  '[video]',
              ]
            : ['-vf', transform];
        return [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            inputPath,
            ...filterArguments,
            '-c:v',
            'libx264',
            '-preset',
            'medium',
            '-crf',
            '18',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
            '-an',
            outputPath,
        ] as const;
    }

    private static intervalFilter(intervals: readonly VideoInterval[], transform: string): string {
        const trims = intervals.map((interval, index) => {
            const duration = DirectorVideoExports.seconds(interval.endMs - interval.startMs);
            return `[0:v]trim=start=${DirectorVideoExports.seconds(interval.startMs)}:end=${DirectorVideoExports.seconds(interval.endMs)},setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS[interval${index}]`;
        });
        const inputs = intervals.map((_interval, index) => `[interval${index}]`).join('');
        return `${trims.join(';')};${inputs}concat=n=${intervals.length}:v=1:a=0[cut];[cut]${transform}[video]`;
    }

    private static seconds(milliseconds: number): string {
        return (milliseconds / 1_000).toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '');
    }

    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (request.method !== 'POST') {
            this.json(response, 405, { error: 'Method not allowed.' });
            return;
        }
        const width = this.dimension(request.headers['x-director-video-width']);
        const height = this.dimension(request.headers['x-director-video-height']);
        if (!width || !height) {
            this.json(response, 400, { error: 'Valid video width and height are required.' });
            return;
        }
        const intervals = this.intervals(request.headers['x-director-video-intervals']);
        if (intervals === null) {
            this.json(response, 400, { error: 'Video intervals are invalid.' });
            return;
        }

        const directory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-export-'));
        const inputPath = join(directory, 'recording.mp4');
        const outputPath = join(directory, 'export.mp4');
        try {
            let size = 0;
            const limiter = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                    size += chunk.byteLength;
                    if (size > maximumUploadBytes) {
                        callback(new Error('The recording exceeds the 2 GB limit.'));
                        return;
                    }
                    callback(null, chunk);
                },
            });
            await pipeline(request, limiter, createWriteStream(inputPath));
            await VideoUtilities.runFfmpeg(
                DirectorVideoExports.ffmpegArguments(
                    inputPath,
                    outputPath,
                    width,
                    height,
                    intervals,
                ),
            );
            const output = await stat(outputPath);
            response.statusCode = 200;
            response.setHeader('Content-Type', 'video/mp4');
            response.setHeader('Content-Length', String(output.size));
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Disposition', 'attachment; filename="director-export.mp4"');
            await pipeline(createReadStream(outputPath), response);
        } catch (error) {
            if (!response.headersSent) {
                this.json(response, 500, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }

    private dimension(value: string | string[] | undefined): number | null {
        const number = Number(Array.isArray(value) ? value[0] : value);
        return Number.isInteger(number) && number > 0 && number <= 8_192 ? number : null;
    }

    private intervals(value: string | string[] | undefined): VideoInterval[] | null {
        if (value === undefined) return [];
        try {
            const parsed = JSON.parse(Array.isArray(value) ? value[0]! : value) as unknown;
            if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 500) return null;
            const intervals = parsed.map((interval) => {
                if (!interval || typeof interval !== 'object') return null;
                const { startMs, endMs } = interval as Record<string, unknown>;
                if (
                    typeof startMs !== 'number' ||
                    typeof endMs !== 'number' ||
                    !Number.isFinite(startMs) ||
                    !Number.isFinite(endMs) ||
                    startMs < 0 ||
                    endMs <= startMs
                )
                    return null;
                return { startMs, endMs };
            });
            return intervals.every((interval) => interval !== null)
                ? (intervals as VideoInterval[])
                : null;
        } catch {
            return null;
        }
    }

    private json(response: ServerResponse, status: number, payload: unknown): void {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(payload));
    }
}
