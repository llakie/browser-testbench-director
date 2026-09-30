import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { clickPreviewWebsiteElement, selectGraphNode } from '../support/director-ui.js';
import { applicationUrl, outputDirectory, testbench } from '../support/ui-verification-context.js';

export async function verifyMobileMenu(session: RemoteSession): Promise<void> {
    await session.setViewport(390, 844);
    const header = await session.evaluate<{
        desktopActionsWidth: number;
        triggerWidth: number;
        titleTop: number;
        titleBottom: number;
        headerTop: number;
        headerBottom: number;
    }>(`
        const bounds = selector => document.querySelector(selector).getBoundingClientRect();
        const header = bounds('.topbar');
        const title = bounds('.project-title');
        return {
            desktopActionsWidth: bounds('.file-actions').width,
            triggerWidth: bounds('[data-testid="open-mobile-menu"]').width,
            titleTop: title.top,
            titleBottom: title.bottom,
            headerTop: header.top,
            headerBottom: header.bottom,
        };
    `);
    assert.equal(header.desktopActionsWidth, 0, 'mobile menu: desktop actions must be hidden.');
    assert.ok(header.triggerWidth > 0, 'mobile menu: hamburger trigger must be visible.');
    assert.ok(
        header.titleTop >= header.headerTop && header.titleBottom <= header.headerBottom,
        'mobile menu: project title must remain in the header row.',
    );

    await session.click('[data-testid="open-mobile-menu"]');
    await session.waitForElement('[data-testid="mobile-menu-backdrop"]', 5_000);
    const menu = await session.evaluate<{
        labels: string[];
        left: number;
        right: number;
        top: number;
        bottom: number;
        width: number;
        viewportWidth: number;
        viewportHeight: number;
    }>(`
        const menu = document.querySelector('.mobile-project-menu');
        const rect = menu.getBoundingClientRect();
        return {
            labels: [...menu.querySelectorAll('button span')].map(element => element.textContent.trim()),
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        };
    `);
    assert.equal(menu.labels.length, 6, 'mobile menu: all project actions must be available.');
    assert.ok(menu.width > 0 && menu.left >= 0 && menu.right <= menu.viewportWidth);
    assert.ok(menu.top >= 0 && menu.bottom <= menu.viewportHeight);
    await session.screenshot(join(outputDirectory, 'mobile-menu.png'), true);

    await session.click('[data-testid="mobile-open-project-settings"]');
    await session.waitForState('[data-testid="mobile-menu-backdrop"]', 'absent', 5_000);
    await session.waitForElement('[data-testid="project-settings-backdrop"]', 5_000);
    await session.evaluate(`
        document.querySelector('[data-testid="project-settings-backdrop"]')
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    `);
    await session.waitForState('[data-testid="project-settings-backdrop"]', 'absent', 5_000);

    await session.click('[data-testid="open-mobile-menu"]');
    await session.evaluate(`
        document.querySelector('.mobile-project-menu')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    `);
    await session.waitForState('[data-testid="mobile-menu-backdrop"]', 'absent', 5_000);

    await session.click('[data-testid="open-mobile-menu"]');
    await session.evaluate(`
        document.querySelector('[data-testid="mobile-menu-backdrop"]')
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    `);
    await session.waitForState('[data-testid="mobile-menu-backdrop"]', 'absent', 5_000);
}

export async function verifyEmptyProjectPlayback(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
    await session.click('[data-testid="play-workflow"]');
    await session.waitForScript(
        `const root = document.querySelector('[model-id="website-root"]');
        return root?.querySelector('[joint-selector="statusText"]')?.textContent === '!' &&
            Boolean(document.querySelector('[data-testid="play-workflow"]'));`,
        [],
        5_000,
    );
    const state = await session.evaluate<{
        nestedWebsite: boolean;
        previewBackground: string;
        responsive: boolean;
        rootStatus: string;
        rootStroke: string;
        notice: string;
    }>(`
        const frame = document.querySelector('.preview-viewport iframe');
        const preview = frame?.contentDocument;
        const root = document.querySelector('[model-id="website-root"]');
        return {
            nestedWebsite: Boolean(preview?.querySelector('.director-website')),
            previewBackground: preview ? getComputedStyle(preview.body).backgroundColor : '',
            responsive: Boolean(document.querySelector('[data-testid="play-workflow"]')),
            rootStatus: root?.querySelector('[joint-selector="statusText"]')?.textContent ?? '',
            rootStroke: root?.querySelector('[joint-selector="outline"]')?.getAttribute('stroke') ?? '',
            notice: document.querySelector('.notice')?.textContent?.trim() ?? '',
        };
    `);
    assert.equal(
        state.nestedWebsite,
        false,
        'empty project: playback must not proxy the Director itself.',
    );
    assert.equal(
        state.previewBackground,
        'rgb(255, 255, 255)',
        'empty project: playback stays white.',
    );
    assert.equal(
        state.responsive,
        true,
        'empty project: playback must leave the Director responsive.',
    );
    assert.equal(
        state.rootStatus,
        '!',
        'empty project: the invalid website root must show an error.',
    );
    assert.equal(
        state.rootStroke,
        'var(--color-status-error)',
        'empty project: the root must use the standard node error outline.',
    );
    assert.match(
        state.notice,
        /Website-URL|website URL/u,
        'empty project: playback explains the missing URL.',
    );
}

