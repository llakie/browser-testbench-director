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
                connect(target: unknown) {
                    return target;
                },
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

test('Race merge fades out its losing audio branch while the winner continues', async () => {
    let source: (EventTarget & { stoppedAt?: number }) | undefined;
    const executionEvents: Array<{ nodeId?: string; status?: string }> = [];

    class AudioContext {
        currentTime = 0;
        readonly destination = {};

        decodeAudioData(): Promise<{ duration: number }> {
            return Promise.resolve({ duration: 4 });
        }

        resume(): Promise<void> {
            return Promise.resolve();
        }

        createGain() {
            return {
                gain: {
                    cancelScheduledValues() {},
                    setValueAtTime() {},
                    linearRampToValueAtTime() {},
                },
                connect(target: unknown) {
                    return target;
                },
            };
        }

        createBufferSource() {
            source = Object.assign(new EventTarget(), {
                connect(target: unknown) {
                    return target;
                },
                start() {},
                stop(time?: number) {
                    source!.stoppedAt = time;
                },
                stoppedAt: undefined as number | undefined,
            });
            return source;
        }
    }

    const context: Record<string, unknown> = {
        AudioContext,
        AbortController,
        DOMException,
        Function,
        performance,
        setTimeout,
        clearTimeout,
        navigator: {},
        document: {
            querySelector: (selector: string) => (selector === '#director-overlays' ? {} : null),
        },
        postMessage(message: { nodeId?: string; status?: string }) {
            executionEvents.push(message);
        },
        fetch: async () => new Response(new Uint8Array([1])),
    };
    context['window'] = context;
    context['parent'] = context;
    (context['document'] as Record<string, unknown>)['defaultView'] = context;
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
        run(steps: unknown[], id: string): Promise<void>;
    };
    await runtime.ready;
    const run = runtime.run(
        [
            {
                id: 'music',
                type: 'audio',
                speed: 'live',
                inputId: 'sound',
                volume: 1,
                envelope: [
                    { time: 0, gain: 1 },
                    { time: 1, gain: 1 },
                ],
                waitForEnd: true,
                loop: true,
                fadeOutMs: 700,
            },
            {
                id: 'quiz-complete',
                type: 'javascript',
                speed: 'live',
                source: 'await director.wait(10);',
            },
            {
                id: 'music-race',
                type: 'merge',
                speed: 'live',
                after: ['music', 'quiz-complete'],
                source: '',
                waitFor: 'any',
            },
            {
                id: 'reveal',
                type: 'javascript',
                speed: 'live',
                after: ['music-race'],
                source: 'window.revealStarted = true;',
            },
        ],
        'fade',
    );

    for (let attempt = 0; attempt < 10 && source?.stoppedAt === undefined; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.equal(source?.stoppedAt, 0.7);
    assert.equal(
        context['revealStarted'],
        true,
        'The winning branch must continue during fade-out.',
    );
    let completed = false;
    void run.then(() => {
        completed = true;
    });
    await Promise.resolve();
    assert.equal(completed, false, 'The run must not end before the fade finishes.');
    source?.dispatchEvent(new Event('ended'));
    await run;
    assert.equal(completed, true);
    assert.equal(
        executionEvents.filter((event) => event.nodeId === 'music').at(-1)?.status,
        'success',
        'A branch intentionally ended by a race merge is a regular completion.',
    );

    await runtime.run(
        [
            {
                id: 'silent-music-catchup',
                type: 'audio',
                speed: 'catchup',
                inputId: 'sound',
                volume: 1,
                envelope: [
                    { time: 0, gain: 1 },
                    { time: 1, gain: 1 },
                ],
                waitForEnd: true,
                loop: true,
            },
            {
                id: 'quiz-catchup',
                type: 'javascript',
                speed: 'catchup',
                source: 'await director.wait(1000);',
            },
            {
                id: 'catchup-race',
                type: 'merge',
                speed: 'catchup',
                after: ['silent-music-catchup', 'quiz-catchup'],
                source: '',
                waitFor: 'any',
            },
            {
                id: 'catchup-reveal',
                type: 'javascript',
                speed: 'live',
                after: ['catchup-race'],
                source: 'window.catchupRevealStarted = true;',
            },
        ],
        'catchup-race',
    );
    assert.equal(
        context['catchupRevealStarted'],
        true,
        'Catch-up must let the completed workflow branch win over skipped looping audio.',
    );
});

test('Remote runtime pauses and resumes instant audio without ending its run', async () => {
    const sources: Array<EventTarget & { offset: number; stopped: boolean }> = [];
    let audioContext: AudioContext;

    class AudioContext {
        currentTime = 0;
        readonly destination = {};

        constructor() {
            audioContext = this;
        }

        decodeAudioData(): Promise<{ duration: number }> {
            return Promise.resolve({ duration: 10 });
        }

        resume(): Promise<void> {
            return Promise.resolve();
        }

        createGain() {
            return {
                gain: {
                    cancelScheduledValues() {},
                    setValueAtTime() {},
                    linearRampToValueAtTime() {},
                },
                connect(target: unknown) {
                    return target;
                },
            };
        }

        createBufferSource() {
            const source = Object.assign(new EventTarget(), {
                offset: 0,
                stopped: false,
                connect(target: unknown) {
                    return target;
                },
                disconnect() {},
                start(_when: number, offset: number) {
                    source.offset = offset;
                },
                stop() {
                    source.stopped = true;
                },
            });
            sources.push(source);
            return source;
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
        fetch: async () => new Response(new Uint8Array([1])),
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
        run(steps: unknown[], id: string): Promise<void>;
        status(id: string): {
            audioPositions: Record<string, { positionMs: number; paused: boolean }>;
        };
        setAudioStartOffset(id: string, seconds: number): void;
        setAudioPaused(id: string, paused: boolean): void;
        seekAudio(id: string, seconds: number): void;
    };
    await runtime.ready;
    const run = runtime.run(
        [
            {
                id: 'beep',
                type: 'audio',
                speed: 'live',
                inputId: 'sound',
                volume: 1,
                envelope: [
                    { time: 0, gain: 1 },
                    { time: 1, gain: 1 },
                ],
                waitForEnd: true,
                startOffsetMs: 1_000,
            },
        ],
        'pause',
    );

    for (let attempt = 0; attempt < 10 && !sources.length; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.equal(sources[0]?.offset, 1);
    audioContext!.currentTime = 0.5;
    runtime.setAudioPaused('beep', true);
    assert.equal(sources[0]?.stopped, true);
    assert.deepEqual(
        { ...runtime.status('pause').audioPositions['beep'] },
        { positionMs: 500, durationMs: 9000, paused: true },
    );
    audioContext!.currentTime = 1.5;
    assert.equal(runtime.status('pause').audioPositions['beep']?.positionMs, 500);
    assert.throws(
        () => runtime.setAudioStartOffset('beep', 10),
        /Audio start offset must be before the file end/u,
    );
    runtime.setAudioStartOffset('beep', 6);
    assert.deepEqual(
        { ...runtime.status('pause').audioPositions['beep'] },
        { positionMs: 0, durationMs: 4000, paused: true },
    );
    runtime.setAudioPaused('beep', false);
    assert.equal(sources[1]?.offset, 6);
    assert.equal(runtime.status('pause').audioPositions['beep']?.paused, false);
    sources[1]?.dispatchEvent(new Event('ended'));
    await run;
});
