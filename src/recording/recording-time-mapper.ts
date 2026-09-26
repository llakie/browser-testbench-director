export interface RecordingMark {
    readonly recordingTimeMs?: number;
}

export interface RecordingTimeMap {
    readonly recordingStartSeconds: number;
    readonly recordingEndSeconds: number;
    readonly drift: number;
    toRecordingSeconds(runtimeMilliseconds: number): number;
}

export class RecordingTimeMapper {
    static fromMarks(
        start: RecordingMark,
        end: RecordingMark,
        runtimeDurationMs: number,
    ): RecordingTimeMap {
        if (!Number.isFinite(runtimeDurationMs) || runtimeDurationMs <= 0) {
            throw new TypeError('Die Timeline-Laufzeit muss positiv sein.');
        }
        if (!Number.isFinite(start?.recordingTimeMs) || !Number.isFinite(end?.recordingTimeMs)) {
            throw new Error(
                'Browser Testbench hat keine Aufnahmezeiten für die Timeline-Marken geliefert.',
            );
        }

        const recordingStartSeconds = start.recordingTimeMs! / 1_000;
        const recordingEndSeconds = end.recordingTimeMs! / 1_000;
        if (recordingEndSeconds <= recordingStartSeconds) {
            throw new Error(
                'Die Timeline-Synchronisationsmarken besitzen keine gültige Reihenfolge.',
            );
        }
        const runtimeSeconds = runtimeDurationMs / 1_000;
        return Object.freeze({
            recordingStartSeconds,
            recordingEndSeconds,
            toRecordingSeconds(runtimeMilliseconds: number) {
                const progress = Math.min(1, Math.max(0, runtimeMilliseconds / runtimeDurationMs));
                return (
                    recordingStartSeconds + progress * (recordingEndSeconds - recordingStartSeconds)
                );
            },
            drift: (recordingEndSeconds - recordingStartSeconds) / runtimeSeconds,
        });
    }
}
