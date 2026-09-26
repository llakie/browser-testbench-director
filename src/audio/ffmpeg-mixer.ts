import type { AudioClipConfiguration } from '../core/types.js';
import { VideoUtilities } from '../video/video-utilities.js';

export interface AudioMixClip extends AudioClipConfiguration {
    readonly startMs: number;
    readonly timelineId?: string;
}

export interface FfmpegAudioMixerOptions {
    readonly videoPath: string;
    readonly outputPath: string;
    readonly clips: readonly AudioMixClip[];
    readonly ffmpegPath?: string;
}

export interface FfmpegInvocation {
    readonly command: string;
    readonly arguments: readonly string[];
}

export class FfmpegAudioMixer {
    static arguments({
        videoPath,
        outputPath,
        clips,
        ffmpegPath = 'ffmpeg',
    }: FfmpegAudioMixerOptions): FfmpegInvocation {
        if (!videoPath || !outputPath)
            throw new TypeError('Audio-Mix benötigt Ein- und Ausgabepfad.');
        if (!Array.isArray(clips))
            throw new TypeError('Audio-Clips müssen als Liste angegeben werden.');

        const inputs = clips.flatMap((entry) => ['-i', entry.src]);
        const filters = clips.map((entry, index) => audioFilter(entry, index + 1));
        const labels = clips.map((_, index) => `[audio-${index}]`).join('');
        const mix =
            clips.length === 0
                ? 'anullsrc=channel_layout=stereo:sample_rate=48000[audio]'
                : clips.length === 1
                  ? '[audio-0]apad[audio]'
                  : `${labels}amix=inputs=${clips.length}:duration=longest:normalize=0[mixed];[mixed]apad[audio]`;

        return {
            command: ffmpegPath,
            arguments: [
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-i',
                videoPath,
                ...inputs,
                '-filter_complex',
                [...filters, mix].join(';'),
                '-map',
                '0:v:0',
                '-map',
                '[audio]',
                '-c:v',
                'copy',
                '-c:a',
                'aac',
                '-b:a',
                '192k',
                '-shortest',
                '-movflags',
                '+faststart',
                outputPath,
            ],
        };
    }

    static async mix(options: FfmpegAudioMixerOptions): Promise<string> {
        const invocation = FfmpegAudioMixer.arguments(options);
        await VideoUtilities.runFfmpeg(invocation.arguments, invocation.command);
        return options.outputPath;
    }
}

function audioFilter(entry: AudioMixClip, inputIndex: number): string {
    if (!Number.isFinite(entry.startMs) || entry.startMs < 0) {
        throw new TypeError(`Audio-Clip "${entry.id}" besitzt keine gültige Startzeit.`);
    }
    const filters = [];
    const trimStart = entry.trim?.from ?? 0;
    const trimDuration = entry.trim?.duration ?? entry.duration;
    filters.push(
        `atrim=start=${millisecondsToSeconds(trimStart)}:duration=${millisecondsToSeconds(trimDuration)}`,
        'asetpts=PTS-STARTPTS',
    );
    if (entry.gainDb !== undefined) filters.push(`volume=${entry.gainDb}dB`);
    if (entry.fadeIn) {
        filters.push(`afade=t=in:st=0:d=${millisecondsToSeconds(entry.fadeIn)}`);
    }
    if (entry.fadeOut) {
        const fadeStart = Math.max(0, trimDuration - entry.fadeOut);
        filters.push(
            `afade=t=out:st=${millisecondsToSeconds(fadeStart)}:d=${millisecondsToSeconds(entry.fadeOut)}`,
        );
    }
    const delay = Math.round(entry.startMs);
    filters.push(`adelay=${delay}:all=1[audio-${inputIndex - 1}]`);
    return `[${inputIndex}:a]${filters.join(',')}`;
}

function millisecondsToSeconds(value: number): string {
    if (!Number.isFinite(value) || value < 0)
        throw new TypeError('Audiozeiten müssen endlich und positiv sein.');
    return (value / 1_000).toFixed(3);
}
