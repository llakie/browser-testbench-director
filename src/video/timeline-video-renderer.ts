import { stat, unlink } from 'node:fs/promises';

import { FfmpegAudioMixer } from '../audio/ffmpeg-mixer.js';
import type { RenderedAudioClip } from '../core/types.js';
import { VideoUtilities } from './video-utilities.js';

export interface RecordingInterval {
    readonly start: number;
    readonly end: number;
}

export interface TimelineVideoRenderOptions {
    readonly rawVideoPath: string;
    readonly outputPath: string;
    readonly recordingIntervals: readonly RecordingInterval[];
    readonly audioClips?: readonly RenderedAudioClip[];
    readonly ffmpegPath?: string;
    readonly outputWidth?: number;
    readonly outputHeight?: number;
    readonly framesPerSecond?: number;
    readonly backgroundColor?: string;
    readonly minimumOutputBytes?: number;
}

export interface TimelineVideoInvocation {
    readonly arguments: readonly string[];
    readonly temporaryVideoPath: string;
}

const DEFAULT_OUTPUT_WIDTH = 1080;
const DEFAULT_OUTPUT_HEIGHT = 1920;
const DEFAULT_FRAMES_PER_SECOND = 30;
const DEFAULT_BACKGROUND_COLOR = '0x0d110f';
const DEFAULT_MINIMUM_OUTPUT_BYTES = 100_000;

export class TimelineVideoRenderer {
    static arguments(options: TimelineVideoRenderOptions): TimelineVideoInvocation {
        validateOptions(options);
        const intervals = normalizeIntervals(options.recordingIntervals);
        const framesPerSecond = options.framesPerSecond ?? DEFAULT_FRAMES_PER_SECOND;
        const segments = intervals.map(
            ({ start, end }, index) =>
                `[0:v]fps=${framesPerSecond},trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,` +
                `setsar=1[segment-${index}]`,
        );
        const segmentInputs = intervals.map((_, index) => `[segment-${index}]`).join('');
        const join =
            intervals.length === 1
                ? '[segment-0]null[joined]'
                : `${segmentInputs}concat=n=${intervals.length}:v=1:a=0[joined]`;
        const outputWidth = options.outputWidth ?? DEFAULT_OUTPUT_WIDTH;
        const outputHeight = options.outputHeight ?? DEFAULT_OUTPUT_HEIGHT;
        const finish = [
            `[joined]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease:flags=lanczos`,
            `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=${options.backgroundColor ?? DEFAULT_BACKGROUND_COLOR}`,
            'setsar=1[video]',
        ].join(',');
        const temporaryVideoPath = `${options.outputPath}.video-only.mp4`;
        return Object.freeze({
            temporaryVideoPath,
            arguments: [
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-i',
                options.rawVideoPath,
                '-filter_complex',
                [...segments, join, finish].join(';'),
                '-map',
                '[video]',
                '-r',
                String(framesPerSecond),
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
                temporaryVideoPath,
            ],
        });
    }

    static async render(options: TimelineVideoRenderOptions): Promise<string> {
        const invocation = TimelineVideoRenderer.arguments(options);
        await VideoUtilities.runFfmpeg(invocation.arguments, options.ffmpegPath);
        try {
            await FfmpegAudioMixer.mix({
                videoPath: invocation.temporaryVideoPath,
                outputPath: options.outputPath,
                clips: options.audioClips ?? [],
                ffmpegPath: options.ffmpegPath,
            });
        } finally {
            await unlink(invocation.temporaryVideoPath).catch(() => undefined);
        }
        const output = await stat(options.outputPath);
        if (output.size < (options.minimumOutputBytes ?? DEFAULT_MINIMUM_OUTPUT_BYTES)) {
            throw new Error('Der Videoexport enthält keine verwertbaren Bilddaten.');
        }
        return options.outputPath;
    }
}

function validateOptions(options: TimelineVideoRenderOptions): void {
    if (!options?.rawVideoPath || !options.outputPath) {
        throw new TypeError('Video-Rendering benötigt Ein- und Ausgabepfad.');
    }
    if (!Array.isArray(options.recordingIntervals) || options.recordingIntervals.length === 0) {
        throw new TypeError('Die Timeline enthält keine sichtbare Medienzeit.');
    }
}

function normalizeIntervals(intervals: readonly RecordingInterval[]): RecordingInterval[] {
    const normalized = intervals
        .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
        .map(({ start, end }) => ({ start: Math.max(0, start), end }));
    if (normalized.length === 0) {
        throw new Error('Die Timeline enthält keine gültigen Schnittintervalle.');
    }
    return normalized;
}
