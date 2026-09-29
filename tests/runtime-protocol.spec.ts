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
        async (entry) => {
            events.push(`${entry.id}:start`);
            await new Promise((resolve) => setTimeout(resolve, entry.id === 'slow' ? 25 : 2));
            events.push(`${entry.id}:end`);
        },
    );

    assert.ok(events.indexOf('after:start') > events.indexOf('fast:end'));
    assert.ok(events.indexOf('after:start') < events.indexOf('slow:end'));
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
