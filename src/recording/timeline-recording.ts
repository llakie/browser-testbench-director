import type { RecordingResult, RemoteSession } from 'browser-testbench/client';

import type { TimelineResult } from '../core/types.js';
import { RecordingTimeMapper, type RecordingTimeMap } from './recording-time-mapper.js';

const START_MARK = 'video-timeline.start';
const END_MARK = 'video-timeline.end';

export interface TimelineRecordingOptions {
    readonly session: RemoteSession;
    readonly outputPath: string;
    readonly run: () => Promise<TimelineResult>;
}

export interface TimelineRecordingResult {
    readonly timeline: TimelineResult;
    readonly recording: RecordingResult;
    readonly timeMap: RecordingTimeMap;
}

export class TimelineRecording {
    static async capture(options: TimelineRecordingOptions): Promise<TimelineRecordingResult> {
        if (!options?.session || !options.outputPath || !options.run) {
            throw new TypeError('Timeline-Aufnahme benötigt Session, Ausgabepfad und Ablauf.');
        }

        await options.session.recording.start({
            outputPath: options.outputPath,
            scope: 'viewport',
        });
        try {
            const start = await options.session.mark(START_MARK);
            const timeline = await options.run();
            const end = await options.session.mark(END_MARK);
            const recording = await options.session.recording.stop();
            if (recording.actualScope !== 'viewport') {
                throw new Error('Browser Testbench hat keine reine Viewport-Aufnahme geliefert.');
            }
            return {
                timeline,
                recording,
                timeMap: RecordingTimeMapper.fromMarks(start, end, timeline.runtimeDurationMs),
            };
        } catch (error) {
            await options.session.recording.stop().catch(() => undefined);
            throw error;
        }
    }
}
