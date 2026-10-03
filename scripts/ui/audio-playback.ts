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
    audio.loop = true;
    audio.fadeInMs = 200;
    audio.fadeOutMs = 300;
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
        writeFile(audioPath, silentWave(8_000)),
    ]);

    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'Audio playback', 10_000);
    await selectGraphNode(session, audio.id);
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
    await session.waitForValue('[data-testid="audio-position"]', '0', 5_000);
    await assertAudioPlayheadLayout(session, 'desktop');
    const idleTrack = await session.evaluate<{ actual: string; expected: string }>(`
        const slider = document.querySelector('[data-testid="audio-position"]');
        const probe = document.createElement('span');
        probe.style.background = 'var(--color-border)';
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
            actual: getComputedStyle(slider).backgroundImage,
            expected,
        };
    `);
    assert.ok(
        idleTrack.actual.includes(idleTrack.expected),
        'audio: the disabled progress track must use the light UI border color.',
    );
    await session.click('[data-testid="audio-envelope-summary"]');
    await session.click('[data-testid="play-node-current"]');
    await session.waitForScript(`
        return !document.querySelector('[data-testid="audio-position"]').disabled &&
            document.querySelector('[data-testid="play-node-current"] .bi-pause-fill') !== null;
    `, [], 10_000);
    await assertAudioSettingsLocked(session, true, 'running');
    await session.evaluate(`
        const slider = document.querySelector('[data-testid="audio-position"]');
        slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        slider.value = '1200';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await session.waitForScript(`
        return window.__directorAudioPlayback.position('${audio.id}')?.positionMs >= 1200;
    `, [], 5_000);
    const sliderProgress = await session.evaluate<number>(`
        const slider = document.querySelector('[data-testid="audio-position"]');
        return parseFloat(slider.style.getPropertyValue('--audio-progress'));
    `);
    assert.ok(
        sliderProgress > 10 && sliderProgress < 100,
        'audio: the progress track must fill up to the current playback position.',
    );
    const playheadPosition = await session.evaluate<number>(`
        return Number(document.querySelector('[data-testid="audio-envelope-playhead"]').getAttribute('x1'));
    `);
    assert.ok(playheadPosition > 0, 'audio: the envelope must show the seeked playhead.');
    await session.screenshot(join(outputDirectory, 'audio-playhead-running.png'), true);
    await session.click('[data-testid="play-node-current"]');
    await session.waitForScript(`
        return window.__directorAudioPlayback.position('${audio.id}')?.paused &&
            document.querySelector('[data-testid="play-node-current"] .bi-play-fill') !== null;
    `, [], 5_000);
    await session.waitForElement(
        `[model-id="${audio.id}"] [joint-selector="statusRing"].is-paused`,
        5_000,
    );
    assert.equal(
        await session.evaluate<string>(`
            return document.querySelector('[model-id="${audio.id}"] [joint-selector="statusIcon"]')
                ?.getAttribute('d') ?? '';
        `),
        'M 192 14 V 20 M 196 14 V 20',
        'audio: paused instant replay must show a pause icon in the graph.',
    );
    assert.equal(
        await session.evaluate<string>(`
            const ring = document.querySelector('[model-id="${audio.id}"] [joint-selector="statusRing"]');
            return ring ? getComputedStyle(ring).animationName : 'missing';
        `),
        'none',
        'audio: the paused node indicator must not spin.',
    );
    await session.screenshot(join(outputDirectory, 'audio-node-paused.png'), true);
    await assertAudioSettingsLocked(session, false, 'paused');
    await session.click('[data-testid="audio-playback-summary"]');
    await session.clear('[data-testid="audio-fade-in"]');
    await session.fill('[data-testid="audio-fade-in"]', '400');
    await session.clear('[data-testid="audio-fade-out"]');
    await session.fill('[data-testid="audio-fade-out"]', '500');
    assert.equal((await session.state('[data-testid="audio-fade-in"]')).value, '400');
    assert.equal((await session.state('[data-testid="audio-fade-out"]')).value, '500');
    await session.clear('[data-testid="audio-fade-in"]');
    await session.fill('[data-testid="audio-fade-in"]', '200');
    await session.clear('[data-testid="audio-fade-out"]');
    await session.fill('[data-testid="audio-fade-out"]', '300');
    await session.click('[data-testid="audio-envelope-summary"]');
    assert.equal(
        await session.evaluate<boolean>(`
            return !document.querySelector('[data-testid="audio-envelope-editor"]')
                .classList.contains('is-readonly');
        `),
        true,
        'audio: pausing instant playback must unlock the envelope editor.',
    );
    await session.click('[data-testid="audio-envelope-editor"] svg');
    await session.waitForCount('[data-testid="audio-envelope-point"]', 3, 5_000);
    const pausedPointX = await session.evaluate<number>(`
        return Number(document.querySelector(
            '[data-testid="audio-envelope-point"][data-point-index="1"]'
        ).getAttribute('cx'));
    `);
    await session.drag(
        '[data-testid="audio-envelope-point"][data-point-index="1"]',
        '[data-testid="audio-envelope-point"][data-point-index="2"]',
    );
    assert.ok(
        await session.evaluate<number>(`
            return Number(document.querySelector(
                '[data-testid="audio-envelope-point"][data-point-index="1"]'
            ).getAttribute('cx'));
        `) > pausedPointX + 20,
        'audio: envelope points must remain draggable while instant playback is paused.',
    );
    await session.click('[data-testid="delete-audio-envelope-point"]');
    await session.waitForCount('[data-testid="audio-envelope-point"]', 2, 5_000);
    const pausedAt = await session.evaluate<number>(`
        return window.__directorAudioPlayback.position('${audio.id}').positionMs;
    `);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const stillPausedAt = await session.evaluate<number>(`
        return window.__directorAudioPlayback.position('${audio.id}').positionMs;
    `);
    assert.ok(Math.abs(stillPausedAt - pausedAt) < 20, 'audio: pause must freeze playback time.');
    await session.evaluate(`
        const slider = document.querySelector('[data-testid="audio-position"]');
        slider.value = '2000';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await session.waitForScript(`
        const position = window.__directorAudioPlayback.position('${audio.id}');
        return position?.paused && position.positionMs === 2000;
    `, [], 5_000);
    await session.click('[data-testid="play-node-current"]');
    await session.waitForScript(`
        const position = window.__directorAudioPlayback.position('${audio.id}');
        return position && !position.paused && position.positionMs > 2000;
    `, [], 5_000);
    await session.waitForElement(
        `[model-id="${audio.id}"] [joint-selector="statusRing"].is-running`,
        5_000,
    );
    await assertAudioSettingsLocked(session, true, 'resumed');
    await session.waitForScript(`
        return document.querySelector('[data-testid="audio-position"]').disabled &&
            document.querySelector('[data-testid="audio-position"]').value === '0';
    `, [], 15_000);
    await session.click('[data-testid="audio-playback-summary"]');
    assert.equal(
        (await session.state('[data-testid="audio-volume"]')).value,
        '0.4',
        'audio: volume must be editable and persisted in the node.',
    );
    assert.equal((await session.state('[data-testid="audio-fade-in"]')).value, '200');
    assert.equal((await session.state('[data-testid="audio-fade-out"]')).value, '300');
    await session.fill('[data-testid="audio-fade-in"]', '250');
    await session.fill('[data-testid="audio-fade-out"]', '350');
    assert.equal((await session.state('[data-testid="audio-fade-in"]')).value, '250');
    assert.equal((await session.state('[data-testid="audio-fade-out"]')).value, '350');
    await assertAudioPropertiesLayout(session, 'desktop');
    await session.screenshot(join(outputDirectory, 'audio-fades-desktop.png'), true);
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
    await session.waitForCount('[data-testid="audio-file-name"]', 0, 5_000);
    await session.click('[data-testid="audio-envelope-summary"]');
    assert.equal(
        await session.evaluate<boolean>(`
            return document.querySelector('[data-testid="audio-envelope-group"]').open &&
                !document.querySelector('[data-testid="audio-playback-group"]').open;
        `),
        true,
        'audio: opening the envelope closes playback settings.',
    );
    await assertEnvelopeSpacing(session, 'desktop');
    await session.click('[data-testid="audio-envelope-editor"] svg');
    await session.waitForCount('[data-testid="audio-envelope-point"]', 3, 5_000);
    const middleBeforeDrag = await session.evaluate<number>(`
        return Number(document.querySelector(
            '[data-testid="audio-envelope-point"][data-point-index="1"]'
        ).getAttribute('cx'));
    `);
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
    assert.ok(
        envelope.middle > middleBeforeDrag + 20,
        'audio: dragging an envelope point must change its position.',
    );
    assert.match(envelope.selected, /%/u, 'audio: the selected point must expose its values.');
    await session.screenshot(join(outputDirectory, 'audio-envelope-editor.png'), true);
    await session.click('[data-testid="play-node-current"]');
    await session.waitForScript(`
        return !document.querySelector('[data-testid="audio-position"]').disabled &&
            document.querySelector('[data-testid="play-node-current"] .bi-pause-fill') !== null;
    `, [], 10_000);
    await session.click('[data-testid="play-node-current"]');
    await session.waitForScript(`
        return window.__directorAudioPlayback.position('${audio.id}')?.paused &&
            document.querySelector('[data-testid="play-node-current"] .bi-play-fill') !== null;
    `, [], 5_000);
    await session.waitForCount('[data-testid="play-workflow"]', 1, 5_000);
    await session.waitForElement(
        `[model-id="${audio.id}"] [joint-selector="statusRing"].is-paused`,
        5_000,
    );
    assert.equal(
        await session.evaluate<boolean>(`
            return document.querySelector('[model-id="${audio.id}"] [joint-selector="statusRing"]')
                ?.classList.contains('is-paused') ?? false;
        `),
        true,
        'audio: a paused instant replay must keep its pause indicator.',
    );
    await session.click('[data-testid="play-workflow"]');
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
            running: Boolean(document.querySelector('[data-testid="stop-workflow"]')),
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
    await assertAudioPlayheadLayout(session, 'mobile');
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
    await session.click('[data-testid="audio-playback-summary"]');
    assert.equal((await session.state('[data-testid="audio-fade-in"]')).value, '250');
    assert.equal((await session.state('[data-testid="audio-fade-out"]')).value, '350');
    await assertAudioPropertiesLayout(session, 'mobile');
    await session.screenshot(join(outputDirectory, 'audio-fades-mobile.png'), true);
    await session.setViewport(320, 700);
    await assertAudioPlayheadLayout(session, 'narrow mobile');
    await assertAudioPropertiesLayout(session, 'narrow mobile');
    const narrowLayoutFits = await session.evaluate<boolean>(`
        const panel = document.querySelector('[data-testid="audio-playback-group"]').getBoundingClientRect();
        const fields = ['audio-fade-in', 'audio-fade-out'].map((testId) =>
            document.querySelector('[data-testid="' + testId + '"]').getBoundingClientRect()
        );
        return panel.left >= 0 && panel.right <= innerWidth &&
            fields.every((field) => field.left >= panel.left && field.right <= panel.right);
    `);
    assert.equal(narrowLayoutFits, true, 'audio: fade fields must fit a narrow mobile viewport.');

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function assertAudioPropertiesLayout(
    session: RemoteSession,
    viewport: string,
): Promise<void> {
    const layout = await session.evaluate<{
        optionOffset: number;
        fadeOffset: number;
        columnOffset: number;
        columnWidthOffset: number;
        caretOffset: number;
        progressInsetOffset: number;
        progressRightOffset: number;
        rightOverflow: number;
    }>(`
        const bounds = (selector) => document.querySelector(selector).getBoundingClientRect();
        const options = ['audio-wait-for-end', 'audio-loop'].map((testId) =>
            document.querySelector('[data-testid="' + testId + '"]').closest('label').getBoundingClientRect()
        );
        const fades = [bounds('[data-testid="audio-fade-in"]'), bounds('[data-testid="audio-fade-out"]')];
        const panel = bounds('[data-testid="audio-playback-group"]');
        return {
            optionOffset: Math.abs(options[0].top - options[1].top),
            fadeOffset: Math.abs(fades[0].top - fades[1].top),
            columnOffset: Math.max(...options.map((option, index) => Math.abs(option.left - fades[index].left))),
            columnWidthOffset: Math.max(...options.map((option, index) => Math.abs(option.width - fades[index].width))),
            caretOffset: Math.abs(bounds('[data-testid="audio-playback-summary"] > .bi').right - bounds('[data-testid="audio-envelope-summary"] > .bi').right),
            progressInsetOffset: Math.abs(bounds('[data-testid="audio-position"]').left - bounds('[data-testid="audio-volume"]').left),
            progressRightOffset: Math.abs(bounds('[data-testid="audio-playhead"] output').right - bounds('.audio-volume-field output').right),
            rightOverflow: Math.max(...fades.map((field) => field.right - panel.right)),
        };
    `);
    assert.ok(layout.optionOffset <= 1, `audio: ${viewport} options must share a row.`);
    assert.ok(layout.fadeOffset <= 1, `audio: ${viewport} fades must share a row.`);
    assert.ok(layout.columnOffset <= 1, `audio: ${viewport} options must align with fade columns.`);
    assert.ok(layout.columnWidthOffset <= 1, `audio: ${viewport} options must fill fade columns.`);
    assert.ok(layout.caretOffset <= 1, `audio: ${viewport} accordion carets must share the right edge.`);
    assert.ok(layout.progressInsetOffset <= 1, `audio: ${viewport} progress and volume sliders must share the left inset.`);
    assert.ok(layout.progressRightOffset <= 1, `audio: ${viewport} progress time and volume value must share the right inset.`);
    assert.ok(layout.rightOverflow <= 0, `audio: ${viewport} fades must fit the panel.`);
}

async function assertAudioSettingsLocked(
    session: RemoteSession,
    locked: boolean,
    phase: string,
): Promise<void> {
    const state = await session.evaluate<Record<string, boolean>>(`
        const fields = [
            'node-name',
            'audio-volume',
            'audio-wait-for-end',
            'audio-loop',
            'audio-fade-in',
            'audio-fade-out',
        ];
        return Object.fromEntries(fields.map((name) => [
            name,
            document.querySelector('[data-testid="' + name + '"]').disabled,
        ]));
    `);
    assert.deepEqual(
        state,
        Object.fromEntries(Object.keys(state).map((name) => [name, locked])),
        `audio: every setting must be ${locked ? 'locked' : 'editable'} while ${phase}.`,
    );
}

async function assertAudioPlayheadLayout(session: RemoteSession, viewport: string): Promise<void> {
    const layout = await session.evaluate<{
        centerOffset: number;
        outputInside: boolean;
        outputRightOfSlider: boolean;
        sliderWidth: number;
    }>(`
        const panel = document.querySelector('[data-testid="audio-playhead"]').getBoundingClientRect();
        const slider = document.querySelector('[data-testid="audio-position"]').getBoundingClientRect();
        const output = document.querySelector('[data-testid="audio-playhead"] output')
            .getBoundingClientRect();
        return {
            centerOffset: Math.abs((slider.top + slider.bottom - output.top - output.bottom) / 2),
            outputInside: output.right <= panel.right,
            outputRightOfSlider: output.left > slider.right,
            sliderWidth: slider.width,
        };
    `);
    assert.ok(layout.centerOffset <= 1, `audio: ${viewport} time must align with the slider.`);
    assert.ok(layout.outputInside, `audio: ${viewport} time must stay inside the panel.`);
    assert.ok(layout.outputRightOfSlider, `audio: ${viewport} time must sit right of the slider.`);
    assert.ok(layout.sliderWidth >= 100, `audio: ${viewport} slider must remain usable.`);
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
