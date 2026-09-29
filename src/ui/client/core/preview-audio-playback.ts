import type { RuntimeStep } from './runtime-protocol.js';

type AudioRuntimeStep = RuntimeStep & {
    readonly type: 'audio';
    readonly volume: number;
    readonly waitForEnd: boolean;
};

export class PreviewAudioPlayback {
    readonly #active = new Map<string, AudioBufferSourceNode>();
    #context: AudioContext | null = null;

    unlock(): void {
        void this.context().resume();
    }

    async play(step: AudioRuntimeStep, source: string, signal: AbortSignal): Promise<void> {
        if (step.speed === 'catchup') {
            return;
        }

        const context = this.context();
        const response = await fetch(source);

        if (!response.ok) {
            throw new Error(`Audio input could not be loaded: ${step.inputId ?? step.id}`);
        }

        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        const playback = context.createBufferSource();
        const gain = context.createGain();
        gain.gain.value = step.volume;
        playback.buffer = buffer;
        playback.connect(gain).connect(context.destination);
        this.#active.get(step.id)?.stop();
        this.#active.set(step.id, playback);
        playback.start();

        if (!step.waitForEnd) {
            const completed = (): void => {
                this.#active.delete(step.id);
                signal.removeEventListener('abort', aborted);
            };
            const aborted = (): void => {
                playback.stop();
                completed();
            };
            playback.addEventListener('ended', completed, { once: true });
            signal.addEventListener('abort', aborted, { once: true });
            return;
        }

        await new Promise<void>((resolve, reject) => {
            const completed = (): void => {
                signal.removeEventListener('abort', aborted);
                resolve();
            };
            const timeout = window.setTimeout(completed, buffer.duration * 1_000);
            const aborted = (): void => {
                window.clearTimeout(timeout);
                playback.stop();
                reject(new DOMException('The execution was stopped.', 'AbortError'));
            };
            signal.addEventListener('abort', aborted, { once: true });
        });
        this.#active.delete(step.id);
    }

    cancel(): void {
        for (const playback of this.#active.values()) {
            playback.stop();
        }

        this.#active.clear();
    }

    dispose(): void {
        this.cancel();
        void this.#context?.close();
        this.#context = null;
    }

    private context(): AudioContext {
        this.#context ??= new AudioContext();
        return this.#context;
    }
}
