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
    ): string[] {
        const transform = `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0d110f:eval=frame,setsar=1,fps=30`;
        const filters = intervals.flatMap((interval, index) => {
            const start = interval.startMs / 1000;
            const end = interval.endMs / 1000;
            // Both streams retain the same time origin. Never reconstruct or realign audio.
            return [
                `[0:v]fps=30,trim=start=${start}:end=${end},setpts=PTS-${start}/TB[v${index}]`,
                `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-${start}/TB[a${index}]`,
            ];
        });

        if (intervals.length) {
            const streams = intervals.map((_, index) => `[v${index}][a${index}]`).join('');
            filters.push(`${streams}concat=n=${intervals.length}:v=1:a=1[cut][audio]`);
            filters.push(`[cut]${transform}[video]`);
        }

        return [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            inputPath,
            ...(intervals.length
                ? ['-filter_complex', filters.join(';'), '-map', '[video]', '-map', '[audio]']
                : ['-vf', transform, '-map', '0:v:0', '-map', '0:a:0']),
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
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            outputPath,
        ];
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
        if (value === undefined) {
            return [];
        }

        try {
            const parsed = JSON.parse(Array.isArray(value) ? value[0]! : value) as unknown;

            if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 500) {
                return null;
            }

            const intervals = parsed.map((interval) => {
                if (!interval || typeof interval !== 'object') {
                    return null;
                }

                const { startMs, endMs } = interval as Record<string, unknown>;

                if (
                    typeof startMs !== 'number' ||
                    typeof endMs !== 'number' ||
                    !Number.isFinite(startMs) ||
                    !Number.isFinite(endMs) ||
                    startMs < 0 ||
                    endMs <= startMs
                ) {
                    return null;
                }

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
