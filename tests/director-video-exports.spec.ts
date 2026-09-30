import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DirectorVideoExports } from '../src/server/director-video-exports.js';

test('Director-Videoexport behält die nativen Target-Maße bei der Nachbearbeitung bei', () => {
    const arguments_ = DirectorVideoExports.ffmpegArguments(
        '/tmp/raw.mp4',
        '/tmp/export.mp4',
        1080,
        1920,
    );

    assert.deepEqual(arguments_.slice(0, 7), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        '/tmp/raw.mp4',
        '-vf',
    ]);
    assert.match(arguments_[7]!, /scale=1080:1920/u);
    assert.match(arguments_[7]!, /force_divisible_by=2:reset_sar=1/u);
    assert.match(arguments_[7]!, /pad=1080:1920/u);
    assert.match(arguments_[7]!, /color=0x0d110f:eval=frame/u);
    assert.match(arguments_[7]!, /fps=30/u);
    assert.deepEqual(arguments_.slice(-2), ['-an', '/tmp/export.mp4']);
});

test('Director-Videoexport verbindet ausschließlich markierte Aufnahmeintervalle', () => {
    const arguments_ = DirectorVideoExports.ffmpegArguments(
        '/tmp/raw.mp4',
        '/tmp/export.mp4',
        1080,
        1920,
        [
            { startMs: 1_250, endMs: 4_500 },
            { startMs: 7_000, endMs: 9_600 },
        ],
    );
    const filterIndex = arguments_.indexOf('-filter_complex');

    assert.ok(filterIndex >= 0);
    assert.match(arguments_[filterIndex + 1]!, /trim=start=1\.25:end=4\.5/u);
    assert.match(arguments_[filterIndex + 1]!, /trim=start=7:end=9\.6/u);
    assert.match(arguments_[filterIndex + 1]!, /tpad=stop_mode=clone:stop_duration=3\.25/u);
    assert.match(arguments_[filterIndex + 1]!, /trim=duration=2\.6/u);
    assert.match(arguments_[filterIndex + 1]!, /concat=n=2:v=1:a=0/u);
    assert.deepEqual(arguments_.slice(filterIndex + 2, filterIndex + 4), ['-map', '[video]']);
});

test('Director-Videoexport mischt Audio-Assets zeitgenau in die Aufnahme', () => {
    const arguments_ = DirectorVideoExports.ffmpegArguments(
        '/tmp/raw.mp4',
        '/tmp/export.mp4',
        1080,
        1920,
        [],
        [
            {
                asset: `${'a'.repeat(64)}/sound.wav`,
                path: '/tmp/sound.wav',
                startMs: 750,
                endMs: 2_250,
                volume: 0.4,
                envelope: [
                    { time: 0, gain: 1 },
                    { time: 1, gain: 1 },
                ],
                durationMs: 2_000,
            },
        ],
    );
    const filterIndex = arguments_.indexOf('-filter_complex');

    assert.deepEqual(arguments_.slice(4, 8), ['-i', '/tmp/raw.mp4', '-i', '/tmp/sound.wav']);
    assert.match(arguments_[filterIndex + 1]!, /\[1:a\]atrim=start=0:duration=1\.5/u);
    assert.match(arguments_[filterIndex + 1]!, /volume=0\.4,adelay=750:all=1/u);
    assert.match(arguments_[filterIndex + 1]!, /amix=inputs=1:duration=longest/u);
    assert.deepEqual(arguments_.slice(-6), [
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '/tmp/export.mp4',
    ]);
});

test('Director-Videoexport entfernt ausgelassene Wartezeiten auch aus Audio', () => {
    const arguments_ = DirectorVideoExports.ffmpegArguments(
        '/tmp/raw.mp4',
        '/tmp/export.mp4',
        1080,
        1920,
        [
            { startMs: 1_000, endMs: 2_000 },
            { startMs: 4_000, endMs: 5_000 },
        ],
        [
            {
                asset: `${'b'.repeat(64)}/music.mp3`,
                path: '/tmp/music.mp3',
                startMs: 500,
                volume: 1,
                envelope: [
                    { time: 0, gain: 1 },
                    { time: 1, gain: 1 },
                ],
                durationMs: 8_000,
            },
        ],
    );
    const filter = arguments_[arguments_.indexOf('-filter_complex') + 1]!;

    assert.match(filter, /asplit=2/u);
    assert.match(filter, /atrim=start=0\.5:duration=1/u);
    assert.match(filter, /atrim=start=3\.5:duration=1/u);
    assert.match(filter, /adelay=1000:all=1/u);
});

test('Director-Videoexport applies a linear volume envelope to every audio segment', () => {
    const arguments_ = DirectorVideoExports.ffmpegArguments(
        '/tmp/raw.mp4',
        '/tmp/export.mp4',
        1080,
        1920,
        [],
        [
            {
                asset: `${'c'.repeat(64)}/music.mp3`,
                path: '/tmp/music.mp3',
                startMs: 0,
                volume: 0.5,
                envelope: [
                    { time: 0, gain: 0 },
                    { time: 0.25, gain: 1 },
                    { time: 1, gain: 0 },
                ],
                durationMs: 8_000,
            },
        ],
    );
    const filter = arguments_[arguments_.indexOf('-filter_complex') + 1]!;

    assert.match(filter, /volume='0\.5\*\(if\(lt\(t,2\),0\+\(0\.5\)\*\(t-\(0\)\)/u);
    assert.match(filter, /if\(lt\(t,8\),1\+\(-0\.16666666666666666\)\*\(t-\(2\)\),0\)/u);
    assert.match(filter, /:eval=frame/u);
});
