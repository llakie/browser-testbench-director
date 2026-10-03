import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PreviewAudioPlayback } from '../src/ui/client/core/preview-audio-playback.js';
import type { RuntimeStep } from '../src/ui/client/core/runtime-protocol.js';

test('Preview audio preloads only live audio inputs from the current run and caches them', async () => {
    const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    const originalFetch = globalThis.fetch;
    const fetched: string[] = [];
    let decoded = 0;

    class AudioContextStub {
        decodeAudioData(): Promise<AudioBuffer> {
            decoded += 1;
            return Promise.resolve({ duration: 1 } as AudioBuffer);
        }

        close(): Promise<void> {
            return Promise.resolve();
        }

        resume(): Promise<void> {
            return Promise.resolve();
        }
    }

    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        value: AudioContextStub,
    });
    globalThis.fetch = async (input) => {
        fetched.push(String(input));
        return new Response(new Uint8Array([1]));
    };
    const playback = new PreviewAudioPlayback();
    const audio = (id: string, inputId: string, speed: 'catchup' | 'live'): RuntimeStep => ({
        id,
        type: 'audio',
        source: '',
        speed,
        after: [],
        inputId,
        volume: 1,
        envelope: [
            { time: 0, gain: 1 },
            { time: 1, gain: 1 },
        ],
        waitForEnd: false,
    });
    const inputs = {
        current: 'https://example.test/current.wav',
        catchup: 'https://example.test/catchup.wav',
        unrelated: 'https://example.test/unrelated.wav',
    };

    try {
        await playback.preload(
            [audio('current-audio', 'current', 'live'), audio('old-audio', 'catchup', 'catchup')],
            inputs,
        );
        await playback.preload([audio('current-audio', 'current', 'live')], inputs);
    } finally {
        playback.dispose();
        globalThis.fetch = originalFetch;

        if (originalAudioContext) {
            Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
        } else {
            delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        }
    }

    assert.deepEqual(fetched, ['https://example.test/current.wav']);
    assert.equal(decoded, 1);
});

test('Preview audio loops until the requested node is stopped', async () => {
    const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    const originalFetch = globalThis.fetch;
    let source = { loop: false, stopped: false };

    class AudioContextStub {
        readonly currentTime = 0;
        readonly destination = {};

        decodeAudioData(): Promise<AudioBuffer> {
            return Promise.resolve({ duration: 2 } as AudioBuffer);
        }

        createBufferSource(): AudioBufferSourceNode {
            const playback = {
                loop: false,
                stopped: false,
                connect() {
                    return this;
                },
                addEventListener() {},
                start() {},
                stop() {
                    this.stopped = true;
                },
            };
            source = playback;
            return playback as unknown as AudioBufferSourceNode;
        }

        createGain(): GainNode {
            return {
                gain: {
                    cancelScheduledValues() {},
                    setValueAtTime() {},
                    linearRampToValueAtTime() {},
                },
                connect() {},
            } as unknown as GainNode;
        }

        resume(): Promise<void> {
            return Promise.resolve();
        }

        close(): Promise<void> {
            return Promise.resolve();
        }
    }

    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        value: AudioContextStub,
    });
    globalThis.fetch = async () => new Response(new Uint8Array([1]));
    const playback = new PreviewAudioPlayback();

    try {
        await playback.play(
            {
                id: 'music',
                type: 'audio',
                source: '',
                speed: 'live',
                inputId: 'file',
                volume: 0.2,
                envelope: [
                    { time: 0, gain: 1 },
                    { time: 1, gain: 1 },
                ],
                waitForEnd: false,
                loop: true,
            },
            'https://example.test/music.mp3',
            new AbortController().signal,
        );
        assert.equal(source.loop, true);
        playback.cancel('music');
        assert.equal(source.stopped, true);
    } finally {
        playback.dispose();
        globalThis.fetch = originalFetch;

        if (originalAudioContext) {
            Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
        } else {
            delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        }
    }
});

