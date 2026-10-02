import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { renderPreviewRuntimeScript } from '../src/ui/client/core/preview-runtime-script.js';

test('Recording preloads and plays native audio exactly like preview, without duration metadata', async () => {
    let decoded = 0;
    let played = 0;
    class AudioContext {
        state = 'running';
        currentTime = 0;
        destination = {};
        async decodeAudioData(): Promise<{ duration: number }> {
            decoded += 1;
            return { duration: 0.01 };
        }
        async resume(): Promise<void> {}
        createGain() {
            return {
                gain: {
                    value: 1,
                    cancelScheduledValues() {},
                    setValueAtTime() {},
                    linearRampToValueAtTime() {},
                },
                connect() {},
            };
        }
        createBufferSource() {
            const source = new EventTarget();
            return Object.assign(source, {
                connect: (gain: unknown) => gain,
                start: () => {
                    played += 1;
                    setTimeout(() => source.dispatchEvent(new Event('ended')), 1);
                },
                stop() {},
            });
        }
    }
    const context: Record<string, unknown> = {
        AudioContext,
        AbortController,
        DOMException,
        performance,
        navigator: {},
        document: {
            querySelector: (selector: string) => (selector === '#director-overlays' ? {} : null),
        },
        postMessage() {},
        fetch: async () => ({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(1),
            json: async () => ({ recordingTimeMs: performance.now() }),
        }),
    };
    context['window'] = context;
    context['parent'] = context;
    runInNewContext(
        renderPreviewRuntimeScript({
            steps: [],
            executionId: null,
            cameraInputId: null,
            globalStylesheetInputIds: [],
            inputs: { sound: 'tone.wav' },
        }),
        context,
    );
    const runtime = context['__director'] as {
        ready: Promise<void>;
        run(steps: unknown[], id: string, options?: unknown): Promise<void>;
    };
    await runtime.ready;
    const steps = [
        {
            id: 'beep',
            type: 'audio',
            speed: 'live',
            inputId: 'sound',
            volume: 0.5,
            envelope: [
                { time: 0, gain: 1 },
                { time: 1, gain: 1 },
            ],
            waitForEnd: true,
        },
    ];
    await runtime.run(steps, 'preview');
    await runtime.run(steps, 'recording', { recording: true, clockUrl: '/clock' });
    assert.equal(decoded, 1, 'The decoded audio buffer is reused.');
    assert.equal(played, 2, 'Recording must play the audio, not replace it with a timer.');
});
