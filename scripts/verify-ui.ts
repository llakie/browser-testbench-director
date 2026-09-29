import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RemoteTestbench, type RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../src/ui/client/core/project-format.js';
import { playGraphNode, selectGraphNode } from './support/director-ui.js';

const applicationUrl = process.env['DIRECTOR_UI_URL'] ?? 'http://127.0.0.1:5173/';
const server = process.env['BROWSER_TESTBENCH_URL'] ?? 'http://127.0.0.1:55808';
const target = process.env['BROWSER_TESTBENCH_TARGET'] ?? 'chrome';
const outputDirectory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-ui-'));
const testbench = new RemoteTestbench({ server, requestTimeoutMs: 30_000 });
const browser = await testbench.open({
    target,
    url: applicationUrl,
    headless: true,
    downloadDir: outputDirectory,
    lockTimeoutMs: 15_000,
    ...(applicationUrl.startsWith('https://')
        ? { capabilities: { acceptInsecureCerts: true } }
        : {}),
});

try {
    await browser.waitForElement('.workspace', 10_000);
    await verifyEmptyProjectPlayback(browser);
    await verifyLayout(browser, 'desktop', 1440, 1000, 'portrait-dock');
    await verifyLayout(browser, 'tablet', 1024, 900, 'portrait-dock');
    await verifyLayout(browser, 'mobile', 390, 844, 'mobile-tabs');
    await verifyMobileMenu(browser);
    await verifyFlyoutCollision(browser);
    await verifyPreviewDevices(browser);
    await verifyMcpSetup(browser);
    await verifySelectorPicker(browser);
    await verifyRecordingExport(browser);
    await verifyLayerSelectionAndZoom(browser);
    await verifyGraphAutoLayout(browser);
    await verifyJavaScriptNode(browser);
    await verifyResizableWorkspace(browser);
    await verifyEditableConnections(browser);
    await verifyNodeEditing(browser);
    await verifyRuntimeDataFlow(browser);
    await verifyCameraSessionConfiguration(browser);
    await verifyExecutionControls(browser);
    await verifyPlayback(browser);
    await verifyPlacement(browser);
    await verifyProjectRoundtrip(browser);
    await verifyLandscapeDock(browser);
    const diagnostics = await browser.diagnostics();
    const severeDiagnostics = diagnostics.filter(
        (entry) =>
            entry.type === 'console' &&
            ['error', 'assert', 'severe'].includes(entry.level?.toLowerCase() ?? ''),
    );
    assert.deepEqual(severeDiagnostics, [], 'The UI emitted browser console errors.');
    process.stdout.write(
        `Browser Testbench UI verification passed.\nScreenshots: ${outputDirectory}\n`,
    );
} finally {
    await browser.close().catch(() => undefined);
}

