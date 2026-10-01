import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AudioEnvelope } from '../src/ui/client/core/audio-envelope.js';

const envelope = [
    { time: 0, gain: 0 },
    { time: 0.25, gain: 1 },
    { time: 0.75, gain: 1 },
    { time: 1, gain: 0 },
];

test('Audio envelope interpolates linearly between its points', () => {
    assert.equal(AudioEnvelope.gainAt(envelope, 0), 0);
    assert.equal(AudioEnvelope.gainAt(envelope, 0.125), 0.5);
    assert.equal(AudioEnvelope.gainAt(envelope, 0.5), 1);
    assert.equal(AudioEnvelope.gainAt(envelope, 0.875), 0.5);
    assert.equal(AudioEnvelope.gainAt(envelope, 1), 0);
});

test('Audio envelope schedules the master-adjusted gain over the source duration', () => {
    const calls: Array<{ method: string; value?: number; time: number }> = [];
    const parameter = {
        cancelScheduledValues: (time: number) => calls.push({ method: 'cancel', time }),
        setValueAtTime: (value: number, time: number) => {
            calls.push({ method: 'set', value, time });
            return parameter as AudioParam;
        },
        linearRampToValueAtTime: (value: number, time: number) => {
            calls.push({ method: 'ramp', value, time });
            return parameter as AudioParam;
        },
    } as unknown as AudioParam;

    AudioEnvelope.schedule(parameter, envelope, 0.4, 5, 20);

    assert.deepEqual(calls, [
        { method: 'cancel', time: 5 },
        { method: 'set', value: 0, time: 5 },
        { method: 'ramp', value: 0.4, time: 10 },
        { method: 'ramp', value: 0.4, time: 20 },
        { method: 'ramp', value: 0, time: 25 },
    ]);
});
