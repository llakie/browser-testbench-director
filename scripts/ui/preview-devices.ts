import assert from 'node:assert/strict';

import type { RemoteSession } from 'browser-testbench/client';

export async function verifyPreviewDevices(session: RemoteSession): Promise<void> {
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