test('Seeking instant audio keeps the run alive and moves its playback position', async () => {
    const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    const originalFetch = globalThis.fetch;
    const sources: Array<EventTarget & { offset: number; stopped: boolean }> = [];
    let context: AudioContextStub;

    class AudioContextStub {
        currentTime = 0;
        readonly destination = {};

        constructor() {
            context = this;
        }

        decodeAudioData(): Promise<AudioBuffer> {
            return Promise.resolve({ duration: 4 } as AudioBuffer);
        }

        createBufferSource(): AudioBufferSourceNode {
            const source = Object.assign(new EventTarget(), {
                offset: 0,
                stopped: false,
                connect() {
                    return this;
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
            return source as unknown as AudioBufferSourceNode;
        }

        createGain(): GainNode {
            return {
                gain: {
                    cancelScheduledValues() {},
                    setValueAtTime() {},
                    linearRampToValueAtTime() {},
                },
                connect() {
                    return this;
                },
            } as unknown as GainNode;
        }

        resume(): Promise<void> {
            return Promise.resolve();
        }

        close(): Promise<void> {
            return Promise.resolve();
        }
    }

    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        value: AudioContextStub,
    });
    globalThis.fetch = async () => new Response(new Uint8Array([1]));
    const playback = new PreviewAudioPlayback();

    try {
        const playing = playback.play(
            {
                id: 'sound',
                type: 'audio',
                source: '',
                speed: 'live',
                inputId: 'file',
                volume: 1,
                envelope: [{ time: 0, gain: 1 }, { time: 1, gain: 1 }],
                waitForEnd: true,
                loop: false,
            },
            'https://example.test/sound.wav',
            new AbortController().signal,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        context!.currentTime = 0.5;
        assert.equal(playback.position('sound')?.positionMs, 500);
        playback.seek('sound', 2);
        assert.equal(sources[0]?.stopped, true);
        assert.equal(sources[1]?.offset, 2);
        sources[0]?.dispatchEvent(new Event('ended'));
        assert.equal(playback.position('sound')?.positionMs, 2_000);
        context!.currentTime = 0.75;
        assert.equal(playback.position('sound')?.positionMs, 2_250);
        playback.pause('sound');
        assert.equal(playback.position('sound')?.paused, true);
        assert.equal(sources[1]?.stopped, true);
        context!.currentTime = 1.75;
        assert.equal(playback.position('sound')?.positionMs, 2_250);
        playback.seek('sound', 3);
        assert.equal(playback.position('sound')?.positionMs, 3_000);
        playback.resume('sound');
        assert.equal(playback.position('sound')?.paused, false);
        assert.equal(sources[2]?.offset, 3);
        sources[1]?.dispatchEvent(new Event('ended'));
        context!.currentTime = 2;
        assert.equal(playback.position('sound')?.positionMs, 3_250);
        sources[2]?.dispatchEvent(new Event('ended'));
        await playing;
        assert.equal(playback.position('sound'), null);
    } finally {
        playback.dispose();
        globalThis.fetch = originalFetch;

        if (originalAudioContext) {
            Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
        } else {
            delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        }
    }
});

test('Preview audio applies independent linear fades at start, natural end, and requested stop', async () => {
    const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    const originalFetch = globalThis.fetch;
    const gains: Array<Array<[string, number, number]>> = [];
    const sources: Array<EventTarget & { stoppedAt?: number }> = [];
    let context: AudioContextStub;

    class AudioContextStub {
        currentTime = 0;
        readonly destination = {};

        constructor() {
            context = this;
        }

        decodeAudioData(): Promise<AudioBuffer> {
            return Promise.resolve({ duration: 4 } as AudioBuffer);
        }

        createGain(): GainNode {
            const events: Array<[string, number, number]> = [];
            gains.push(events);
            return {
                gain: {
                    cancelScheduledValues(time: number) {
                        events.push(['cancel', 0, time]);
                    },
                    setValueAtTime(value: number, time: number) {
                        events.push(['set', value, time]);
                    },
                    linearRampToValueAtTime(value: number, time: number) {
                        events.push(['ramp', value, time]);
                    },
                },
                connect(target: unknown) {
                    return target;
                },
            } as GainNode;
        }

        createBufferSource(): AudioBufferSourceNode {
            const source = Object.assign(new EventTarget(), {
                connect(target: unknown) {
                    return target;
                },
                start() {},
                stop(time?: number) {
                    source.stoppedAt = time;
                },
                stoppedAt: undefined as number | undefined,
            });
            sources.push(source);
            return source as unknown as AudioBufferSourceNode;
        }

        resume(): Promise<void> {
            return Promise.resolve();
        }

        close(): Promise<void> {
            return Promise.resolve();
        }
    }

    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        value: AudioContextStub,
    });
    globalThis.fetch = async () => new Response(new Uint8Array([1]));
    const playback = new PreviewAudioPlayback();
    const step = {
        id: 'music',
        type: 'audio' as const,
        source: '',
        speed: 'live' as const,
        inputId: 'file',
        volume: 0.5,
        envelope: [
            { time: 0, gain: 1 },
            { time: 1, gain: 1 },
        ],
        waitForEnd: false,
        loop: true,
        fadeInMs: 1000,
        fadeOutMs: 700,
    };

    try {
        await playback.play(step, 'https://example.test/music.wav', new AbortController().signal);
        assert.deepEqual(gains[1], [
            ['set', 0, 0],
            ['ramp', 1, 1],
        ]);

        context!.currentTime = 0.2;
        const stopped = playback.stop('music');
        assert.ok(Math.abs((sources[0]?.stoppedAt ?? 0) - 0.9) < 0.0001);
        assert.deepEqual(gains[1]?.slice(-3).map(([kind, value, time]) => [kind, value, Number(time.toFixed(3))]), [
            ['cancel', 0, 0.2],
            ['set', 0.2, 0.2],
            ['ramp', 0, 0.9],
        ]);
        sources[0]?.dispatchEvent(new Event('ended'));
        await stopped;

        context!.currentTime = 0;
        await playback.play(
            { ...step, id: 'one-pass', loop: false },
            'https://example.test/music.wav',
            new AbortController().signal,
        );
        assert.deepEqual(gains[3]?.slice(-3), [
            ['cancel', 0, 3.3],
            ['set', 1, 3.3],
            ['ramp', 0, 4],
        ]);

        await playback.play(
            { ...step, id: 'short-fades', loop: false, fadeInMs: 3000, fadeOutMs: 3000 },
            'https://example.test/music.wav',
            new AbortController().signal,
        );
        assert.deepEqual(gains[5], [
            ['set', 0, 0],
            ['ramp', 1, 2],
            ['cancel', 0, 2],
            ['set', 1, 2],
            ['ramp', 0, 4],
        ]);

        const waiting = playback.play(
            { ...step, id: 'waiting', waitForEnd: true },
            'https://example.test/music.wav',
            new AbortController().signal,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        const stopping = playback.stop('waiting');
        sources[3]?.dispatchEvent(new Event('ended'));
        await Promise.all([waiting, stopping]);
    } finally {
        playback.dispose();
        globalThis.fetch = originalFetch;

        if (originalAudioContext) {
            Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
        } else {
            delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        }
    }
});
