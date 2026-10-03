import type { AudioEnvelopePoint } from './project-format.js';

export class AudioEnvelope {
    static gainAt(points: readonly AudioEnvelopePoint[], time: number): number {
        const position = Math.min(1, Math.max(0, time));
        const rightIndex = points.findIndex((point) => point.time >= position);

        if (rightIndex <= 0) {
            return points[0]?.gain ?? 1;
        }

        const right = points[rightIndex]!;
        const left = points[rightIndex - 1]!;
        const progress = (position - left.time) / (right.time - left.time);
        return left.gain + (right.gain - left.gain) * progress;
    }

    static schedule(
        parameter: AudioParam,
        points: readonly AudioEnvelopePoint[],
        volume: number,
        startTime: number,
        duration: number,
    ): void {
        parameter.cancelScheduledValues(startTime);
        parameter.setValueAtTime(volume * (points[0]?.gain ?? 1), startTime);

        for (const point of points.slice(1)) {
            parameter.linearRampToValueAtTime(
                volume * point.gain,
                startTime + point.time * duration,
            );
        }
    }

    static scheduleFrom(
        parameter: AudioParam,
        points: readonly AudioEnvelopePoint[],
        volume: number,
        startTime: number,
        duration: number,
        offset: number,
    ): void {
        parameter.cancelScheduledValues(startTime);
        parameter.setValueAtTime(volume * AudioEnvelope.gainAt(points, offset / duration), startTime);

        for (const point of points) {
            const pointTime = point.time * duration;

            if (pointTime > offset) {
                parameter.linearRampToValueAtTime(
                    volume * point.gain,
                    startTime + pointTime - offset,
                );
            }
        }
    }
}
