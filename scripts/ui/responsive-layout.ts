import assert from 'node:assert/strict';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { outputDirectory } from '../support/ui-verification-context.js';

type LayoutMode = 'portrait-dock' | 'mobile-tabs';

interface LayoutSnapshot {
    readonly graph: DOMRectSnapshot;
    readonly graphCanvas: DOMRectSnapshot;
    readonly graphNode: DOMRectSnapshot;
    readonly editor: DOMRectSnapshot;
    readonly preview: DOMRectSnapshot;
    readonly previewStage: DOMRectSnapshot;
    readonly previewViewport: DOMRectSnapshot;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly playVisible: boolean;
    readonly playInViewport: boolean;
    readonly playText: string;
    readonly playLabel: string | null;
    readonly playTitle: string | null;
    readonly horizontalOverflow: boolean;
    readonly verticalOverflow: boolean;
    readonly panelPrefixCount: number;
    readonly panelTitlesUseOwnRows: boolean;
    readonly headerActionAlignment: string[];
    readonly maximizeButtonsEndRows: boolean;
    readonly sourceCountBadges: number;
}

export interface DOMRectSnapshot {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
}

export async function verifyLayout(
    session: RemoteSession,
    name: string,
    width: number,
    height: number,
    mode: LayoutMode,
): Promise<void> {
    await session.setViewport(width, height);
    await session.refresh();
    await session.waitForCount('[data-testid="play-workflow"]', 1, 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
    const layout = await session.evaluate<LayoutSnapshot>(`
        const snapshot = (selector) => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return {
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left,
                width: rect.width,
                height: rect.height,
            };
        };
        const play = document.querySelector('[data-testid="play-workflow"]');
        return {
            graph: snapshot('.graph-panel'),
            graphCanvas: snapshot('[data-testid="graph-canvas"]'),
            graphNode: snapshot('[data-testid="graph-canvas"] .joint-element'),
            editor: snapshot('.editor-panel'),
            preview: snapshot('.preview-panel'),
            previewStage: snapshot('.preview-stage'),
            previewViewport: snapshot('.preview-viewport'),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            playVisible: Boolean(play && play.getBoundingClientRect().height > 0),
            playInViewport: Boolean(play && play.getBoundingClientRect().bottom <= window.innerHeight),
            playText: play?.textContent?.trim() ?? '',
            playLabel: play?.getAttribute('aria-label') ?? null,
            playTitle: play?.getAttribute('title') ?? null,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
            panelPrefixCount: document.querySelectorAll('.panel__index').length,
            panelTitlesUseOwnRows: [...document.querySelectorAll('.panel__header')].every((header) => {
                const title = header.querySelector('.panel-title');
                const actions = header.querySelector('.panel-header-actions, .preview-toolbar');
                if (!title || !actions) return true;
                return title.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top;
            }),
            headerActionAlignment: [...document.querySelectorAll('.panel-header-actions, .preview-toolbar')]
                .map((row) => getComputedStyle(row).justifyContent),
            maximizeButtonsEndRows: [...document.querySelectorAll('[data-testid^="maximize-"]')]
                .every((button) => {
                    const buttonBounds = button.getBoundingClientRect();
                    if (buttonBounds.width === 0) return true;
                    const rowBounds = button.parentElement.getBoundingClientRect();
                    return Math.abs(buttonBounds.right - rowBounds.right) < 1;
                }),
            sourceCountBadges: document.querySelectorAll('.source-count').length,
        };
    `);
    assert.equal(layout.playVisible, true, `${name}: workflow play belongs to the graph view.`);
    assert.equal(layout.playText, '', `${name}: play button must contain only its icon.`);
    assert.ok(layout.playLabel, `${name}: play button must retain an accessible label.`);
    assert.equal(layout.playTitle, layout.playLabel, `${name}: play tooltip must match its label.`);
    assert.equal(layout.horizontalOverflow, false, `${name}: page must not overflow horizontally.`);
    assert.equal(layout.verticalOverflow, false, `${name}: page must not overflow vertically.`);
    assert.equal(layout.panelPrefixCount, 0, `${name}: panel number prefixes must be absent.`);
    assert.equal(
        layout.panelTitlesUseOwnRows,
        true,
        `${name}: panel titles must occupy their own header rows.`,
    );
    assert.equal(layout.sourceCountBadges, 0, `${name}: editor must not show a line count badge.`);
    assert.equal(
        layout.maximizeButtonsEndRows,
        true,
        `${name}: every visible maximize button must end its action row.`,
    );
    assert.ok(
        layout.previewViewport.top >= layout.previewStage.top &&
            layout.previewViewport.right <= layout.previewStage.right &&
            layout.previewViewport.bottom <= layout.previewStage.bottom &&
            layout.previewViewport.left >= layout.previewStage.left,
        `${name}: preview viewport must fit inside the preview stage.`,
    );

    if (mode === 'portrait-dock') {
        assert.ok(
            layout.headerActionAlignment.every((alignment) => alignment === 'flex-start'),
            `${name}: desktop header action rows must be left aligned.`,
        );
        assert.ok(
            layout.graphNode.top >= layout.graphCanvas.top &&
                layout.graphNode.bottom <= layout.graphCanvas.bottom,
            `${name}: layer node must fit inside the graph canvas.`,
        );
        assert.equal(layout.playInViewport, true, `${name}: play button must be in the viewport.`);
        assert.ok(
            layout.graph.right <= layout.preview.left && layout.editor.right <= layout.preview.left,
            `${name}: graph and editor must be left of the portrait preview.`,
        );
        assert.ok(
            layout.graph.bottom <= layout.editor.top,
            `${name}: graph must be above the editor.`,
        );
    } else {
        assert.ok(layout.graph.width > 0, 'mobile: graph tab must be selected initially.');
        assert.equal(layout.editor.width, 0, 'mobile: editor must start hidden behind its tab.');
        assert.equal(layout.preview.width, 0, 'mobile: preview starts hidden behind its tab.');
        const mobileEdges = await session.evaluate<{
            workspacePaddingLeft: string;
            workspacePaddingRight: string;
            panelLeft: number;
            panelRight: number;
            panelTopRadius: string;
            tabsBottom: number;
            panelTop: number;
            toolbarLeft: number;
            toolbarRight: number;
            firstActionLeft: number;
            lastActionRight: number;
        }>(`
            const workspace = document.querySelector('.workspace');
            const panel = document.querySelector('.graph-panel');
            const tabs = document.querySelector('.mobile-workspace-tabs');
            const workspaceStyle = getComputedStyle(workspace);
            const panelStyle = getComputedStyle(panel);
            const panelBounds = panel.getBoundingClientRect();
            const toolbar = document.querySelector('.graph-panel .panel-header-actions');
            const toolbarBounds = toolbar.getBoundingClientRect();
            const actions = toolbar.children;
            return {
                workspacePaddingLeft: workspaceStyle.paddingLeft,
                workspacePaddingRight: workspaceStyle.paddingRight,
                panelLeft: panelBounds.left,
                panelRight: panelBounds.right,
                panelTopRadius: panelStyle.borderTopLeftRadius,
                tabsBottom: tabs.getBoundingClientRect().bottom,
                panelTop: panelBounds.top,
                toolbarLeft: toolbarBounds.left,
                toolbarRight: toolbarBounds.right,
                firstActionLeft: actions[0].getBoundingClientRect().left,
                lastActionRight: actions[actions.length - 1].getBoundingClientRect().right,
            };
        `);
        assert.equal(
            mobileEdges.workspacePaddingLeft,
            '0px',
            'mobile: workspace needs no left padding.',
        );
        assert.equal(
            mobileEdges.workspacePaddingRight,
            '0px',
            'mobile: workspace needs no right padding.',
        );
        assert.equal(mobileEdges.panelLeft, 0, 'mobile: panel must touch the left viewport edge.');
        assert.equal(
            mobileEdges.panelRight,
            layout.viewportWidth,
            'mobile: panel must touch the right viewport edge.',
        );
        assert.equal(mobileEdges.panelTopRadius, '0px', 'mobile: panel top edge must be square.');
        assert.equal(
            mobileEdges.panelTop,
            mobileEdges.tabsBottom,
            'mobile: panel must connect directly to tabs.',
        );
        assert.ok(
            Math.abs(mobileEdges.firstActionLeft - mobileEdges.toolbarLeft) < 1,
            'mobile: first header action must use the left edge.',
        );
        assert.ok(
            Math.abs(mobileEdges.lastActionRight - mobileEdges.toolbarRight) < 1,
            'mobile: last header action must use the right edge.',
        );
        const tabStyles = await session.evaluate<{
            role: string | null;
            activeBorder: string;
            inactiveBorder: string;
            activeBackground: string;
            inactiveBackground: string;
        }>(`
            const tablist = document.querySelector('.mobile-workspace-tabs');
            const active = tablist.querySelector('.is-active');
            const inactive = tablist.querySelector('button:not(.is-active)');
            const activeStyle = getComputedStyle(active);
            const inactiveStyle = getComputedStyle(inactive);
            return {
                role: tablist.getAttribute('role'),
                activeBorder: activeStyle.borderBottomColor,
                inactiveBorder: inactiveStyle.borderBottomColor,
                activeBackground: activeStyle.backgroundColor,
                inactiveBackground: inactiveStyle.backgroundColor,
            };
        `);
        assert.equal(tabStyles.role, 'tablist', 'mobile: view switcher must be a tab list.');
        assert.notEqual(
            tabStyles.activeBorder,
            tabStyles.inactiveBorder,
            'mobile: active tab must use an underline indicator.',
        );
        assert.equal(
            tabStyles.activeBackground,
            tabStyles.inactiveBackground,
            'mobile: active tab must not look like a filled button.',
        );
        await session.click('[data-testid="mobile-graph-tab"]');
        await session.waitForElement('.graph-panel .joint-element', 5_000);
        const graphTab = await session.evaluate<{
            panelHeight: number;
            nodeHeight: number;
            previewWidth: number;
        }>(`
            return {
                panelHeight: document.querySelector('.graph-panel').getBoundingClientRect().height,
                nodeHeight: document.querySelector('.graph-panel .joint-element').getBoundingClientRect().height,
                previewWidth: document.querySelector('.preview-panel').getBoundingClientRect().width,
            };
        `);
        assert.ok(
            graphTab.panelHeight > 0 && graphTab.nodeHeight > 0,
            'mobile: graph tab must show the graph.',
        );
        assert.equal(graphTab.previewWidth, 0, 'mobile: graph tab must hide the preview.');
        await session.screenshot(join(outputDirectory, 'mobile-graph.png'), true);

        await session.click('[data-testid="mobile-editor-tab"]');
        const editorTab = await session.evaluate<{ editorHeight: number; graphWidth: number }>(`
            return {
                editorHeight: document.querySelector('.editor-panel').getBoundingClientRect().height,
                graphWidth: document.querySelector('.graph-panel').getBoundingClientRect().width,
            };
        `);
        assert.ok(editorTab.editorHeight > 0, 'mobile: editor tab must show the node settings.');
        assert.equal(editorTab.graphWidth, 0, 'mobile: editor tab must hide the graph.');
        await session.screenshot(join(outputDirectory, 'mobile-editor.png'), true);
        await session.click('[data-testid="mobile-preview-tab"]');
    }
    await session.screenshot(join(outputDirectory, `${name}.png`), true);
}

export async function verifyResizableWorkspace(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.evaluate(`localStorage.removeItem('browser-testbench-director.layout');`);
    await session.refresh();
    await session.waitForElement('[data-testid="outer-splitter"]', 10_000);
    const beforeResize = await panelWidths(session);
    await session.press('\uE014', '[data-testid="outer-splitter"]');
    const afterResize = await panelWidths(session);
    assert.ok(
        afterResize.graph > beforeResize.graph,
        'workspace: moving the outer splitter must resize the tool column.',
    );

    for (const panel of ['preview', 'editor', 'graph'] as const) {
        await verifyPanelMaximization(session, panel);
    }
    const restored = await panelWidths(session);
    assert.ok(
        Math.abs(restored.graph - afterResize.graph) < 2,
        'workspace: restoring tools must preserve the previous split.',
    );
    await session.refresh();
    await session.waitForElement('[data-testid="outer-splitter"]', 10_000);
    const persisted = await panelWidths(session);
    assert.ok(
        Math.abs(persisted.graph - afterResize.graph) < 2,
        'workspace: the resized split must survive a reload.',
    );
}

export async function verifyPanelMaximization(
    session: RemoteSession,
    panel: 'preview' | 'graph' | 'editor',
): Promise<void> {
    await session.click(`[data-testid="maximize-${panel}"]`);
    const maximized = await session.evaluate<{
        selectedWidth: number;
        selectedHeight: number;
        visiblePanels: number;
        workspaceWidth: number;
        workspaceLeft: number;
        panelLeft: number;
        exitIcon: boolean;
    }>(`
        const selected = document.querySelector('.${panel}-panel').getBoundingClientRect();
        const workspaceElement = document.querySelector('.workspace');
        const workspace = workspaceElement.getBoundingClientRect();
        const workspaceStyle = getComputedStyle(workspaceElement);
        const paddingLeft = parseFloat(workspaceStyle.paddingLeft);
        const paddingRight = parseFloat(workspaceStyle.paddingRight);
        const visiblePanels = [...document.querySelectorAll('.workspace > .panel')]
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }).length;
        return {
            selectedWidth: selected.width,
            selectedHeight: selected.height,
            visiblePanels,
            workspaceWidth: workspace.width - paddingLeft - paddingRight,
            workspaceLeft: workspace.left + paddingLeft,
            panelLeft: selected.left,
            exitIcon: Boolean(document.querySelector('[data-testid="maximize-${panel}"] .fullscreen-icon.is-exit')),
        };
    `);
    assert.equal(maximized.visiblePanels, 1, `${panel}: only the maximized panel must remain.`);
    assert.ok(
        Math.abs(maximized.selectedWidth - maximized.workspaceWidth) < 2,
        `${panel}: maximized panel must fill the workspace.`,
    );
    assert.ok(
        maximized.selectedHeight > 700,
        `${panel}: maximized panel must use the full height.`,
    );
    assert.ok(
        Math.abs(maximized.panelLeft - maximized.workspaceLeft) < 2,
        `${panel}: maximized panel must begin at the workspace edge.`,
    );
    assert.equal(maximized.exitIcon, true, `${panel}: button must switch to fullscreen exit.`);
    if (panel === 'graph') {
        await session.click('[data-testid="graph-canvas"]');
        const staysMaximized = await session.evaluate<boolean>(`
            return document.querySelector('.workspace').classList.contains('workspace--maximized-graph');
        `);
        assert.equal(
            staysMaximized,
            true,
            'graph: deselecting on the empty paper must preserve fullscreen.',
        );
    }
    await session.screenshot(join(outputDirectory, `${panel}-maximized.png`), true);
    await session.click(`[data-testid="maximize-${panel}"]`);
}

async function panelWidths(session: RemoteSession): Promise<{ graph: number; preview: number }> {
    return session.evaluate(`
        return {
            graph: document.querySelector('.graph-panel').getBoundingClientRect().width,
            preview: document.querySelector('.preview-panel').getBoundingClientRect().width,
        };
    `);
}
