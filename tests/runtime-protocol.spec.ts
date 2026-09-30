import assert from 'node:assert/strict';
import { test } from 'node:test';

import { executeRuntimeGraph, type RuntimeStep } from '../src/ui/client/core/runtime-protocol.js';

const step = (
    id: string,
    after: readonly string[],
    type: RuntimeStep['type'] = 'javascript',
    waitFor?: 'all' | 'any',
): RuntimeStep => ({ id, after, type, waitFor, speed: 'live', source: '' });

test('Runtime startet mehrere Ausgänge parallel und wartet am All-Merge auf beide', async () => {
    const events: string[] = [];
    const delays: Record<string, number> = { left: 20, right: 5, after: 0 };
    await executeRuntimeGraph(
        [
            step('root', []),
            step('left', ['root']),
            step('right', ['root']),
            step('merge', ['left', 'right'], 'merge', 'all'),
            step('after', ['merge']),
        ],
        async (entry) => {
            events.push(`${entry.id}:start`);
            await new Promise((resolve) => setTimeout(resolve, delays[entry.id] ?? 0));
            events.push(`${entry.id}:end`);
        },
    );

    assert.ok(events.indexOf('right:start') < events.indexOf('left:end'));
    assert.ok(events.indexOf('after:start') > events.indexOf('left:end'));
    assert.ok(events.indexOf('after:start') > events.indexOf('right:end'));
});

test('Any-Merge gibt den Nachfolger nach dem ersten Zweig frei', async () => {
    const events: string[] = [];
    await executeRuntimeGraph(
        [
            step('root', []),
            step('slow', ['root']),
            step('fast', ['root']),
            step('merge', ['slow', 'fast'], 'merge', 'any'),
            step('after', ['merge']),
        ],
        async (entry, signal) => {
            events.push(`${entry.id}:start`);
            await abortableDelay(entry.id === 'slow' ? 25 : 2, signal);
            events.push(`${entry.id}:end`);
        },
    );

    assert.ok(events.indexOf('after:start') > events.indexOf('fast:end'));
    assert.equal(events.includes('slow:end'), false);
});

test('Any-Merge bricht laufende Arbeit in allen verlierenden Zweigen ab', async () => {
    const events: string[] = [];

    await executeRuntimeGraph(
        [
            step('root', []),
            step('slow-a', ['root']),
            step('slow-a-tail', ['slow-a']),
            step('slow-b', ['root']),
            step('slow-b-tail', ['slow-b']),
            step('fast', ['root']),
            step('merge', ['slow-a-tail', 'slow-b-tail', 'fast'], 'merge', 'any'),
            step('after', ['merge']),
        ],
        async (entry, signal) => {
            events.push(`${entry.id}:start`);
            await abortableDelay(entry.id === 'fast' || entry.id === 'root' ? 1 : 100, signal);
            events.push(`${entry.id}:end`);
        },
    );

    assert.ok(events.includes('after:end'));
    assert.equal(events.includes('slow-a:end'), false);
    assert.equal(events.includes('slow-a-tail:start'), false);
    assert.equal(events.includes('slow-b:end'), false);
    assert.equal(events.includes('slow-b-tail:start'), false);
});

test('Runtime behandelt Audio wie einen regulären ausführbaren Schritt', async () => {
    const executed: string[] = [];

    await executeRuntimeGraph(
        [step('before', []), step('sound', ['before'], 'audio')],
        async (entry) => {
            executed.push(entry.id);
        },
    );

    assert.deepEqual(executed, ['before', 'sound']);
});

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, milliseconds);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timeout);
                reject(new DOMException('Stopped', 'AbortError'));
            },
            { once: true },
        );
    });
}
