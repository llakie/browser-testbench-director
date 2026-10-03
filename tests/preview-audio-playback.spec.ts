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
