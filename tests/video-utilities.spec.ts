import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VideoUtilities } from '../src/video/video-utilities.js';

test('Video utilities include ffmpeg diagnostics when the process fails', async () => {
    await assert.rejects(
        VideoUtilities.runFfmpeg(
            ['-e', "console.error('diagnostic details'); process.exit(7);"],
            process.execPath,
        ),
        /Status 7[\s\S]*diagnostic details/u,
    );
});
