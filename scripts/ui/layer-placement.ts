import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { playGraphNode, selectGraphNode } from '../support/director-ui.js';
import { exampleSiteUrl, outputDirectory, testbench } from '../support/ui-verification-context.js';

export async function verifyPlacement(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create('Anchoring');
    const website = project.nodes.find((node) => node.type === 'website')!;
    const parent = project.nodes.find((node) => node.type === 'layer')!;
    website.url = exampleSiteUrl;
    parent.name = 'Parent layer';
    parent.playback.removeAfter = true;
    parent.source = {
        html: '<div id="anchor-parent">Parent</div>',
        css: '#anchor-parent { width: 240px; height: 120px; background: #334; }',
        javascript: '',
    };
    project.nodes.push({
        ...parent,
        id: 'anchored-child',
        name: 'Anchored child',
        playback: { durationMs: 0, removeAfter: false },
        placement: {
            reference: { type: 'viewport' },
            horizontal: 'center',
            vertical: 'center',
        },
        source: {
            html: '<div id="anchored-child-content">Child</div>',
            css: '#anchored-child-content { width: 40px; height: 24px; background: #f63; }',
            javascript: '',
        },
    });
    project.connections.push({
        id: 'layer-1--anchored-child',
        source: 'layer-1',
        target: 'anchored-child',
    });
    const projectPath = join(outputDirectory, 'anchoring.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await selectGraphNode(session, 'anchored-child');
    await session.waitForElement('[data-testid="horizontal-right"]', 10_000);
    const horizontalLabels = await session.evaluate<boolean>(`
        return ['left', 'center', 'right'].every((alignment) => {
            const button = document.querySelector('[data-testid="horizontal-' + alignment + '"]');
            return button.textContent.trim() === '' && Boolean(button.getAttribute('aria-label'));
        });
    `);
    assert.equal(
        horizontalLabels,
        true,
        'placement: horizontal choices must be labeled icon buttons.',
    );
    const alignmentGeometry = await session.evaluate<{
        referenceOptions: string[];
        buttonsSquare: boolean;
        buttonSizes: Array<{ width: number; height: number }>;
        groupsAdjacent: boolean;
        label: string;
        maximizeRightGap: number;
    }>(`
        const field = document.querySelector('.layer-alignment-field');
        const controls = field.querySelector('.layer-alignment-controls');
        const groups = [...controls.querySelectorAll('.alignment-button-group')];
        const placementControl = controls.querySelector('[data-testid="placement-reference"]');
        const buttons = groups.flatMap(group => [...group.querySelectorAll('button')]);
        const header = document.querySelector('.panel__header--editor');
        const headerBounds = header.getBoundingClientRect();
        const maximizeButton = header.querySelector('[data-testid="maximize-editor"]');
        const maximizeBounds = maximizeButton.getBoundingClientRect();
        const horizontalBounds = groups[0].getBoundingClientRect();
        const verticalBounds = groups[1].getBoundingClientRect();
        const buttonSizes = buttons.map(button => {
            const bounds = button.getBoundingClientRect();
            return { width: bounds.width, height: bounds.height };
        });
        return {
            referenceOptions: [...placementControl.options].map((option) => option.value),
            buttonsSquare: buttons.every((button) => {
                const bounds = button.getBoundingClientRect();
                return Math.abs(bounds.width - bounds.height) < 1;
            }),
            buttonSizes,
            groupsAdjacent:
                verticalBounds.left > horizontalBounds.right &&
                verticalBounds.left - horizontalBounds.right <= 10,
            label: field.firstElementChild.textContent.trim(),
            maximizeRightGap: headerBounds.right - maximizeBounds.right,
        };
    `);
    assert.deepEqual(
        alignmentGeometry.referenceOptions,
        ['viewport', 'layer', 'dom'],
        'placement: reference source must offer viewport, layer, and DOM.',
    );
    assert.equal(
        alignmentGeometry.buttonsSquare,
        true,
        `placement: horizontal and vertical controls must be square (${JSON.stringify(alignmentGeometry.buttonSizes)}).`,
    );
    assert.equal(
        alignmentGeometry.groupsAdjacent,
        true,
        'placement: horizontal and vertical groups must sit next to each other.',
    );
    assert.match(
        alignmentGeometry.label,
        /Ausrichtung|Alignment/u,
        'placement: the positioning options need one shared group label.',
    );
    assert.ok(
        alignmentGeometry.maximizeRightGap >= 8 && alignmentGeometry.maximizeRightGap <= 12,
        `placement: maximize needs the standard right inset (${alignmentGeometry.maximizeRightGap}px).`,
    );
    await session.setViewport(1440, 650);
    const alignmentScroll = await session.evaluate<{
        scrollTop: number;
        nameShift: number;
        alignmentShift: number;
    }>(`
        const body = document.querySelector('[data-testid="editor-properties-scroll"]');
        const name = document.querySelector('.editor-node-header');
        const alignment = document.querySelector('.layer-alignment-field');
        const nameTop = name.getBoundingClientRect().top;
        const alignmentTop = alignment.getBoundingClientRect().top;
        body.scrollTop = Math.min(48, body.scrollHeight - body.clientHeight);
        const result = {
            scrollTop: body.scrollTop,
            nameShift: name.getBoundingClientRect().top - nameTop,
            alignmentShift: alignment.getBoundingClientRect().top - alignmentTop,
        };
        body.scrollTop = 0;
        return result;
    `);
    assert.ok(alignmentScroll.scrollTop > 0, 'placement: layer properties must be scrollable.');
    assert.ok(
        Math.abs(alignmentScroll.nameShift) < 1,
        'placement: the node name must remain fixed while properties scroll.',
    );
    assert.ok(
        alignmentScroll.alignmentShift < -10,
        'placement: alignment controls must scroll with the layer properties.',
    );
    await session.setViewport(1440, 1000);
    await session.click('[data-testid="horizontal-right"]');
    const verticalIconGeometry = await session.evaluate<{
        horizontalLines: boolean;
        topOffset: number;
        centerOffset: number;
        bottomOffset: number;
    }>(`
        const icons = ['top', 'center', 'bottom'].map((alignment) =>
            document.querySelector('[data-testid="vertical-' + alignment + '"] .alignment-icon'),
        );
        const offsets = icons.map((icon) => {
            const iconBounds = icon.getBoundingClientRect();
            const lines = [...icon.children].map((line) => line.getBoundingClientRect());
            return {
                offset: Math.min(...lines.map((line) => line.top)) - iconBounds.top,
                horizontal: lines.every((line) => line.width > line.height),
            };
        });
        return {
            horizontalLines: offsets.every(({ horizontal }) => horizontal),
            topOffset: offsets[0].offset,
            centerOffset: offsets[1].offset,
            bottomOffset: offsets[2].offset,
        };
    `);
    assert.equal(
        verticalIconGeometry.horizontalLines,
        true,
        'placement: vertical alignment icons must use horizontal lines.',
    );
    assert.ok(
        verticalIconGeometry.topOffset < verticalIconGeometry.centerOffset &&
            verticalIconGeometry.centerOffset < verticalIconGeometry.bottomOffset,
        'placement: vertical alignment icons must place their lines at top, center, and bottom.',
    );
    await session.click('[data-testid="vertical-bottom"]');
    await session.screenshot(join(outputDirectory, 'alignment-controls.png'), true);
    await playGraphNode(session, 'anchored-child');
    await session.switchFrame('.preview-viewport iframe');
    await session.waitForElement(
        '.director-layer__anchor[data-horizontal="right"][data-vertical="bottom"]',
        5_000,
    );
    const aligned = await session.evaluate<{ justifyItems: string; alignItems: string }>(`
        const style = getComputedStyle(document.querySelector('.director-layer__anchor'));
        return { justifyItems: style.justifyItems, alignItems: style.alignItems };
    `);
    assert.equal(aligned.justifyItems, 'end', 'placement: right must align to the right edge.');
    assert.equal(aligned.alignItems, 'end', 'placement: bottom must align to the bottom edge.');
    await session.switchFrame();
    await session.waitForCount('[data-testid="play-workflow"]', 1, 10_000);

    await session.evaluate(`
        const select = document.querySelector('[data-testid="placement-reference"]');
        select.value = 'layer';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await session.waitForElement('[data-testid="placement-parent-layer"]', 5_000);
    assert.equal(
        await session.evaluate<string>(`
            return document.querySelector('[data-testid="placement-parent-layer"]').value;
        `),
        'layer-1',
        'placement: the preceding layer must be selected as the default parent.',
    );
    await playGraphNode(session, 'anchored-child');
    await session.switchFrame('.preview-viewport iframe');
    await session.waitForElement(
        '[data-director-node="anchored-child"] .director-layer__anchor',
        5_000,
    );
    const parentAnchor = await session.evaluate<{
        width: number;
        height: number;
        parentRemoved: boolean;
    }>(`
        const anchor = document.querySelector(
            '[data-director-node="anchored-child"] .director-layer__anchor'
        ).getBoundingClientRect();
        return {
            width: Math.round(anchor.width),
            height: Math.round(anchor.height),
            parentRemoved: !document.querySelector('[data-director-node="layer-1"]'),
        };
    `);
    assert.deepEqual(
        parentAnchor,
        { width: 240, height: 120, parentRemoved: true },
        'placement: a removed parent must retain its last content rectangle.',
    );
    await session.switchFrame();
    await session.waitForCount('[data-testid="play-workflow"]', 1, 10_000);

    await session.evaluate(`
        const select = document.querySelector('[data-testid="placement-reference"]');
        select.value = 'dom';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await session.waitForElement('[data-testid="pick-placement-dom-selector"]', 5_000);
    await session.evaluate(`
        const input = document.querySelector('[data-testid="placement-dom-selector"]');
        input.value = '#example-website';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await playGraphNode(session, 'anchored-child');
    await session.switchFrame('.preview-viewport iframe');
    await session.waitForElement(
        '[data-director-node="anchored-child"] .director-layer__anchor',
        5_000,
    );
    const domAnchorMatches = await session.evaluate<boolean>(`
        const anchor = document.querySelector(
            '[data-director-node="anchored-child"] .director-layer__anchor'
        ).getBoundingClientRect();
        const target = document.querySelector('.director-website').contentDocument
            .querySelector('#example-website').getBoundingClientRect();
        return ['left', 'top', 'width', 'height']
            .every((key) => Math.abs(anchor[key] - target[key]) < 1);
    `);
    assert.equal(
        domAnchorMatches,
        true,
        'placement: DOM selector must define the anchor rectangle.',
    );
    await session.switchFrame();
    await session.click('[data-testid="viewport-device-trigger"]');
    await session.waitForElement('.device-flyout__menu .target-option', 10_000);
    const pickerTargetId = await session.evaluate<string>(`
        return [...document.querySelectorAll('.device-flyout__menu .target-option')]
            .find(target => !target.disabled)?.dataset.testid.replace('remote-target-', '') || '';
    `);
    assert.ok(pickerTargetId, 'placement: a remote selector target must be available.');
    await session.click(`[data-testid="remote-target-${pickerTargetId}"]`);
    await session.waitForScript(
        `return /geöffnet|Opened preview/u.test(
            document.querySelector('.notice')?.textContent || ''
        );`,
        [],
        30_000,
    );
    await session.waitForState('[data-testid="pick-placement-dom-selector"]', 'enabled', 10_000);
    await session.waitForState('[data-testid="play-workflow"]', 'enabled', 10_000);
    const existingSessions = new Set((await testbench.sessions()).map((candidate) => candidate.id));
    await session.click('[data-testid="pick-placement-dom-selector"]');
    let pickerSession: RemoteSession | undefined;

    for (let attempt = 0; attempt < 80 && !pickerSession; attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
        pickerSession = (await testbench.sessions()).find(
            (candidate) => !existingSessions.has(candidate.id),
        );
    }

    assert.ok(pickerSession, 'placement: the DOM picker must open a remote website session.');
    await pickerSession.waitForScript(
        `return window.__directorSelectorPicker?.status === 'picking';`,
        [],
        10_000,
    );
    await pickerSession.click('#example-website');
    await session.waitForValue(
        '[data-testid="placement-dom-selector"]',
        '#example-website',
        10_000,
    );
    await pickerSession.close().catch(() => undefined);
    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 5_000);
}
