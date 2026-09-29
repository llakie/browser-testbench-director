import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { ProjectNodes } from '../../src/ui/client/core/project-nodes.js';
import { playGraphNode, selectGraphNode } from '../support/director-ui.js';
import { outputDirectory } from '../support/ui-verification-context.js';

export async function verifyAudioPlayback(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    const project = ProjectFormat.create('Audio playback');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = '/example-site.html';
    const input = ProjectNodes.createInput(project, 'Soundtrack');
    input.accept = 'audio/wav';
    const audio = ProjectNodes.createAudio(project, 'Play soundtrack');
    audio.volume = 0.4;
    project.nodes = [input, website, audio];
    project.connections = [
        { id: `${input.id}--${audio.id}`, source: input.id, target: audio.id },
        { id: `${website.id}--${audio.id}`, source: website.id, target: audio.id },
    ];
    const projectPath = join(outputDirectory, 'audio-playback.btd.json');
    const audioPath = join(outputDirectory, 'silence.wav');
    await Promise.all([
        writeFile(projectPath, ProjectFormat.stringify(project), 'utf8'),
        writeFile(audioPath, silentWave(250)),
    ]);

    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'Audio playback', 10_000);
    await selectGraphNode(session, input.id);
    await session.upload(`[data-testid="project-input-${input.id}"]`, audioPath);
    await session.waitForScript(
        `return document.querySelector('[model-id="${input.id}"] [joint-selector="fileName"]')
            ?.textContent.includes('silence.wav');`,
        [],
        10_000,
    );
    await selectGraphNode(session, audio.id);
    assert.equal(
        (await session.state('[data-testid="audio-volume"]')).value,
        '0.4',
        'audio: volume must be editable and persisted in the node.',
    );
    await playGraphNode(session, audio.id);
    await session.waitForScript(
        `return ['✓', '!'].includes(document.querySelector(
            '[model-id="${audio.id}"] [joint-selector="statusText"]'
        )?.textContent);`,
        [],
        10_000,
    );
    const result = await session.evaluate<{ error: string; running: boolean; status: string }>(`
        return {
            error: document.querySelector('.node-execution-error')?.textContent?.trim() ?? '',
            running: Boolean(document.querySelector('[data-testid="stop-preview-execution"]')),
            status: document.querySelector(
                '[model-id="${audio.id}"] [joint-selector="statusText"]'
            )?.textContent ?? '',
        };
    `);
    assert.deepEqual(
        result,
        { error: '', running: false, status: '✓' },
        'audio: playback must complete.',
    );

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

function silentWave(durationMs: number): Buffer {
    const sampleRate = 8_000;
    const samples = Math.ceil((sampleRate * durationMs) / 1_000);
    const dataSize = samples * 2;
    const output = Buffer.alloc(44 + dataSize);
    output.write('RIFF', 0);
    output.writeUInt32LE(36 + dataSize, 4);
    output.write('WAVEfmt ', 8);
    output.writeUInt32LE(16, 16);
    output.writeUInt16LE(1, 20);
    output.writeUInt16LE(1, 22);
    output.writeUInt32LE(sampleRate, 24);
    output.writeUInt32LE(sampleRate * 2, 28);
    output.writeUInt16LE(2, 32);
    output.writeUInt16LE(16, 34);
    output.write('data', 36);
    output.writeUInt32LE(dataSize, 40);
    return output;
}
