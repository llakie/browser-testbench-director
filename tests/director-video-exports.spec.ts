import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DirectorVideoExports } from '../src/server/director-video-exports.js';

test('Export preserves OBS audio and the entire viewport without a capture border', () => {
    const args = DirectorVideoExports.ffmpegArguments(
        '/tmp/raw.mp4',
        '/tmp/export.mp4',
        1080,
        1920,
    );
    const filter = args[args.indexOf('-vf') + 1]!;
    assert.match(filter, /scale=1080:1920/u);
    assert.match(filter, /force_divisible_by=2:reset_sar=1/u);
    assert.match(filter, /fps=30/u);
    assert.doesNotMatch(filter, /crop/u);
    assert.ok(args.includes('0:a:0'));
    assert.ok(!args.includes('-an'));
    assert.equal(args.filter((argument) => argument === '-i').length, 1);
});

test('Export cuts native video and audio together with the same timestamps', () => {
    const args = DirectorVideoExports.ffmpegArguments(
        '/tmp/raw.mp4',
        '/tmp/export.mp4',
        1080,
        1920,
        [
            { startMs: 1250, endMs: 4500 },
            { startMs: 7000, endMs: 9600 },
        ],
    );
    const filter = args[args.indexOf('-filter_complex') + 1]!;

    for (const range of ['start=1.25:end=4.5', 'start=7:end=9.6']) {
        assert.ok(filter.includes(`trim=${range}`));
        assert.ok(filter.includes(`atrim=${range}`));
    }

    assert.match(filter, /setpts=PTS-1.25\/TB/u);
    assert.match(filter, /asetpts=PTS-1.25\/TB/u);
    assert.match(filter, /concat=n=2:v=1:a=1/u);
    assert.doesNotMatch(filter, /amix|adelay|volume|tpad/u);
    assert.ok(args.includes('[audio]'));
});
