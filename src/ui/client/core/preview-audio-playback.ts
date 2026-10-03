import type { RuntimeStep } from './runtime-protocol.js';
import { AudioEnvelope } from './audio-envelope.js';
import type { AudioEnvelopePoint } from './project-format.js';

type AudioRuntimeStep = RuntimeStep & {
    readonly type: 'audio';
    readonly volume: number;
    readonly envelope: readonly AudioEnvelopePoint[];
    readonly waitForEnd: boolean;
    readonly loop?: boolean;
};

export class PreviewAudioPlayback {
    readonly #active = new Map<string, () => void>();
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
        const playback = context.createBufferSource();
        const gain = context.createGain();
        AudioEnvelope.schedule(
            gain.gain,
            step.envelope,
            step.volume,
            context.currentTime,
            buffer.duration,
        );
        playback.buffer = buffer;
        playback.loop = step.loop ?? false;
        playback.connect(gain).connect(context.destination);
        this.cancel(step.id);

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const cleanup = (): void => {
                signal.removeEventListener('abort', aborted);

                if (this.#active.get(step.id) === stop) {
                    this.#active.delete(step.id);
                }
            };
            const completed = (): void => {
                cleanup();

                if (step.waitForEnd && !settled) {
                    settled = true;
                    resolve();
                }
            };
            const stop = (): void => {
                cleanup();

                try {
                    playback.stop();
                } catch {
                    // The source may already have ended.
                }

                if (step.waitForEnd && !settled) {
                    settled = true;
                    reject(new DOMException('The execution was stopped.', 'AbortError'));
                }
            };
            const aborted = (): void => stop();
            this.#active.set(step.id, stop);
            playback.addEventListener('ended', completed, { once: true });
            signal.addEventListener('abort', aborted, { once: true });
            playback.start();

            if (!step.waitForEnd) {
                settled = true;
                resolve();
            }
        });
    }

    cancel(nodeId?: string): void {
        if (nodeId) {
            this.#active.get(nodeId)?.();
            return;
        }

        for (const stop of [...this.#active.values()]) {
            stop();
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