export async function verifyFlyoutCollision(session: RemoteSession): Promise<void> {
    await session.setViewport(390, 844);
    await session.click('[data-testid="mobile-graph-tab"]');
    await session.click('[data-testid="node-actions-trigger"]');
    await session.waitForElement('.action-flyout__menu', 5_000);
    const bounds = await session.evaluate<{
        left: number;
        top: number;
        right: number;
        bottom: number;
        viewportWidth: number;
        viewportHeight: number;
    }>(`
        const menu = document.querySelector('.action-flyout__menu').getBoundingClientRect();
        return {
            left: menu.left,
            top: menu.top,
            right: menu.right,
            bottom: menu.bottom,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        };
    `);
    assert.ok(bounds.left >= 7, `flyout: left edge must remain visible (${bounds.left}).`);
    assert.ok(
        bounds.right <= bounds.viewportWidth - 7,
        `flyout: right edge must remain visible (${bounds.right}/${bounds.viewportWidth}).`,
    );
    assert.ok(bounds.top >= 7, `flyout: top edge must remain visible (${bounds.top}).`);
    assert.ok(
        bounds.bottom <= bounds.viewportHeight - 7,
        `flyout: bottom edge must remain visible (${bounds.bottom}/${bounds.viewportHeight}).`,
    );
    await session.screenshot(join(outputDirectory, 'flyout-viewport-collision.png'), true);
    await session.click('[data-testid="node-actions-trigger"]');
}

export async function verifyMcpSetup(session: RemoteSession): Promise<void> {
    await session.setViewport(390, 844);
    await session.click('[data-testid="open-mobile-menu"]');
    await session.click('[data-testid="mobile-open-mcp-setup"]');
    await session.waitForElement('.mcp-client', 10_000);
    const overlay = await session.evaluate<{ labels: string[]; blur: string }>(`
        const backdrop = document.querySelector('[data-testid="mcp-setup-backdrop"]');
        return {
            labels: [...document.querySelectorAll('.mcp-client strong')]
                .map(element => element.textContent.trim()),
            blur: getComputedStyle(backdrop).backdropFilter,
        };
    `);
    assert.ok(overlay.labels.includes('Codex'), 'mcp: setup must include Codex.');
    assert.ok(overlay.labels.includes('Claude Code'), 'mcp: setup must include Claude Code.');
    assert.notEqual(overlay.blur, 'none', 'overlay: backdrop must blur the workspace.');
    await session.evaluate(`
        document.querySelector('[data-testid="mcp-setup-backdrop"]')
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    `);
    const closed = await session.evaluate<boolean>(`
        return document.querySelector('[data-testid="mcp-setup-backdrop"]') === null;
    `);
    assert.equal(closed, true, 'overlay: backdrop pointer action must close the dialog.');
    await session.setViewport(1440, 1000);
}

export async function verifySelectorPicker(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create('Selector picker');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = applicationUrl;
    project.nodes = [
        website,
        {
            id: 'pick-action',
            type: 'browser-action',
            name: 'Pick action',
            position: null,
            selector: 'body',
        },
    ];
    project.connections = [
        { id: 'website-root--pick-action', source: 'website-root', target: 'pick-action' },
    ];
    const projectPath = join(outputDirectory, 'selector-picker.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForElement(
        '[data-testid="graph-canvas"] .joint-element[model-id="pick-action"]',
        10_000,
    );
    await selectGraphNode(session, 'pick-action');
    await session.waitForElement('[data-testid="pick-browser-action-selector"]', 5_000);
    await session.click('[data-testid="viewport-device-trigger"]');
    await session.waitForElement('.device-flyout__menu .target-option', 10_000);
    const previewTargetId = await session.evaluate<string>(`
        return [...document.querySelectorAll('.device-flyout__menu .target-option')]
            .find(target => !target.disabled)?.dataset.testid.replace('remote-target-', '') || '';
    `);
    assert.ok(previewTargetId, 'selector picker: a remote preview target must be available.');
    await session.click(`[data-testid="remote-target-${previewTargetId}"]`);
    await session.waitForElement('.remote-preview-placeholder', 10_000);
    await session.waitForScript(
        `return /geöffnet|Opened preview/u.test(
            document.querySelector('.notice')?.textContent || ''
        );`,
        [],
        30_000,
    );
    await session.waitForState('[data-testid="pick-browser-action-selector"]', 'enabled', 15_000);
    const existingSessions = new Set((await testbench.sessions()).map((candidate) => candidate.id));
    await session.click('[data-testid="pick-browser-action-selector"]');

    let pickerSession: RemoteSession | undefined;

    for (let attempt = 0; attempt < 80 && !pickerSession; attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
        pickerSession = (await testbench.sessions()).find(
            (candidate) => !existingSessions.has(candidate.id),
        );
    }

    assert.ok(pickerSession, 'selector picker: a remote picking session must open.');

    try {
        await pickerSession.waitForScript(
            `return window.__directorSelectorPicker?.status === 'picking';`,
            [],
            15_000,
        );
    } catch (error) {
        const notice = await session.evaluate<string>(
            `return document.querySelector('.notice')?.textContent?.trim() || '';`,
        );
        throw new Error(`Selector picker did not start. Director notice: ${notice}`, {
            cause: error,
        });
    }

    const pickerState = await pickerSession.evaluate<{
        status: string | null;
        url: string;
        title: string;
    }>(`
        return {
            status: window.__directorSelectorPicker?.status || null,
            url: location.href,
            title: document.title,
        };
    `);
    assert.equal(
        pickerState.status,
        'picking',
        `selector picker: remote session did not enter picking mode (${JSON.stringify(pickerState)}).`,
    );
    await clickPreviewWebsiteElement(pickerSession, '#project-name');
    await session.waitForValue('[data-testid="browser-action-selector"]', '#project-name', 10_000);
    await pickerSession.close().catch(() => undefined);
    await session.click('[data-testid="new-project"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}
