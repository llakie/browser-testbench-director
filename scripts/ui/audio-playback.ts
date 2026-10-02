import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { ProjectNodes } from '../../src/ui/client/core/project-nodes.js';
import { selectGraphNode } from '../support/director-ui.js';
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
    audio.waitForEnd = true;
    const visual = ProjectNodes.createLayer(project, 'Finish video');
    visual.playback = { durationMs: 100, removeAfter: true };
    const merge = ProjectNodes.createMerge(project, 'Stop remaining branches');
    merge.waitFor = 'any';
    project.nodes = [input, website, audio, visual, merge];
    project.connections = [
        { id: `${input.id}--${audio.id}`, source: input.id, target: audio.id },
        { id: `${website.id}--${audio.id}`, source: website.id, target: audio.id },
        { id: `${website.id}--${visual.id}`, source: website.id, target: visual.id },
        { id: `${audio.id}--${merge.id}`, source: audio.id, target: merge.id },
        { id: `${visual.id}--${merge.id}`, source: visual.id, target: merge.id },
    ];
    const projectPath = join(outputDirectory, 'audio-playback.btd.json');
    const audioPath = join(outputDirectory, 'silence.wav');
    await Promise.all([
        writeFile(projectPath, ProjectFormat.stringify(project), 'utf8'),
        writeFile(audioPath, silentWave(2_000)),
    ]);

    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'Audio playback', 10_000);
    await selectGraphNode(session, audio.id);
    await session.waitForCount('[data-testid="audio-file-name"]', 0, 5_000);
    await selectGraphNode(session, input.id);
    await session.upload(`[data-testid="project-input-${input.id}"]`, audioPath);
    await session.waitForScript(
        `return document.querySelector('[model-id="${input.id}"] [joint-selector="fileName"]')
            ?.textContent.includes('silence.wav');`,
        [],
        10_000,
    );
    await selectGraphNode(session, audio.id);
    const graphPlayDisplay = await session.evaluate<string>(`
        const control = document.querySelector(
            '[model-id="${audio.id}"] [joint-selector="playButton"]'
        );
        return control ? getComputedStyle(control).display : 'missing';
    `);
    assert.equal(
        graphPlayDisplay,
        'none',
        'audio: graph nodes must use properties audition instead of play-to-node.',
    );
    await session.click('[data-testid="play-node-current"]');
    await session.waitForScript(
        `return ['✓', '!'].includes(document.querySelector(
            '[model-id="${audio.id}"] [joint-selector="statusText"]'
        )?.textContent);`,
        [],
        10_000,
    );
    const instantPlayback = await session.evaluate<{ error: string; status: string }>(`
        return {
            error: document.querySelector('.node-execution-error')?.textContent?.trim() ?? '',
            status: document.querySelector(
                '[model-id="${audio.id}"] [joint-selector="statusText"]'
            )?.textContent ?? '',
        };
    `);
    assert.deepEqual(
        instantPlayback,
        { error: '', status: '✓' },
        'audio: instant playback must receive the loaded audio input.',
    );
    assert.equal(
        (await session.state('[data-testid="audio-volume"]')).value,
        '0.4',
        'audio: volume must be editable and persisted in the node.',
    );
    await session.press('\uE011', '[data-testid="audio-volume"]');
    assert.equal(
        (await session.state('[data-testid="audio-volume"]')).value,
        '0',
        'audio: the volume slider must reach its minimum.',
    );
    await session.press('\uE010', '[data-testid="audio-volume"]');
    assert.equal(
        (await session.state('[data-testid="audio-volume"]')).value,
        '1',
        'audio: the volume slider must reach its maximum.',
    );
    assert.equal(
        (await session.state('[data-testid="audio-file-name"]')).text,
        'silence.wav',
        'audio: properties must show the connected audio filename.',
    );
    await assertEnvelopeSpacing(session, 'desktop');
    await session.click('[data-testid="audio-envelope-editor"] svg');
    await session.waitForCount('[data-testid="audio-envelope-point"]', 3, 5_000);
    await session.drag(
        '[data-testid="audio-envelope-point"][data-point-index="1"]',
        '[data-testid="audio-envelope-point"][data-point-index="2"]',
    );
    const envelope = await session.evaluate<{
        middle: number;
        end: number;
        selected: string;
    }>(`
        const points = document.querySelectorAll('[data-testid="audio-envelope-point"]');
        return {
            middle: Number(points[1].getAttribute('cx')),
            end: Number(points[2].getAttribute('cx')),
            selected: document.querySelector(
                '.audio-envelope-editor__footer output'
            )?.textContent?.trim() ?? '',
        };
    `);
    assert.ok(
        envelope.end - envelope.middle >= 15,
        'audio: points must stop visibly before their right neighbor.',
    );
    assert.match(envelope.selected, /%/u, 'audio: the selected point must expose its values.');
    await session.screenshot(join(outputDirectory, 'audio-envelope-editor.png'), true);
    await session.click('[data-testid="play-workflow"]');
    await session.waitForCount('[data-testid="stop-preview-execution"]', 1, 10_000);
    await session.waitForCount('[data-testid="play-workflow"]', 1, 10_000);
    await session.waitForScript(
        `return document.querySelector(
            '[model-id="${audio.id}"] [joint-selector="statusText"]'
        )?.textContent === '■' && document.querySelector(
            '[model-id="${merge.id}"] [joint-selector="statusText"]'
        )?.textContent === '✓' && document.querySelector(
            '[model-id="${visual.id}"] [joint-selector="statusText"]'
        )?.textContent === '✓';`,
        [],
        10_000,
    );
    const result = await session.evaluate<{
        audioStatus: string;
        error: string;
        running: boolean;
        mergeStatus: string;
        visualStatus: string;
    }>(`
        return {
            audioStatus: document.querySelector(
                '[model-id="${audio.id}"] [joint-selector="statusText"]'
            )?.textContent ?? '',
            error: document.querySelector('.node-execution-error')?.textContent?.trim() ?? '',
            running: Boolean(document.querySelector('[data-testid="stop-preview-execution"]')),
            mergeStatus: document.querySelector(
                '[model-id="${merge.id}"] [joint-selector="statusText"]'
            )?.textContent ?? '',
            visualStatus: document.querySelector(
                '[model-id="${visual.id}"] [joint-selector="statusText"]'
            )?.textContent ?? '',
        };
    `);
    assert.deepEqual(
        result,
        {
            audioStatus: '■',
            error: '',
            running: false,
            mergeStatus: '✓',
            visualStatus: '✓',
        },
        'audio: wait-any must cancel the losing soundtrack branch and complete the merge.',
    );
    await session.setViewport(390, 844);
    await session.click('[data-testid="mobile-editor-tab"]');
    const mobileEnvelopeInsideViewport = await session.evaluate<boolean>(`
        const editor = document.querySelector('[data-testid="audio-envelope-editor"]')
            .getBoundingClientRect();
        return editor.left >= 0 && editor.right <= innerWidth;
    `);
    assert.equal(
        mobileEnvelopeInsideViewport,
        true,
        'audio: the envelope editor must fit the mobile properties view.',
    );
    await assertEnvelopeSpacing(session, 'mobile');
    await session.screenshot(join(outputDirectory, 'audio-envelope-editor-mobile.png'), true);

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function assertEnvelopeSpacing(session: RemoteSession, viewport: string): Promise<void> {
    const spacing = await session.evaluate<{
        outer: number;
        inner: number;
        top: number;
        pointWidth: number;
        pointHeight: number;
    }>(`
        const section = document.querySelector('.automation-properties').getBoundingClientRect();
        const editor = document.querySelector('[data-testid="audio-envelope-editor"]')
            .getBoundingClientRect();
        const point = document.querySelector('[data-testid="audio-envelope-point"]');
        const matrix = point.getScreenCTM();
        const x = Number(point.getAttribute('cx'));
        const y = Number(point.getAttribute('cy'));
        const visiblePoint = document.querySelector('.audio-envelope-editor__point')
            .getBoundingClientRect();
        return {
            outer: editor.left - section.left,
            inner: matrix.a * x + matrix.c * y + matrix.e - editor.left,
            top: matrix.b * x + matrix.d * y + matrix.f - editor.top,
            pointWidth: visiblePoint.width,
            pointHeight: visiblePoint.height,
        };
    `);
    assert.ok(
        Math.abs(spacing.inner - spacing.outer) <= 2 && Math.abs(spacing.top - spacing.outer) <= 2,
        `audio: ${viewport} envelope inset must match the properties-panel inset.`,
    );
    assert.ok(
        Math.abs(spacing.pointWidth - spacing.pointHeight) <= 0.5,
        `audio: ${viewport} envelope points must stay round.`,
    );
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
