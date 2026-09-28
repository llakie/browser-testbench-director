import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DirectorVideoExports } from '../src/server/director-video-exports.js';

test('Director-Videoexport normalisiert Aufnahme auf die Projektmaße', () => {
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
    assert.match(arguments_[7]!, /pad=1080:1920/u);
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