async function verifyMobileMenu(session: RemoteSession): Promise<void> {
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

async function verifyEmptyProjectPlayback(session: RemoteSession): Promise<void> {
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

async function verifyFlyoutCollision(session: RemoteSession): Promise<void> {
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

async function verifyMcpSetup(session: RemoteSession): Promise<void> {
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

async function verifySelectorPicker(session: RemoteSession): Promise<void> {
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
    await pickerSession.click('#project-name');
    await session.waitForValue('[data-testid="browser-action-selector"]', '#project-name', 10_000);
    await pickerSession.close().catch(() => undefined);
    await session.click('[data-testid="new-project"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function verifyGraphAutoLayout(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create('Auto layout');
    project.nodes.unshift(
        {
            id: 'input-a',
            type: 'input',
            name: 'Input A',
            position: null,
            accept: 'image/*',
            required: true,
        },
        {
            id: 'input-b',
            type: 'input',
            name: 'Input B',
            position: null,
            accept: 'image/*',
            required: true,
        },
    );
    project.connections.push(
        { id: 'input-a--website-root', source: 'input-a', target: 'website-root' },
        { id: 'input-b--website-root', source: 'input-b', target: 'website-root' },
    );
    let previousId = 'layer-1';
    for (let index = 2; index <= 14; index += 1) {
        const id = `auto-node-${index}`;
        project.nodes.push({
            id,
            type: 'javascript',
            name: `Auto ${index}`,
            position: { x: index * 280, y: 8 },
            source: '',
        });
        project.connections.push({
            id: `${previousId}--${id}`,
            source: previousId,
            target: id,
        });
        previousId = id;
    }
    const projectPath = join(outputDirectory, 'auto-layout.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 17, 5_000);

    await session.click('[data-testid="auto-layout-graph"]');
    await session.waitForScript(
        `return /kompakt angeordnet|arranged compactly/iu.test(
            document.querySelector('.notice')?.textContent || ''
        );`,
        [],
        5_000,
    );
    const layout = await session.evaluate<{
        rowCount: number;
        routeCount: number;
        allNodesInsideCanvas: boolean;
        nodeHeadersCovered: boolean;
        routeObstructions: string[];
        rootInputPortCount: number;
    }>(`
        const canvas = document.querySelector('[data-testid="graph-canvas"]').getBoundingClientRect();
        const nodeElements = [...document.querySelectorAll(
            '[data-testid="graph-canvas"] .joint-element'
        )];
        const nodes = nodeElements.map((element) => element.getBoundingClientRect());
        const rows = new Set(nodes.map((node) => Math.round(node.top)));
        const connections = ${JSON.stringify(project.connections)};
        const routeObstructions = connections.flatMap((connection) => {
            const link = document.querySelector(
                '.joint-link[model-id="' + CSS.escape(connection.id) + '"] [joint-selector="line"]'
            );
            if (!link) return [connection.id + ':missing-path'];
            const matrix = link.getScreenCTM();
            const length = link.getTotalLength();
            if (!matrix || length <= 8) return [connection.id + ':invalid-path'];
            for (let distance = 4; distance < length - 4; distance += 4) {
                const local = link.getPointAtLength(distance);
                const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
                const crossedNode = nodeElements.find((element) => {
                    const id = element.getAttribute('model-id');
                    if (id === connection.source || id === connection.target) return false;
                    const bounds = element.getBoundingClientRect();
                    return point.x > bounds.left + 1 && point.x < bounds.right - 1 &&
                        point.y > bounds.top + 1 && point.y < bounds.bottom - 1;
                });
                if (crossedNode) {
                    return [connection.id + ':' + crossedNode.getAttribute('model-id')];
                }
            }
            return [];
        });
        const root = document.querySelector('.joint-element[model-id="website-root"]');
        const rootBounds = root.getBoundingClientRect();
        const nodeHeadersCovered = nodeElements.every((element) => {
            const header = element.querySelector('[joint-selector="header"]');
            const outline = element.querySelector('[joint-selector="outline"]');
            if (!(header instanceof SVGGraphicsElement) || !(outline instanceof SVGGraphicsElement)) {
                return false;
            }
            const headerBounds = header.getBBox();
            const outlineBounds = outline.getBBox();
            return Math.abs(headerBounds.x - outlineBounds.x) < 0.1 &&
                Math.abs(headerBounds.y - outlineBounds.y) < 0.1 &&
                Math.abs(headerBounds.width - outlineBounds.width) < 0.1 &&
                Boolean(header.compareDocumentPosition(outline) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        const rootInputPortCount = [...root.querySelectorAll('.joint-port')]
            .map((port) => port.getBoundingClientRect())
            .filter((port) => Math.abs((port.left + port.right) / 2 - rootBounds.left) < 3)
            .length;
        return {
            rowCount: rows.size,
            routeCount: document.querySelectorAll('[data-testid="graph-canvas"] .joint-link').length,
            allNodesInsideCanvas: nodes.every((node) =>
                node.left >= canvas.left - 1 && node.right <= canvas.right + 1 &&
                node.top >= canvas.top - 1 && node.bottom <= canvas.bottom + 1
            ),
            nodeHeadersCovered,
            routeObstructions,
            rootInputPortCount,
        };
    `);
    assert.ok(layout.rowCount > 1, 'auto layout: a long workflow must wrap into multiple rows.');
    assert.equal(
        layout.routeCount,
        project.connections.length,
        'auto layout: every edge needs a route.',
    );
    assert.equal(
        layout.allNodesInsideCanvas,
        true,
        'auto layout: fitted nodes must stay in the canvas.',
    );
    assert.deepEqual(layout.routeObstructions, [], 'routing: edges must avoid unrelated nodes.');
    assert.equal(
        layout.nodeHeadersCovered,
        true,
        'graph: every node header must span the top edge beneath one continuous outline.',
    );
    assert.equal(
        layout.rootInputPortCount,
        2,
        'routing: concurrent inputs need separate ports on the website root.',
    );
    await session.screenshot(join(outputDirectory, 'graph-auto-layout.png'), true);

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function verifyPreviewDevices(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    await session.waitForElement('[data-testid="viewport-device-trigger"]', 10_000);
    await session.click('[data-testid="viewport-device-trigger"]');
    await session.waitForElement('.device-flyout__menu', 5_000);
    await session.waitForElement('.device-flyout__menu .target-option', 10_000);
    const destinations = await session.evaluate<{
        presets: number;
        targets: Array<{ id: string; disabled: boolean }>;
        width: number;
    }>(`
        const menu = document.querySelector('.device-flyout__menu');
        return {
            presets: menu.querySelectorAll('.device-option').length,
            targets: [...menu.querySelectorAll('.target-option')].map(target => ({
                id: target.dataset.testid.replace('remote-target-', ''),
                disabled: target.disabled,
            })),
            width: menu.getBoundingClientRect().width,
        };
    `);
    assert.equal(destinations.presets, 5, 'devices: all local viewport presets must be listed.');
    assert.ok(
        destinations.targets.length > 0,
        'devices: running Testbench targets share the menu.',
    );
    assert.ok(destinations.width >= 320, 'devices: destination details need a readable menu.');
    const remoteTarget = destinations.targets.find((target) => !target.disabled)?.id;
    assert.ok(remoteTarget, 'devices: at least one remote preview target must be ready.');
    await session.click('[data-testid="viewport-device-trigger"]');

    await session.click('[data-testid="record-workflow"]');
    await session.waitForElement('.recording-flyout__menu', 5_000);
    const recordingTargets = await session.evaluate<number>(`
        return document.querySelectorAll('.recording-target-option:not(:disabled)').length;
    `);
    assert.ok(recordingTargets > 0, 'recording: the reduced menu lists usable targets only.');
    await session.click('[data-testid="record-workflow"]');

    await session.evaluate(`
        window.__directorOriginalFetch = window.fetch;
        window.__directorOpenRequest = null;
        window.fetch = async (input, init = {}) => {
            if (String(input).endsWith('/browser-testbench-api/sessions')) {
                window.__directorOpenRequest = JSON.parse(init.body);
                return new Response(JSON.stringify({ id: 'ui-test-session' }), {
                    status: 201,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (String(input).includes('/browser-testbench-api/sessions/ui-test-session/browser')) {
                return new Response(JSON.stringify({ completed: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (String(input).endsWith('/browser-testbench-api/sessions/ui-test-session/wait')) {
                return new Response(JSON.stringify({ completed: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (
                String(input).endsWith('/browser-testbench-api/sessions/ui-test-session') &&
                init.method === 'DELETE'
            ) {
                return new Response(null, { status: 204 });
            }
            return window.__directorOriginalFetch(input, init);
        };
    `);
    await session.click('[data-testid="viewport-device-trigger"]');
    await session.click(`[data-testid="remote-target-${remoteTarget}"]`);
    await session.waitForElement('.remote-preview-placeholder', 5_000);
    await session.waitForScript('return window.__directorOpenRequest !== null;', [], 5_000);
    const remoteState = await session.evaluate<{
        url: string;
        iframeCount: number;
        title: string;
        stopLabel: string;
        backgroundImage: string;
    }>(`
        const placeholder = document.querySelector('.remote-preview-placeholder');
        const stage = document.querySelector('.preview-stage');
        return {
            url: window.__directorOpenRequest.url,
            iframeCount: document.querySelectorAll('.preview-viewport iframe').length,
            title: placeholder.querySelector('strong').textContent.trim(),
            stopLabel: document.querySelector('[data-testid="stop-remote-preview"]').textContent.trim(),
            backgroundImage: getComputedStyle(stage).backgroundImage,
        };
    `);
    assert.match(
        remoteState.url,
        /\/director-preview\/nodes\/preview-state\//u,
        'devices: remote selection mirrors the last preview state through a virtual route.',
    );
    assert.equal(remoteState.iframeCount, 0, 'devices: remote preview uses a clear placeholder.');
    assert.match(remoteState.title, /^Vorschau auf /u, 'devices: remote target is named clearly.');
    assert.equal(remoteState.stopLabel, 'Vorschau beenden');
    assert.equal(remoteState.backgroundImage, 'none', 'devices: preview uses a solid background.');

    await session.click('[data-testid="viewport-device-trigger"]');
    await session.click('[data-testid="viewport-device-phone-landscape"]');
    await session.waitForElement('.preview-viewport iframe', 5_000);
    await session.waitForText('640 × 360 CSS', 5_000);
    await session.evaluate(`
        window.fetch = window.__directorOriginalFetch;
        delete window.__directorOriginalFetch;
        delete window.__directorOpenRequest;
    `);

    await session.click('[data-testid="viewport-device-trigger"]');
    const portraitOption = await session.evaluate<{
        option: { top: number; bottom: number; width: number };
        menu: { top: number; bottom: number };
        disabled: boolean;
        frontmost: boolean;
    }>(`
        const option = document.querySelector('[data-testid="viewport-device-phone-portrait"]');
        const menu = document.querySelector('.device-flyout__menu');
        const optionBounds = option.getBoundingClientRect();
        const menuBounds = menu.getBoundingClientRect();
        const frontmost = document.elementFromPoint(
            optionBounds.left + optionBounds.width / 2,
            optionBounds.top + optionBounds.height / 2,
        )?.closest('[data-testid="viewport-device-phone-portrait"]') === option;
        option.click();
        return {
            option: { top: optionBounds.top, bottom: optionBounds.bottom, width: optionBounds.width },
            menu: { top: menuBounds.top, bottom: menuBounds.bottom },
            disabled: option.disabled,
            frontmost,
        };
    `);
    assert.equal(portraitOption.disabled, false, 'devices: local presets remain selectable.');
    assert.ok(
        portraitOption.option.width > 0 &&
            portraitOption.option.top >= portraitOption.menu.top &&
            portraitOption.option.bottom <= portraitOption.menu.bottom,
        `devices: preset must remain inside the flyout (${JSON.stringify(portraitOption)}).`,
    );
    assert.equal(
        portraitOption.frontmost,
        true,
        `devices: flyout must stay above adjacent panels (${JSON.stringify(portraitOption)}).`,
    );
    await session.waitForText('360 × 640 CSS', 5_000);
}

async function verifyLayerSelectionAndZoom(session: RemoteSession): Promise<void> {
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
    await session.click('[data-testid="browser-session-permissions"]');
    await session.waitForElement('[data-testid="browser-session-permission-microphone"]', 5_000);
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

interface DOMRectSnapshot {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
}

async function verifyLayout(
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

async function verifyResizableWorkspace(session: RemoteSession): Promise<void> {
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

async function verifyPanelMaximization(
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

async function verifyPlacement(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create('Anchoring');
    const website = project.nodes.find((node) => node.type === 'website')!;
    const parent = project.nodes.find((node) => node.type === 'layer')!;
    website.url = `${applicationUrl}example-site.html`;
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
        maximizeEndsRow: boolean;
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
            maximizeEndsRow: Math.abs(maximizeBounds.right - headerBounds.right) < 20,
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
    assert.equal(
        alignmentGeometry.maximizeEndsRow,
        true,
        'placement: maximize must be the only control aligned to the right edge.',
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

async function verifyPlayback(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create('Playback');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = `${applicationUrl}example-site.html`;
    const projectPath = join(outputDirectory, 'playback.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 5_000);
    await playGraphNode(session, 'website-root');
    await session.waitForScript(
        `const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
        const website = preview?.querySelector('.director-website')?.contentDocument;
        return Boolean(
            website?.querySelector('#example-website') &&
            document.querySelector(
                '[model-id="website-root"] [joint-selector="statusText"]'
            )?.textContent === '✓'
        );`,
        [],
        5_000,
    );
    await playGraphNode(session, 'layer-1');
    await session.switchFrame('.preview-viewport iframe');
    await session.waitForElement('.director-layer', 5_000);
    await session.switchFrame();
    await session.waitForCount('[data-testid="play-workflow"]', 1, 10_000);
}

async function verifyExecutionControls(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create('Execution controls');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = `${applicationUrl}example-site.html`;
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.name = 'Execution state test';
    layer.source.html = '<div id="execution-state-test">Running</div>';
    layer.source.css = '#execution-state-test { padding: 2rem; background: white; color: black; }';
    layer.source.javascript = `
director.root.querySelector('#execution-state-test').dataset.started = 'true';
await director.wait(3000);
director.root.querySelector('#execution-state-test').dataset.completed = 'true';`;
    const projectPath = join(outputDirectory, 'execution-state.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'Execution controls', 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 5_000);
    await selectGraphNode(session, 'layer-1');

    await playGraphNode(session, 'layer-1');
    await session.waitForCount('[data-testid="stop-workflow"]', 1, 5_000);
    await session.waitForElement('[model-id="layer-1"]', 5_000);
    const running = await session.evaluate<{
        animation: string;
        ring: string;
    }>(`
        const node = document.querySelector('[model-id="layer-1"]');
        const ring = node.querySelector('circle.graph-node-status');
        return {
            animation: ring ? getComputedStyle(ring).animationName : 'missing',
            ring: node.outerHTML,
        };
    `);
    assert.match(running.ring, /is-running/u, 'execution: active node needs a running state.');
    assert.notEqual(
        running.animation,
        'none',
        'execution: active node needs an animated throbber.',
    );
    await session.screenshot(join(outputDirectory, 'execution-running.png'), true);
    await session.click('[data-testid="stop-preview-execution"]');
    await session.waitForElement(
        '[model-id="layer-1"] [joint-selector="statusRing"].is-cancelled',
        5_000,
    );
    await session.waitForCount('[data-testid="play-workflow"]', 1, 5_000);

    await session.click('#source-tab-javascript');
    await session.evaluate(`
        const editor = document.querySelector('.source-editor textarea');
        editor.value = "await director.wait(200); throw new Error('Expected execution failure');";
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await playGraphNode(session, 'layer-1');
    await session.waitForCount('[data-testid="stop-workflow"]', 1, 5_000);
    await session.waitForCount('[data-testid="play-workflow"]', 1, 5_000);
    await session.waitForElement('[model-id="layer-1"]', 5_000);
    const failedNode = await session.evaluate<string>(`
        return document.querySelector('[model-id="layer-1"]').outerHTML;
    `);
    assert.match(failedNode, /is-error/u, 'execution: a failure must stay attached to its node.');
    await session.waitForText('Expected execution failure', 5_000);

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function verifyNodeEditing(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="add-javascript-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);
    await session.waitForElement('.source-editor textarea', 5_000);
    await session.fill('[data-testid="node-name"]', 'Prepare GTP');
    await session.fill('.source-editor textarea', "document.body.dataset.prepared = 'true';");
    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="duplicate-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    assert.match(
        (await session.state('[data-testid="node-name"]')).value ?? '',
        /Prepare GTP – (Kopie|copy)/u,
        'nodes: a duplicate needs a localized copy name.',
    );
    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="add-layer-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    await session.waitForElement('#source-tab-html', 5_000);
    assert.match(
        (await session.state('[data-testid="node-name"]')).value ?? '',
        /Neuer Layer|New layer/u,
        'nodes: a new layer needs its localized default name.',
    );
    await session.fill('[data-testid="layer-duration"]', '1200');
    await session.click('[data-testid="layer-remove-after"]');
    assert.equal(
        await session.evaluate<boolean>(
            `return document.querySelector('[data-testid="layer-remove-after"]').checked;`,
        ),
        true,
        'nodes: a layer can be configured as a finite clip.',
    );
    const createdLayer = await session.evaluate<{ disconnected: boolean; editorHeight: number }>(`
        const selected = [...document.querySelectorAll('[data-testid="graph-canvas"] .joint-element')]
            .find((node) => node.querySelector('[joint-selector="outline"]')?.getAttribute('stroke-width') === '2');
        return {
            disconnected: selected?.querySelector('[joint-selector="outline"]')
                ?.getAttribute('stroke-dasharray') === '5 4',
            editorHeight: document.querySelector('.source-editor').getBoundingClientRect().height,
        };
    `);
    assert.equal(createdLayer.disconnected, true, 'nodes: a new node starts disconnected.');
    assert.ok(
        createdLayer.editorHeight > 100,
        'nodes: the source editor must retain usable space.',
    );
    await session.screenshot(join(outputDirectory, 'node-editing.png'), true);
    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="add-browser-action-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    await session.fill('[data-testid="browser-action-selector"]', '#open-camera');
    assert.equal(
        (await session.state('[data-testid="browser-action-selector"]')).value,
        '#open-camera',
        'nodes: a browser action selector must be editable.',
    );
    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="add-browser-wait-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    await session.fill('[data-testid="browser-wait-selector"]', '#camera-ready');
    await session.fill('[data-testid="browser-wait-timeout"]', '90000');
    assert.equal(
        await session.evaluate<boolean>(
            `return document.querySelector('[data-testid="browser-wait-omit-from-recording"]').checked;`,
        ),
        true,
        'nodes: wait times are omitted from recordings by default.',
    );
    await session.click('[data-testid="browser-wait-omit-from-recording"]');
    assert.equal(
        await session.evaluate<boolean>(
            `return document.querySelector('[data-testid="browser-wait-omit-from-recording"]').checked;`,
        ),
        false,
        'nodes: a wait can remain part of the recording.',
    );
    assert.equal(
        (await session.state('[data-testid="browser-wait-timeout"]')).value,
        '90000',
        'nodes: a browser wait timeout must be editable.',
    );
    await session.select('[data-testid="browser-wait-condition"]', 'url');
    await session.fill('[data-testid="browser-wait-url"]', '/price-check/value');
    await session.select('[data-testid="browser-wait-condition"]', 'script');
    await session.fill(
        '[data-testid="browser-wait-script"]',
        "return document.body ? { cardName: 'Pikachu' } : false;",
    );
    assert.match(
        (await session.state('[data-testid="browser-wait-script"]')).value ?? '',
        /cardName/u,
        'nodes: a script wait must retain its result-producing source.',
    );
    await session.setViewport(1440, 700);
    const propertiesScroll = await session.evaluate<{
        clientHeight: number;
        scrollHeight: number;
    }>(`
        const properties = document.querySelector('[data-testid="editor-properties-scroll"]');
        return {
            clientHeight: properties.clientHeight,
            scrollHeight: properties.scrollHeight,
        };
    `);
    assert.ok(
        propertiesScroll.scrollHeight > propertiesScroll.clientHeight,
        `nodes: properties must scroll when their content exceeds the panel (${JSON.stringify(propertiesScroll)}).`,
    );
    await session.press('\uE00F', '[data-testid="editor-properties-scroll"]');
    await session.waitForScript(
        `return document.querySelector('[data-testid="editor-properties-scroll"]').scrollTop > 0;`,
        [],
        5_000,
    );
    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function verifyRuntimeDataFlow(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create();
    const website = project.nodes.find((node) => node.type === 'website')!;
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    website.url = `${applicationUrl}example-site.html`;
    layer.position = { x: 1056, y: 8 };
    layer.source = {
        html: '<output id="data-flow-output"></output>',
        css: '#data-flow-output { color: white; }',
        javascript: `const result = director.results['recognized-card'];
const intro = director.results['intro-clip'];
director.root.querySelector('#data-flow-output').textContent = result.cardName;
director.root.dataset.result = result.cardName;
director.root.dataset.intro = intro.phase;`,
    };
    project.nodes = [
        website,
        {
            id: 'prepare-result',
            type: 'javascript',
            name: 'Prepare result',
            position: { x: 288, y: 8 },
            source: `const marker = document.createElement('div');
marker.id = 'recognized-marker';
marker.dataset.cardName = 'Pikachu';
document.body.append(marker);`,
        },
        {
            id: 'recognized-card',
            type: 'browser-wait',
            name: 'Recognized card',
            position: { x: 544, y: 8 },
            condition: 'script',
            script: `const marker = document.querySelector('#recognized-marker');
return marker ? { cardName: marker.dataset.cardName } : false;`,
            timeoutMs: 5_000,
            omitFromRecording: true,
        },
        {
            id: 'intro-clip',
            type: 'layer',
            name: 'Intro clip',
            position: { x: 800, y: 8 },
            placement: {
                reference: { type: 'viewport' },
                horizontal: 'center',
                vertical: 'center',
            },
            playback: { durationMs: 25, removeAfter: true },
            source: {
                html: '<div id="intro-clip">Intro</div>',
                css: '#intro-clip { color: white; }',
                javascript: `return { phase: 'complete' };`,
            },
        },
        layer,
    ];
    project.connections = [
        {
            id: 'website-root--prepare-result',
            source: 'website-root',
            target: 'prepare-result',
        },
        {
            id: 'prepare-result--recognized-card',
            source: 'prepare-result',
            target: 'recognized-card',
        },
        {
            id: 'recognized-card--intro-clip',
            source: 'recognized-card',
            target: 'intro-clip',
        },
        {
            id: 'intro-clip--layer-1',
            source: 'intro-clip',
            target: 'layer-1',
        },
    ];
    const projectPath = join(outputDirectory, 'runtime-data-flow.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 5, 5_000);
    await session.click('[data-testid="play-workflow"]');
    await session.waitForScript(
        `return document.querySelector('iframe')?.contentDocument
            ?.querySelector('[data-director-node="layer-1"] .director-layer__content')
            ?.matches('[data-result="Pikachu"][data-intro="complete"]') &&
            !document.querySelector('iframe')?.contentDocument
                ?.querySelector('[data-director-node="intro-clip"]');`,
        [],
        10_000,
    );
    const result = await session.evaluate<string>(`
        return document.querySelector('iframe').contentDocument
            .querySelector('#data-flow-output').textContent;
    `);
    assert.equal(result, 'Pikachu', 'runtime: a script wait result must reach a later layer.');
    await session.screenshot(join(outputDirectory, 'runtime-data-flow.png'), true);

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function verifyCameraSessionConfiguration(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create();
    project.nodes.unshift({
        id: 'camera-image',
        type: 'input',
        name: 'Kamerabild',
        position: null,
        accept: 'image/png',
        required: true,
        prepare: { modules: ['projects/example/prepare-camera.mjs'] },
    });
    project.connections.unshift({
        id: 'camera-image--camera-capability',
        source: 'camera-image',
        target: 'camera-capability',
    });
    project.nodes.unshift({
        id: 'camera-capability',
        type: 'capability',
        name: 'Virtuelle Kamera',
        position: null,
        capability: 'camera',
    });
    project.connections.unshift({
        id: 'camera-capability--website-root',
        source: 'camera-capability',
        target: 'website-root',
    });
    project.browserSession = {
        permissions: [],
        language: 'de',
        locale: 'DE',
    };
    const projectPath = join(outputDirectory, 'camera-session.btd.json');
    const imagePath = join(outputDirectory, 'camera.png');
    await Promise.all([
        writeFile(projectPath, ProjectFormat.stringify(project), 'utf8'),
        writeFile(
            imagePath,
            Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                'base64',
            ),
        ),
    ]);
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await selectGraphNode(session, 'camera-image');
    await session.waitForElement('[data-testid="project-input-camera-image"]', 5_000);
    await session.waitForValue(
        '[data-testid="project-input-camera-image-prepare-module-0"]',
        'projects/example/prepare-camera.mjs',
        5_000,
    );
    const acceptInput = '[data-testid="project-input-camera-image-accept"]';
    await session.fill(acceptInput, 'webp');
    await session.waitForElement('.tag-suggestions button', 5_000);
    await session.click('.tag-suggestions button');
    await session.waitForScript(
        `return [...document.querySelectorAll('.tag-pill')]
            .some(element => element.textContent.includes('image/webp'));`,
        [],
        5_000,
    );
    await session.fill(acceptInput, 'application/x-director-test');
    await session.press('\uE007', acceptInput);
    const acceptedTypes = await session.evaluate<string[]>(`
        return [...document.querySelectorAll('.tag-pill')]
            .map(element => element.textContent.trim());
    `);
    assert.ok(
        acceptedTypes.some((value) => value.includes('image/png')),
        'inputs: existing MIME types must render as tags.',
    );
    assert.ok(
        acceptedTypes.some((value) => value.includes('application/x-director-test')),
        'inputs: custom MIME types must be accepted as tags.',
    );
    await session.click('.tag-pill button[aria-label*="application/x-director-test"]');
    await session.click('[data-testid="project-input-camera-image-add-prepare-module"]');
    await session.waitForElement(
        '[data-testid="project-input-camera-image-prepare-module-1"]',
        5_000,
    );
    await session.click('[data-testid="project-input-camera-image-remove-prepare-module-1"]');
    await session.waitForCount(
        '[data-testid^="project-input-camera-image-prepare-module-"]',
        1,
        5_000,
    );
    await session.click('[data-testid="play-workflow"]');
    await session.waitForScript(
        `return document.querySelector(
            '[model-id="camera-image"] [joint-selector="statusRing"]'
        )?.getAttribute('class')?.includes('is-error');`,
        [],
        5_000,
    );
    await session.waitForScript(
        `return /keine Datei ausgewählt|No file was selected/iu.test(
            document.querySelector('.notice')?.textContent || ''
        );`,
        [],
        5_000,
    );
    await session.evaluate(`
        const input = document.querySelector('[data-testid="project-input-camera-image"]');
        input.click = () => { input.dataset.graphButtonClicked = 'true'; };
    `);
    await session.click(
        '[data-testid="graph-canvas"] .joint-element[model-id="camera-image"] [joint-selector="fileButton"]',
    );
    await session.waitForScript(
        `return document.querySelector('[data-testid="project-input-camera-image"]')
            ?.dataset.graphButtonClicked === 'true';`,
        [],
        5_000,
    );
    await session.upload('[data-testid="project-input-camera-image"]', imagePath);
    await session.waitForScript(
        `return document.querySelector(
            '[data-testid="graph-canvas"] .joint-element[model-id="camera-image"] [joint-selector="fileName"]'
        )?.textContent.includes('camera.png');`,
        [],
        5_000,
    );
    await session.screenshot(join(outputDirectory, 'input-node.png'), true);
    await selectGraphNode(session, 'website-root');
    await session.click('[data-testid="viewport-device-trigger"]');
    await session.waitForElement('.device-flyout__menu', 5_000);
    await session.waitForElement('.device-flyout__menu [data-testid^="remote-target-"]', 30_000);
    const targetState = await session.evaluate<{
        options: Array<{ value: string; disabled: boolean }>;
    }>(`
        const targets = [...document.querySelectorAll('.device-flyout__menu .target-option')];
        return {
            options: targets.map(target => ({
                value: target.dataset.testid.replace('remote-target-', ''),
                disabled: target.disabled,
            })),
        };
    `);
    const enabledTargets = targetState.options.filter((option) => !option.disabled);
    assert.ok(enabledTargets.length > 0, 'camera: a camera-capable target must be ready.');
    assert.ok(
        enabledTargets.some((option) => !option.value.startsWith('chrome-android-')),
        'camera: the Director shell must make desktop browsers selectable too.',
    );
    await session.click('[data-testid="viewport-device-trigger"]');

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function verifyEditableConnections(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-link', 1, 10_000);

    await session.click(
        '[data-testid="graph-canvas"] .joint-link [joint-selector="connectionHandle"]',
    );
    await session.waitForElement('[data-testid="delete-connection"]', 5_000);
    await session.click('[data-testid="delete-connection"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-link', 0, 5_000);
    await session.waitForState('[data-testid="delete-connection"]', 'absent', 5_000);
    const disconnected = await session.evaluate<boolean>(`
        return document.querySelector(
            '[model-id="layer-1"] [joint-selector="outline"]',
        ).getAttribute('stroke-dasharray') === '5 4';
    `);
    assert.equal(disconnected, true, 'graph: disconnected nodes must be visibly marked.');

    await session.drag(
        '[model-id="website-root"] [port="out"]',
        '[model-id="layer-1"] [port="in"]',
    );
    await session.waitForCount('[data-testid="graph-canvas"] .joint-link', 1, 5_000);
    await session.waitForElement(
        '[model-id="layer-1"] [joint-selector="outline"][stroke-dasharray="none"]',
        5_000,
    );
    const connectionState = await session.evaluate<{ dirty: boolean; solidNodes: boolean }>(`
        return {
            dirty: document.querySelector('.status-dot').classList.contains('is-dirty'),
            solidNodes: [...document.querySelectorAll('[data-testid="graph-canvas"] [joint-selector="outline"]')]
                .every((outline) => outline.getAttribute('stroke-dasharray') === 'none'),
        };
    `);
    assert.equal(
        connectionState.dirty,
        true,
        'graph: editing a connection must mark the project dirty.',
    );
    assert.equal(
        connectionState.solidNodes,
        true,
        'graph: reconnected nodes must lose the warning style.',
    );
    await session.screenshot(join(outputDirectory, 'editable-connections.png'), true);
}

async function verifyJavaScriptNode(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    const project = ProjectFormat.create('JavaScript node');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = '/example-site.html';
    website.position = { x: 32, y: 8 };
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.position = { x: 544, y: 8 };
    layer.source.html = '<div id="test-layer"></div>';
    project.nodes.splice(1, 0, {
        id: 'prepare-website',
        type: 'javascript',
        name: 'Prepare website',
        position: { x: 288, y: 8 },
        source: `const root = await director.waitFor('#example-website');
root.dataset.runs = String(Number(root.dataset.runs || 0) + 1);
root.dataset.speed = director.speed;`,
    });
    project.connections = [
        {
            id: 'website-root--prepare-website',
            source: 'website-root',
            target: 'prepare-website',
        },
        {
            id: 'prepare-website--layer-1',
            source: 'prepare-website',
            target: 'layer-1',
        },
    ];
    const projectPath = join(outputDirectory, 'javascript-node.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'JavaScript node', 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await selectGraphNode(session, 'prepare-website');
    await session.waitForElement('.source-editor textarea', 5_000);
    await session.click('[data-testid="maximize-editor"]');
    const maximizedEditor = await session.evaluate<{
        panelWidth: number;
        panelHeight: number;
        editorWidth: number;
        editorHeight: number;
    }>(`
        const panel = document.querySelector('.editor-panel').getBoundingClientRect();
        const editor = document.querySelector('.source-editor textarea').getBoundingClientRect();
        return {
            panelWidth: panel.width,
            panelHeight: panel.height,
            editorWidth: editor.width,
            editorHeight: editor.height,
        };
    `);
    assert.ok(
        maximizedEditor.editorWidth > maximizedEditor.panelWidth * 0.8,
        `javascript: maximized editor must use the panel width (${JSON.stringify(maximizedEditor)}).`,
    );
    assert.ok(
        maximizedEditor.editorHeight > maximizedEditor.panelHeight * 0.5,
        `javascript: maximized editor must use the remaining height (${JSON.stringify(maximizedEditor)}).`,
    );
    await session.screenshot(join(outputDirectory, 'javascript-editor-maximized.png'), true);
    await session.click('[data-testid="maximize-editor"]');
    await session.waitForState('.preview-viewport iframe', 'present', 5_000);
    await playGraphNode(session, 'prepare-website');
    await session.waitForScript(
        `const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
        const website = preview?.querySelector('.director-website')?.contentDocument;
        return Boolean(website?.querySelector('#example-website[data-runs="1"][data-speed="live"]'));`,
        [],
        5_000,
    );
    await session.waitForScript(
        `return document.querySelector(
            '[model-id="prepare-website"] [joint-selector="statusText"]'
        )?.textContent === '✓' &&
            !document.querySelector('[model-id="prepare-website"] [joint-selector^="prepared"]');`,
        [],
        5_000,
    );

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="play-node-current"]');
    await session.waitForScript(
        `const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
        const website = preview?.querySelector('.director-website')?.contentDocument;
        return Boolean(website?.querySelector('#example-website[data-runs="2"]'));`,
        [],
        5_000,
    );

    await selectGraphNode(session, 'layer-1');
    await playGraphNode(session, 'layer-1');
    await session.waitForScript(
        `const preview = document.querySelector('.preview-viewport iframe')?.contentDocument;
        const website = preview?.querySelector('.director-website')?.contentDocument;
        return Boolean(
            preview?.querySelector('.director-layer') &&
            website?.querySelector('#example-website[data-runs="1"][data-speed="catchup"]')
        );`,
        [],
        5_000,
    );

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function verifyProjectRoundtrip(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create('Roundtrip project');
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = `${applicationUrl}example-site.html`;
    project.nodes.unshift({
        id: 'roundtrip-input',
        type: 'input',
        name: 'Roundtrip input',
        position: null,
        accept: 'text/plain',
        required: false,
    });
    project.connections.push({
        id: 'roundtrip-input--website-root',
        source: 'roundtrip-input',
        target: 'website-root',
    });
    const fixtureDirectory = join(outputDirectory, 'roundtrip-fixtures');
    await mkdir(fixtureDirectory);
    const projectPath = join(fixtureDirectory, 'roundtrip-source.btd.json');
    const inputPath = join(fixtureDirectory, 'roundtrip-input.txt');
    await Promise.all([
        writeFile(projectPath, ProjectFormat.stringify(project), 'utf8'),
        writeFile(inputPath, 'persistent input', 'utf8'),
    ]);
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await selectGraphNode(session, 'roundtrip-input');
    await session.waitForElement('[data-testid="project-input-roundtrip-input"]', 5_000);
    await session.evaluate(`
        Object.defineProperty(window, 'showSaveFilePicker', {
            configurable: true,
            value: undefined,
        });
    `);
    await session.fill('.project-title input', 'Roundtrip project');
    await session.evaluate(`
        window.__roundtripOriginalFetch = window.fetch;
        window.fetch = async (...args) => {
            const [input, options] = args;
            if (String(input) === '/director-api/assets' && options?.method === 'POST') {
                await new Promise(resolve => setTimeout(resolve, 600));
            }
            return window.__roundtripOriginalFetch(...args);
        };
    `);
    await session.upload('[data-testid="project-input-roundtrip-input"]', inputPath);
    await session.waitForScript(
        `return document.querySelector(
            '[model-id="roundtrip-input"] [joint-selector="fileName"]'
        )?.textContent.includes('roundtrip-input.txt');`,
        [],
        5_000,
    );
    await session.click('[data-testid="save-project"]');
    await session.waitForElement('[data-testid="save-project"] .icon-spinner', 5_000);
    const download = await session.waitForDownload('roundtrip-source.btd.json', 10_000);
    await session.evaluate(`
        window.fetch = window.__roundtripOriginalFetch;
        delete window.__roundtripOriginalFetch;
    `);
    await session.click('[data-testid="new-project"]');
    assert.notEqual(
        (await session.state('.project-title input')).value,
        'Roundtrip project',
        'project: New must replace the current project.',
    );
    await session.upload('[data-testid="project-file-input"]', download.path);
    await session.waitForValue('.project-title input', 'Roundtrip project', 10_000);
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);
    await session.waitForScript(
        `return document.querySelector(
            '[model-id="roundtrip-input"] [joint-selector="fileName"]'
        )?.textContent.includes('roundtrip-input.txt');`,
        [],
        10_000,
    );
    await session.waitForState('.preview-viewport iframe', 'present', 5_000);
    await playGraphNode(session, 'layer-1');
    await session.switchFrame('.preview-viewport iframe');
    await session.waitForElement(
        '.director-layer__anchor[data-horizontal="center"][data-vertical="center"]',
        5_000,
    );
    await session.switchFrame();
}

async function verifyLandscapeDock(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create('Landscape');
    project.preview.preset = 'desktop';
    const projectPath = join(outputDirectory, 'landscape.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForValue('.project-title input', 'Landscape', 10_000);
    const layout = await session.evaluate<{
        preview: DOMRectSnapshot;
        graph: DOMRectSnapshot;
        editor: DOMRectSnapshot;
        ratio: number;
    }>(`
        const rect = (selector) => {
            const value = document.querySelector(selector).getBoundingClientRect();
            return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height };
        };
        const viewport = rect('.preview-viewport');
        return {
            preview: rect('.preview-panel'),
            graph: rect('.graph-panel'),
            editor: rect('.editor-panel'),
            ratio: viewport.width / viewport.height,
        };
    `);
    assert.ok(
        layout.preview.bottom <= layout.graph.top && layout.preview.bottom <= layout.editor.top,
        'landscape: preview must dock above graph and editor.',
    );
    assert.ok(Math.abs(layout.ratio - 16 / 9) < 0.02, 'landscape: viewport ratio must be 16:9.');
    await session.screenshot(join(outputDirectory, 'landscape.png'), true);
}

async function verifyRecordingExport(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    const project = ProjectFormat.create();
    project.name = 'Recording UI';
    const website = project.nodes.find((node) => node.type === 'website')!;
    website.url = `${applicationUrl}example-site.html`;
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.playback = { durationMs: 1_200, removeAfter: true };
    layer.source = {
        html: '<div id="recording-ui">Recording</div>',
        css: '#recording-ui { width: 10rem; height: 10rem; background: white; }',
        javascript: `director.root.dataset.recorded = 'true';`,
    };
    const projectPath = join(outputDirectory, 'recording-ui.btd.json');
    await writeFile(projectPath, ProjectFormat.stringify(project), 'utf8');
    await session.upload('[data-testid="project-file-input"]', projectPath);
    await session.waitForState('[data-testid="record-workflow"]', 'enabled', 10_000);
    await session.evaluate(`
        window.__directorRecordingOriginalFetch = window.fetch;
        window.__directorRecordingRequests = [];
        const video = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
        window.fetch = async (input, init = {}) => {
            const url = String(input);
            window.__directorRecordingRequests.push({ url, body: init.body || null });
            if (url.endsWith('/browser-testbench-api/sessions')) {
                return new Response(JSON.stringify({ id: 'recording-ui-session' }), {
                    status: 201,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.endsWith('/recording/start')) {
                return new Response(JSON.stringify({ id: 'recording-ui-capture' }), {
                    status: 201,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.endsWith('/recording/stop')) {
                return new Response(JSON.stringify({
                    artifactId: 'recording-ui-artifact',
                    size: video.byteLength,
                    sha256: 'd9f1cb99ee21291800d5e62bd9bca07850461d7d8096afc4150a52dc8554d49f',
                    mimeType: 'video/mp4',
                    width: 1080,
                    height: 1920,
                    durationMs: 250,
                }), { headers: { 'Content-Type': 'application/json' } });
            }
            if (url.includes('/recording/artifacts/')) {
                return new Response(video, { headers: { 'Content-Type': 'video/mp4' } });
            }
            if (url.endsWith('/director-api/video-exports')) {
                return new Response(video, { headers: { 'Content-Type': 'video/mp4' } });
            }
            if (url.endsWith('/browser')) {
                await new Promise(resolve => setTimeout(resolve, 1_200));
                return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
            }
            if (url.includes('/browser-testbench-api/sessions/')) {
                return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
            }
            return window.__directorRecordingOriginalFetch(input, init);
        };
    `);
    await session.click('[data-testid="record-workflow"]');
    await session.waitForElement('.recording-target-option:not(:disabled)', 5_000);
    await session.click('.recording-target-option:not(:disabled)');
    await session.waitForElement('[data-testid="recording-status"]', 5_000);
    await session.waitForElement('[data-testid="stop-recording"]', 5_000);
    const recordingIndicator = await session.evaluate<{
        label: string;
        tinted: boolean;
        stopIcon: boolean;
    }>(`
        const header = document.querySelector('.topbar');
        return {
            label: document.querySelector('[data-testid="recording-status"]')?.textContent?.trim() || '',
            tinted: header?.classList.contains('topbar--recording') || false,
            stopIcon: Boolean(document.querySelector('[data-testid="stop-recording"] .bi-stop-fill')),
        };
    `);
    assert.match(recordingIndicator.label, /Aufnahme läuft|Recording/iu);
    assert.equal(recordingIndicator.tinted, true, 'recording: header must show the active state.');
    assert.equal(recordingIndicator.stopIcon, true, 'recording: record control must become stop.');
    await session.screenshot(join(outputDirectory, 'recording-active.png'), true);
    const download = await session.waitForDownload('recording-ui.mp4', 15_000);
    await session.waitForText('recording-ui.mp4', 5_000);
    const recording = await session.evaluate<{ urls: string[] }>(`
        const value = { urls: window.__directorRecordingRequests.map((request) => request.url) };
        window.fetch = window.__directorRecordingOriginalFetch;
        delete window.__directorRecordingOriginalFetch;
        delete window.__directorRecordingRequests;
        return value;
    `);
    const start = recording.urls.findIndex((url) => url.endsWith('/recording/start'));
    const execution = recording.urls.findIndex(
        (url, index) => index > start && url.endsWith('/browser'),
    );
    const stop = recording.urls.findIndex((url) => url.endsWith('/recording/stop'));
    const artifact = recording.urls.findIndex((url) => url.includes('/recording/artifacts/'));
    assert.ok(
        start >= 0 && execution > start && stop > execution && artifact > stop,
        `recording: lifecycle order is invalid (${JSON.stringify(recording.urls)}).`,
    );
    assert.ok(download.path.endsWith('recording-ui.mp4'));
    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}
