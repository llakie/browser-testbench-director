import { MERGE_RACE_ABORT_REASON, type RuntimeStep } from './runtime-protocol.js';
import { AudioEnvelope } from './audio-envelope.js';
import type { AudioEnvelopePoint } from './project-format.js';

type AudioRuntimeStep = RuntimeStep & {
    readonly type: 'audio';
    readonly volume: number;
    readonly envelope: readonly AudioEnvelopePoint[];
    readonly waitForEnd: boolean;
    readonly loop?: boolean;
    readonly startOffsetMs?: number;
    readonly fadeInMs?: number;
    readonly fadeOutMs?: number;
};

interface ActiveAudio {
    readonly cancel: () => void;
    readonly stop: () => Promise<void>;
    readonly position: () => AudioPlaybackPosition;
    readonly seek: (seconds: number) => void;
    readonly setStartOffset: (seconds: number) => void;
    readonly pause: () => void;
    readonly resume: () => void;
}

export interface AudioPlaybackPosition {
    readonly positionMs: number;
    readonly durationMs: number;
    readonly paused: boolean;
}

export class PreviewAudioPlayback {
    readonly #active = new Map<string, ActiveAudio>();
    readonly #buffers = new Map<string, Promise<AudioBuffer>>();
    #context: AudioContext | null = null;

    unlock(): void {
        void this.context().resume();
    }

    async preload(
        steps: readonly RuntimeStep[],
        inputs: Readonly<Record<string, string>>,
    ): Promise<void> {
        await Promise.all(
            steps.flatMap((step) => {
                if (step.type !== 'audio' || step.speed === 'catchup' || !step.inputId) {
                    return [];
                }

                const source = inputs[step.inputId];

                if (!source) {
                    return [];
                }

                return [this.buffer(source, step.inputId)];
            }),
        );
    }

