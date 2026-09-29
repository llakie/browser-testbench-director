import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { selectGraphNode } from '../support/director-ui.js';
import { outputDirectory } from '../support/ui-verification-context.js';

export async function verifyLayerSelectionAndZoom(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create('Layer selection');
    const firstLayer = project.nodes.find((node) => node.type === 'layer')!;
    project.nodes.push({
        ...firstLayer,
        id: 'layer-second',
        name: 'Second Layer',
        position: { x: 32, y: 144 },
        placement: {
            reference: { type: 'viewport' },
            horizontal: 'right',
            vertical: 'bottom',
        },
        source: {
            html: '<div id="second-layer">Second layer</div>',
            css: '#second-layer { width: 12rem; padding: 2rem; background: #ff6d38; }',
            javascript: "director.root.querySelector('#second-layer').dataset.played = 'true';",
        },
    });
    project.connections.push({
        id: 'layer-1--layer-second',
        source: 'layer-1',
        target: 'layer-second',
    });
    const projectPath = join(outputDirectory, 'selection.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-link', 2, 5_000);

    await session.click('[data-testid="open-project-settings"]');
    await session.waitForElement('[data-testid="project-settings-backdrop"]', 5_000);
    await session.evaluate(`
        for (const [selector, value] of [
            ['[data-testid="browser-session-language"]', 'de'],
            ['[data-testid="browser-session-locale"]', 'DE'],
        ]) {
            const input = document.querySelector(selector);
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    `);
    await session.waitForValue('[data-testid="browser-session-language"]', 'de', 5_000);
    await session.waitForValue('[data-testid="browser-session-locale"]', 'DE', 5_000);
    const settingsScrollHeight = await session.evaluate<number>(`
        return document.querySelector('.project-settings-dialog').scrollHeight;
    `);
    await session.click('[data-testid="browser-session-permissions"]');
    await session.waitForElement('[data-testid="browser-session-permission-microphone"]', 5_000);
    const permissionMenu = await session.evaluate<{
        dialogScrollHeight: number;
        opensUpward: boolean;
    }>(`
        const dialog = document.querySelector('.project-settings-dialog');
        const trigger = document.querySelector('[data-testid="browser-session-permissions"]');
        const menu = document.querySelector('.permission-select__menu');
        return {
            dialogScrollHeight: dialog.scrollHeight,
            opensUpward: menu.getBoundingClientRect().bottom < trigger.getBoundingClientRect().top,
        };
    `);
    assert.equal(
        permissionMenu.opensUpward,
        true,
        'settings: the permission menu must open above its trigger.',
    );
    assert.equal(
        permissionMenu.dialogScrollHeight,
        settingsScrollHeight,
        'settings: opening permissions must not increase the dialog scroll height.',
    );
    await session.click('[data-testid="browser-session-permission-microphone"]');
    const permissions = await session.evaluate<string[]>(
        'return [...document.querySelectorAll(`[data-testid^="browser-session-permission-"]:checked`)].map((input) => input.value);',
    );
    assert.deepEqual(permissions, ['microphone']);
    await session.evaluate(`
        document
            .querySelector('[data-testid="project-settings-backdrop"]')
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    `);
    await session.waitForState('[data-testid="project-settings-backdrop"]', 'absent', 5_000);

    await selectGraphNode(session, 'website-root');
    await session.waitForValue('[data-testid="website-url"]', '', 5_000);
    await session.evaluate(`
        const input = document.querySelector('[data-testid="website-url"]');
        input.value = '/example-site.html?root=1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await session.waitForValue('[data-testid="website-url"]', '/example-site.html?root=1', 5_000);
    await session.click('[data-testid="play-workflow"]');

    try {
        await session.waitForScript(
            `const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
            const website = preview?.querySelector('.director-website')?.contentDocument;
            return Boolean(
                preview?.querySelector('#second-layer[data-played="true"]') &&
                website?.querySelector('#example-website')
            );`,
            [],
            10_000,
        );
    } catch (error) {
        const state = await session.evaluate(`
            const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
            return {
                notice: document.querySelector('.notice')?.textContent?.trim() || '',
                previewText: preview?.body?.textContent?.trim().slice(0, 200) || '',
                nodes: [...document.querySelectorAll('.joint-element')].map(node => ({
                    id: node.getAttribute('model-id'),
                    status: node.querySelector('[joint-selector="statusText"]')?.textContent,
                })),
            };
        `);
        throw new Error(`Workflow preview did not finish: ${JSON.stringify(state)}`, {
            cause: error,
        });
    }

    await selectGraphNode(session, 'layer-second');
    const frameSize = await session.evaluate<{ width: number; height: number }>(`
        const frame = document.querySelector('.preview-viewport iframe');
        return {
            width: frame.contentWindow.innerWidth,
            height: frame.contentWindow.innerHeight,
        };
    `);
    assert.deepEqual(
        frameSize,
        { width: 360, height: 640 },
        'preview: iframe uses the configured CSS viewport.',
    );
    await session.click('[data-testid="graph-canvas"]');
    await session.waitForState('.preview-viewport iframe', 'present', 5_000);
    await session.waitForCount('.preview-panel', 1, 5_000);
    await session.waitForCount('.editor-panel', 1, 5_000);
    const unselected = await session.evaluate<{
        graphWidth: number;
        previewWidth: number;
        editorHeight: number;
        previewContent: number;
        editorContent: number;
        maximized: boolean;
    }>(`
        const workspace = document.querySelector('.workspace');
        return {
            graphWidth: document.querySelector('.graph-panel').getBoundingClientRect().width,
            previewWidth: document.querySelector('.preview-panel').getBoundingClientRect().width,
            editorHeight: document.querySelector('.editor-panel').getBoundingClientRect().height,
            previewContent: document.querySelectorAll('.preview-canvas').length,
            editorContent: document.querySelectorAll(
                '.editor-panel .panel-header-actions, .editor-panel .source-editor',
            ).length,
            maximized: workspace.classList.contains('workspace--panel-maximized'),
        };
    `);
    assert.ok(unselected.graphWidth > 0, 'selection: graph panel must remain visible.');
    assert.ok(unselected.previewWidth > 0, 'selection: empty preview panel must remain visible.');
    assert.ok(unselected.editorHeight > 0, 'selection: empty editor panel must remain visible.');
    assert.equal(
        unselected.previewContent,
        1,
        'selection: clearing the node selection must preserve the browser state.',
    );
    assert.equal(unselected.editorContent, 0, 'selection: editor content must be empty.');
    assert.equal(unselected.maximized, false, 'selection: graph must not be maximized.');
    await session.screenshot(join(outputDirectory, 'selection-empty.png'), true);

    await selectGraphNode(session, 'layer-1');
    await session.waitForElement('.preview-panel', 5_000);
    const scaleBefore = (await session.state('[data-testid="viewport-scale"]')).text;
    assert.match(scaleBefore, /360 × 640 CSS/u, 'preview: viewport label must be visible.');
    assert.equal(
        await session.count('[data-testid^="preview-zoom-"]'),
        0,
        'preview: auto-fit must not expose manual zoom controls.',
    );

    const graphBefore = await session.evaluate<number>(
        `return document.querySelector('[data-testid="graph-canvas"] .joint-element').getBoundingClientRect().width;`,
    );
    await session.click('[data-testid="graph-zoom-in"]');
    const graphAfter = await session.evaluate<number>(
        `return document.querySelector('[data-testid="graph-canvas"] .joint-element').getBoundingClientRect().width;`,
    );
    assert.ok(graphAfter > graphBefore, 'graph: zoom in must enlarge graph elements.');
    await session.click('[data-testid="graph-zoom-reset"]');

    const graphAfterPinch = await pinchStage(
        session,
        '[data-testid="graph-canvas"]',
        '[data-testid="graph-canvas"] .joint-element',
    );
    assert.ok(
        graphAfterPinch.after > graphAfterPinch.before,
        `graph: pinch must enlarge graph elements (${JSON.stringify(graphAfterPinch)}).`,
    );
    await session.click('[data-testid="graph-zoom-reset"]');

    const graphAfterWheelPan = await wheelPanStage(
        session,
        '[data-testid="graph-canvas"]',
        '[data-testid="graph-canvas"] .joint-element',
    );
    assert.ok(
        graphAfterWheelPan.afterLeft < graphAfterWheelPan.beforeLeft &&
            graphAfterWheelPan.afterTop < graphAfterWheelPan.beforeTop,
        `graph: two-finger touchpad pan must move the paper (${JSON.stringify(graphAfterWheelPan)}).`,
    );

    const graphAfterRightDrag = await dragPanStage(
        session,
        '[data-testid="graph-canvas"]',
        '[data-testid="graph-canvas"] .joint-element',
        'mouse',
        2,
    );
    assert.ok(
        graphAfterRightDrag.afterLeft > graphAfterRightDrag.beforeLeft &&
            graphAfterRightDrag.afterTop > graphAfterRightDrag.beforeTop,
        `graph: right-button drag must pan the paper (${JSON.stringify(graphAfterRightDrag)}).`,
    );

    const graphAfterTouchDrag = await dragPanStage(
        session,
        '[data-testid="graph-canvas"]',
        '[data-testid="graph-canvas"] .joint-element',
        'touch',
        0,
    );
    assert.ok(
        graphAfterTouchDrag.afterLeft > graphAfterTouchDrag.beforeLeft &&
            graphAfterTouchDrag.afterTop > graphAfterTouchDrag.beforeTop,
        `graph: one-finger drag must pan the paper (${JSON.stringify(graphAfterTouchDrag)}).`,
    );

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 5_000);
}

interface PanResult {
    beforeLeft: number;
    beforeTop: number;
    afterLeft: number;
    afterTop: number;
    beforeScrollLeft: number;
    beforeScrollTop: number;
    afterScrollLeft: number;
    afterScrollTop: number;
}

async function wheelPanStage(
    session: RemoteSession,
    stageSelector: string,
    measuredSelector: string,
    prepareScroll = false,
): Promise<PanResult> {
    return session.evaluate<PanResult>(`
        const stage = document.querySelector(${JSON.stringify(stageSelector)});
        const measured = document.querySelector(${JSON.stringify(measuredSelector)});
        if (!(stage instanceof HTMLElement) || !(measured instanceof Element)) {
            throw new Error('Pan test target is missing.');
        }
        if (${prepareScroll}) {
            stage.scrollLeft = 80;
            stage.scrollTop = 80;
        }
        const before = measured.getBoundingClientRect();
        const beforeScrollLeft = stage.scrollLeft;
        const beforeScrollTop = stage.scrollTop;
        stage.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaX: 36,
            deltaY: 28,
        }));
        const after = measured.getBoundingClientRect();
        return {
            beforeLeft: before.left,
            beforeTop: before.top,
            afterLeft: after.left,
            afterTop: after.top,
            beforeScrollLeft,
            beforeScrollTop,
            afterScrollLeft: stage.scrollLeft,
            afterScrollTop: stage.scrollTop,
        };
    `);
}

async function dragPanStage(
    session: RemoteSession,
    stageSelector: string,
    measuredSelector: string,
    pointerType: 'mouse' | 'touch',
    button: number,
): Promise<PanResult> {
    return session.evaluate<PanResult>(`
        const stage = document.querySelector(${JSON.stringify(stageSelector)});
        const measured = document.querySelector(${JSON.stringify(measuredSelector)});
        if (!(stage instanceof HTMLElement) || !(measured instanceof Element)) {
            throw new Error('Pan test target is missing.');
        }
        const before = measured.getBoundingClientRect();
        const beforeScrollLeft = stage.scrollLeft;
        const beforeScrollTop = stage.scrollTop;
        const pointer = (type, clientX, clientY, buttons) => stage.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: ${JSON.stringify(pointerType)},
            button: ${button},
            buttons,
            isPrimary: true,
            clientX,
            clientY,
        }));
        pointer('pointerdown', 160, 160, ${button === 2 ? 2 : 1});
        pointer('pointermove', 205, 195, ${button === 2 ? 2 : 1});
        pointer('pointerup', 205, 195, 0);
        const after = measured.getBoundingClientRect();
        return {
            beforeLeft: before.left,
            beforeTop: before.top,
            afterLeft: after.left,
            afterTop: after.top,
            beforeScrollLeft,
            beforeScrollTop,
            afterScrollLeft: stage.scrollLeft,
            afterScrollTop: stage.scrollTop,
        };
    `);
}

async function pinchStage(
    session: RemoteSession,
    stageSelector: string,
    measuredSelector: string,
): Promise<{ before: number; after: number }> {
    const before = await session.evaluate<number>(`
        return document.querySelector(${JSON.stringify(measuredSelector)}).getBoundingClientRect().width;
    `);
    await session.evaluate(`
        const stage = document.querySelector(${JSON.stringify(stageSelector)});
        if (!(stage instanceof HTMLElement)) {
            throw new Error('Pinch test target is missing.');
        }
        const pointer = (type, pointerId, clientX) => stage.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: 'touch',
            isPrimary: pointerId === 1,
            clientX,
            clientY: 120,
        }));
        pointer('pointerdown', 1, 100);
        pointer('pointerdown', 2, 200);
        pointer('pointermove', 2, 250);
        pointer('pointerup', 1, 100);
        pointer('pointerup', 2, 250);
    `);
    const after = await session.evaluate<number>(`
        return document.querySelector(${JSON.stringify(measuredSelector)}).getBoundingClientRect().width;
    `);
    return { before, after };
}