    async play(step: AudioRuntimeStep, source: string, signal: AbortSignal): Promise<void> {
        if (step.speed === 'catchup') {
            return;
        }

        this.throwIfAborted(signal);

        const context = this.context();
        const buffer = await this.buffer(source, step.inputId ?? step.id);
        this.throwIfAborted(signal);
        const requestedStartOffset = (step.startOffsetMs ?? 0) / 1000;

        if (requestedStartOffset >= buffer.duration) {
            throw new Error(`Audio start offset must be before the file end: ${step.id}`);
        }

        const requestedFadeIn = (step.fadeInMs ?? 0) / 1000;
        const fadeOutSeconds = (step.fadeOutMs ?? 0) / 1000;
        let clipOffset = 0;
        let clipDuration = buffer.duration;
        let fadeInSeconds = requestedFadeIn;
        let naturalFadeOutSeconds = fadeOutSeconds;
        let naturalFadeStart: number | null = null;
        const updateClip = (seconds: number): void => {
            clipOffset = Math.min(buffer.duration, Math.max(0, seconds));
            clipDuration = buffer.duration - clipOffset;
            const fileFadeScale =
                !step.loop && requestedFadeIn + fadeOutSeconds > clipDuration
                    ? clipDuration / (requestedFadeIn + fadeOutSeconds)
                    : 1;
            fadeInSeconds = requestedFadeIn * fileFadeScale;
            naturalFadeOutSeconds = fadeOutSeconds * fileFadeScale;
            naturalFadeStart =
                step.loop || naturalFadeOutSeconds === 0
                    ? null
                    : clipDuration - naturalFadeOutSeconds;
        };
        updateClip(requestedStartOffset);
        this.cancel(step.id);

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            let stopRequested = false;
            let playback: AudioBufferSourceNode | null = null;
            let fade: GainNode;
            let startedAt = context.currentTime;
            let startPosition = 0;
            let pausedAt = 0;
            let paused = false;
            let resolveStopped: () => void = () => {};
            const stopped = new Promise<void>((complete) => {
                resolveStopped = complete;
            });
            const cleanup = (): void => {
                signal.removeEventListener('abort', aborted);

                if (this.#active.get(step.id)?.cancel === cancel) {
                    this.#active.delete(step.id);
                }

                resolveStopped();
            };
            const completed = (): void => {
                cleanup();

                if (step.waitForEnd && !settled) {
                    settled = true;
                    resolve();
                }
            };
            const cancel = (): void => {
                cleanup();

                try {
                    playback?.stop();
                } catch {
                    // The source may already have ended.
                }

                if (step.waitForEnd && !settled) {
                    settled = true;
                    reject(new DOMException('The execution was stopped.', 'AbortError'));
                }
            };
            const currentSeconds = (): number =>
                paused
                    ? pausedAt
                    : Math.min(
                          clipDuration,
                          step.loop
                              ? (context.currentTime - startedAt + startPosition) % clipDuration
                              : context.currentTime - startedAt + startPosition,
                      );
            const stop = (): Promise<void> => {
                if (stopRequested) {
                    return stopped;
                }

                stopRequested = true;

                if (paused || !playback) {
                    completed();
                    return stopped;
                }

                const now = context.currentTime;
                const elapsed = currentSeconds();
                const fadeInLevel = fadeInSeconds > 0 ? Math.min(1, elapsed / fadeInSeconds) : 1;
                const level =
                    naturalFadeStart !== null && elapsed > naturalFadeStart
                        ? Math.max(0, (clipDuration - elapsed) / naturalFadeOutSeconds)
                        : fadeInLevel;
                fade.gain.cancelScheduledValues(now);
                fade.gain.setValueAtTime(level, now);

                if (fadeOutSeconds > 0) {
                    fade.gain.linearRampToValueAtTime(0, now + fadeOutSeconds);
                }

                try {
                    playback.stop(now + fadeOutSeconds);
                } catch {
                    completed();
                }

                return stopped;
            };
            const position = (): AudioPlaybackPosition => ({
                positionMs: currentSeconds() * 1000,
                durationMs: clipDuration * 1000,
                paused,
            });
            const startAt = (position: number): void => {
                const previous = playback;
                const now = context.currentTime;
                const sourceOffset = clipOffset + position;
                const gain = context.createGain();
                const nextFade = context.createGain();
                const next = context.createBufferSource();
                startedAt = now;
                startPosition = position;
                paused = false;
                fade = nextFade;
                playback = next;
                next.buffer = buffer;
                next.loop = step.loop ?? false;
                next.loopStart = clipOffset;
                next.loopEnd = buffer.duration;
                next.connect(gain).connect(nextFade).connect(context.destination);

                if (position === 0) {
                    AudioEnvelope.schedule(
                        gain.gain,
                        step.envelope,
                        step.volume,
                        now,
                        clipDuration,
                    );
                } else {
                    AudioEnvelope.scheduleFrom(
                        gain.gain,
                        step.envelope,
                        step.volume,
                        now,
                        clipDuration,
                        position,
                    );
                }

                const fadeInLevel = fadeInSeconds > 0 ? Math.min(1, position / fadeInSeconds) : 1;
                const fadeLevel =
                    naturalFadeStart !== null && position > naturalFadeStart
                        ? Math.max(0, (clipDuration - position) / naturalFadeOutSeconds)
                        : fadeInLevel;
                nextFade.gain.setValueAtTime(fadeLevel, now);

                if (position < fadeInSeconds) {
                    nextFade.gain.linearRampToValueAtTime(1, now + fadeInSeconds - position);
                }

                if (naturalFadeStart !== null) {
                    const remaining = naturalFadeStart - position;

                    if (remaining > 0) {
                        nextFade.gain.cancelScheduledValues(now + remaining);
                        nextFade.gain.setValueAtTime(1, now + remaining);
                    }

                    nextFade.gain.linearRampToValueAtTime(0, now + clipDuration - position);
                }

                next.addEventListener(
                    'ended',
                    () => {
                        if (playback === next) {
                            completed();
                        }
                    },
                    { once: true },
                );
                next.start(0, sourceOffset);

                if (previous) {
                    previous.stop();
                    previous.disconnect();
                }
            };
            const seek = (seconds: number): void => {
                if (!stopRequested && Number.isFinite(seconds) && !step.loop) {
                    const position = Math.min(clipDuration, Math.max(0, seconds));

                    if (paused) {
                        pausedAt = position;
                    } else {
                        startAt(position);
                    }
                }
            };
            const setStartOffset = (seconds: number): void => {
                if (!paused || stopRequested || !Number.isFinite(seconds)) {
                    return;
                }

                if (seconds >= buffer.duration) {
                    throw new Error(`Audio start offset must be before the file end: ${step.id}`);
                }

                updateClip(seconds);
                pausedAt = 0;
            };
            const pause = (): void => {
                if (paused || stopRequested || !playback) {
                    return;
                }

                pausedAt = currentSeconds();
                paused = true;
                const current = playback;
                playback = null;
                current.stop();
                current.disconnect();
            };
            const resume = (): void => {
                if (paused && !stopRequested) {
                    startAt(pausedAt);
                }
            };
            const aborted = (): void => {
                if (signal.reason === MERGE_RACE_ABORT_REASON) {
                    void stop();
                    return;
                }

                cancel();
            };
            this.#active.set(step.id, {
                cancel,
                stop,
                position,
                seek,
                setStartOffset,
                pause,
                resume,
            });
            signal.addEventListener('abort', aborted, { once: true });
            startAt(0);

            if (!step.waitForEnd) {
                settled = true;
                resolve();
            }
        });
    }

    stop(nodeId: string): Promise<void> {
        return this.#active.get(nodeId)?.stop() ?? Promise.resolve();
    }

    position(nodeId: string): AudioPlaybackPosition | null {
        return this.#active.get(nodeId)?.position() ?? null;
    }

    seek(nodeId: string, seconds: number): void {
        this.#active.get(nodeId)?.seek(seconds);
    }

    setStartOffset(nodeId: string, seconds: number): void {
        this.#active.get(nodeId)?.setStartOffset(seconds);
    }

    pause(nodeId: string): void {
        this.#active.get(nodeId)?.pause();
    }

    resume(nodeId: string): void {
        this.#active.get(nodeId)?.resume();
    }

    async duration(source: string, inputId: string): Promise<number> {
        return (await this.buffer(source, inputId)).duration * 1000;
    }

    cancel(nodeId?: string): void {
        if (nodeId) {
            this.#active.get(nodeId)?.cancel();
            return;
        }

        for (const audio of [...this.#active.values()]) {
            audio.cancel();
        }
    }

    dispose(): void {
        this.cancel();
        void this.#context?.close();
        this.#buffers.clear();
        this.#context = null;
    }

    private buffer(source: string, inputId: string): Promise<AudioBuffer> {
        const cached = this.#buffers.get(source);

        if (cached) {
            return cached;
        }

        const loading = fetch(source)
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Audio input could not be loaded: ${inputId}`);
                }

                return this.context().decodeAudioData(await response.arrayBuffer());
            })
            .catch((error: unknown) => {
                this.#buffers.delete(source);
                throw error;
            });
        this.#buffers.set(source, loading);
        return loading;
    }

    private context(): AudioContext {
        this.#context ??= new AudioContext();
        return this.#context;
    }

    private throwIfAborted(signal: AbortSignal): void {
        if (signal.aborted) {
            throw new DOMException('The execution was stopped.', 'AbortError');
        }
    }
}
