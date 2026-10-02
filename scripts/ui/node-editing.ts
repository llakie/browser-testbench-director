import assert from 'node:assert/strict';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { outputDirectory } from '../support/ui-verification-context.js';

export async function verifyNodeEditing(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
    assert.equal(
        await session.evaluate<boolean>(
            `return document.querySelector('[data-testid="delete-node"]') === null;`,
        ),
        true,
        'nodes: no delete button may appear without a selected node.',
    );
    assert.equal(
        await session.evaluate<boolean>(
            `return document.querySelector('[data-testid="duplicate-node"]').disabled;`,
        ),
        true,
        'nodes: duplication needs an explicitly selected node.',
    );
    await session.click('[model-id="website-root"] [joint-selector="body"]');
    assert.equal(
        await session.evaluate<boolean>(
            `return document.querySelector('[data-testid="duplicate-node"]').disabled;`,
        ),
        true,
        'nodes: the website root is selected but cannot be duplicated.',
    );
    await session.waitForElement(
        '[model-id="website-root"] [joint-selector="outline"][stroke-width="2"]',
        5_000,
    );
    await assertEditorSectionLayout(session, '.website-properties', '#website-url');
    const graphAppearance = await session.evaluate<{
        selectedOutlineWidth: string | null;
        headerColors: string[];
    }>(`
        const selected = document.querySelector(
            '[model-id="website-root"] [joint-selector="outline"]',
        );
        const headerColors = [...document.querySelectorAll(
            '[data-testid="graph-canvas"] [joint-selector="header"]',
        )].map((header) => getComputedStyle(header).fill);
        return {
            selectedOutlineWidth: selected?.getAttribute('stroke-width') ?? null,
            headerColors: [...new Set(headerColors)],
        };
    `);
    assert.equal(
        graphAppearance.selectedOutlineWidth,
        '2',
        'graph: selecting a node must highlight its complete outline.',
    );
    assert.ok(
        graphAppearance.headerColors.length > 1,
        'graph: node types need visibly distinct header colors.',
    );

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="node-category-browser"]');
    await session.click('[data-testid="add-javascript-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);
    await session.waitForElement('.source-editor textarea', 5_000);
    await assertEditorSectionLayout(session, '.source-editor');
    await session.fill('[data-testid="node-name"]', 'Prepare GTP');
    await session.fill('.source-editor textarea', 'const state={prepared:true};');
    await session.click('[data-testid="format-source"]');
    await session.waitForScript(
        `return document.querySelector('.source-editor textarea').value === 'const state = { prepared: true };\\n';`,
        [],
        10_000,
    );
    await session.evaluate(`
        const editor = document.querySelector('.source-editor textarea');
        editor.value = 'document.body.dataset.prepared="true";';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'f',
            altKey: true,
            shiftKey: true,
            bubbles: true,
        }));
    `);
    await session.waitForScript(
        `return document.querySelector('.source-editor textarea').value === "document.body.dataset.prepared = 'true';\\n";`,
        [],
        5_000,
    );
    const duplicateControl = await session.evaluate<{ enabled: boolean; outsideMenu: boolean }>(`
        const button = document.querySelector('[data-testid="duplicate-node"]');
        return {
            enabled: !button.disabled,
            outsideMenu: !button.closest('.action-flyout__menu'),
        };
    `);
    assert.deepEqual(
        duplicateControl,
        { enabled: true, outsideMenu: true },
        'nodes: duplication must be a direct toolbar action for the selected node.',
    );
    await session.click('[data-testid="duplicate-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    assert.match(
        (await session.state('[data-testid="node-name"]')).value ?? '',
        /Prepare GTP – (Kopie|copy)/u,
        'nodes: a duplicate needs a localized copy name.',
    );
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);
    assert.equal(
        await session.evaluate<boolean>(
            `return document.querySelector('[data-testid="duplicate-node"]').disabled;`,
        ),
        true,
        'nodes: duplication must disable after selection is cleared.',
    );

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="node-category-flow"]');
    await session.click('[data-testid="add-merge-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    await session.select('[data-testid="merge-wait-for"]', 'any');
    await assertEditorSectionLayout(
        session,
        '.automation-properties',
        '[data-testid="merge-wait-for"]',
    );
    assert.equal(
        (await session.state('[data-testid="merge-wait-for"]')).value,
        'any',
        'nodes: a merge can continue after any incoming branch.',
    );
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="node-category-layers"]');
    await session.click('[data-testid="add-layer-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    await session.waitForElement('#source-tab-html', 5_000);
    assert.match(
        (await session.state('[data-testid="node-name"]')).value ?? '',
        /Neuer Layer|New layer/u,
        'nodes: a new layer needs its localized default name.',
    );
    await assertEditorSectionLayout(
        session,
        '.layer-playback-properties',
        '[data-testid="layer-duration"]',
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
    const durationLayout = await session.evaluate<{
        fullWidth: boolean;
        toggleBelow: boolean;
        toggleMatchesInputHeight: boolean;
        toggleContentCentered: boolean;
    }>(`
        const input = document.querySelector('[data-testid="layer-duration"]');
        const label = input.closest('label');
        const toggle = document.querySelector('.layer-playback-properties__toggle');
        const checkbox = toggle.querySelector('input');
        const text = toggle.querySelector('span');
        const toggleBounds = toggle.getBoundingClientRect();
        const toggleCenter = toggleBounds.top + toggleBounds.height / 2;
        return {
            fullWidth: Math.abs(input.getBoundingClientRect().width -
                label.getBoundingClientRect().width) < 1,
            toggleBelow: toggleBounds.top >= input.getBoundingClientRect().bottom,
            toggleMatchesInputHeight: Math.abs(toggleBounds.height -
                input.getBoundingClientRect().height) < 1,
            toggleContentCentered: [checkbox, text].every((element) => {
                const bounds = element.getBoundingClientRect();
                return Math.abs(bounds.top + bounds.height / 2 - toggleCenter) < 1;
            }),
        };
    `);
    assert.deepEqual(durationLayout, {
        fullWidth: true,
        toggleBelow: true,
        toggleMatchesInputHeight: true,
        toggleContentCentered: true,
    });
    const createdLayer = await session.evaluate<{ disconnected: boolean; editorHeight: number }>(`
        const selected = [...document.querySelectorAll('[data-testid="graph-canvas"] .joint-element')]
            .find((node) => /Neuer Layer|New layer/u.test(
                node.querySelector('[joint-selector="bodyText"]')?.textContent ?? '',
            ));
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
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="node-category-layers"]');
    await session.click('[data-testid="add-text-layer-node"]');
    await session.waitForElement('[data-testid="text-layer-editor"]', 5_000);
    await assertTextAccordionState(session, 'lines');
    assert.match((await session.state('[data-testid="text-layer-font-summary"]')).text, /8 vw/u);
    assert.equal(
        await session.evaluate<boolean>(
            `return document.querySelector('[data-testid="text-layer-remove-0"]')?.disabled ?? false;`,
        ),
        true,
        'text layers: the only line cannot be removed.',
    );
    const effectLabels = await session.evaluate<{ heading: string; field: string }>(`
        const select = document.querySelector('[data-testid="text-layer-block-effect"]');
        return {
            heading: select.closest('.text-layer-editor__section')
                .closest('details').querySelector('summary').textContent.trim(),
            field: select.closest('label').textContent.trim(),
        };
    `);
    assert.match(effectLabels.heading, /Layer-Effekt|Layer effect/u);
    assert.match(effectLabels.field, /Anfang|Start/u);
    await session.click('[data-testid="text-layer-font-summary"]');
    await assertTextAccordionState(session, 'font');
    await assertEditorSectionLayout(session, '.text-layer-editor__fields');
    const selectAppearance = await session.evaluate<{
        nativeAppearance: string;
        hasCustomCaret: boolean;
        rightPadding: number;
    }>(`
        const select = document.querySelector('[data-testid="text-layer-font"]');
        const style = getComputedStyle(select);
        return {
            nativeAppearance: style.appearance,
            hasCustomCaret: style.backgroundImage !== 'none',
            rightPadding: parseFloat(style.paddingRight),
        };
    `);
    assert.equal(selectAppearance.nativeAppearance, 'none');
    assert.equal(selectAppearance.hasCustomCaret, true);
    assert.ok(selectAppearance.rightPadding >= 38);
    await session.click('[data-testid="text-layer-effect-summary"]');
    await assertTextAccordionState(session, 'effect');
    await session.select('[data-testid="text-layer-block-effect"]', 'fly');
    const blockEffectControls = await session.evaluate<{
        durationUnitRight: boolean;
        directionPrefixLeft: boolean;
        consistentFontSize: boolean;
    }>(`
        const duration = document.querySelector('[data-testid="text-layer-block-duration"]');
        const direction = document.querySelector('[data-testid="text-layer-block-direction"]');
        const unit = duration.nextElementSibling;
        const prefix = direction.previousElementSibling;
        const fontSize = getComputedStyle(
            document.querySelector('[data-testid="text-layer-font"]'),
        ).fontSize;
        return {
            durationUnitRight: unit.textContent.trim() === 'ms' &&
                unit.getBoundingClientRect().left >= duration.getBoundingClientRect().right,
            directionPrefixLeft: /von|from/u.test(prefix.textContent.trim()) &&
                prefix.getBoundingClientRect().right <= direction.getBoundingClientRect().left,
            consistentFontSize: [
                '[data-testid="text-layer-block-effect"]',
                '[data-testid="text-layer-block-duration"]',
                '[data-testid="text-layer-block-direction"]',
            ].every((selector) => getComputedStyle(document.querySelector(selector)).fontSize === fontSize),
        };
    `);
    assert.deepEqual(blockEffectControls, {
        durationUnitRight: true,
        directionPrefixLeft: true,
        consistentFontSize: true,
    });
    await session.select('[data-testid="text-layer-block-effect"]', 'none');
    await session.click('[data-testid="text-layer-font-summary"]');
    await assertTextAccordionState(session, 'font');
    const fontLayout = await session.evaluate<{
        sliderHeight: number;
        selectHeight: number;
        fieldRows: number;
        overflow: boolean;
    }>(`
        const fields = document.querySelector('.text-layer-editor__fields');
        const labels = [...fields.querySelectorAll('label')];
        return {
            sliderHeight: document.querySelector('[data-testid="text-layer-size"]')
                .getBoundingClientRect().height,
            selectHeight: document.querySelector('[data-testid="text-layer-font"]')
                .getBoundingClientRect().height,
            fieldRows: new Set(labels.map(label => Math.round(label.getBoundingClientRect().top))).size,
            overflow: fields.scrollWidth > fields.clientWidth,
        };
    `);
    assert.equal(fontLayout.sliderHeight, fontLayout.selectHeight);
    assert.equal(fontLayout.fieldRows, 1, 'text layers: desktop font settings fit in one row.');
    assert.equal(fontLayout.overflow, false);
    await session.click('[data-testid="text-layer-layout-summary"]');
    await assertTextAccordionState(session, 'layout');
    await assertEditorSectionLayout(
        session,
        '.layer-playback-properties',
        '[data-testid="layer-duration"]',
    );
    await session.fill('[data-testid="layer-duration"]', '1000');
    assert.match(
        (await session.state('[data-testid="text-layer-layout-summary"]')).text,
        /1000 ms/u,
    );
    await session.click('[data-testid="text-layer-effect-summary"]');
    await assertTextAccordionState(session, 'effect');
    await session.setViewport(1920, 1000);
    await session.click('[data-testid="maximize-editor"]');
    const wideOverflow = await session.evaluate<boolean>(`
        const panel = document.querySelector('[data-testid="editor-properties-scroll"]');
        return panel.scrollWidth > panel.clientWidth;
    `);
    assert.equal(wideOverflow, false, 'text layers: expanded properties must not overflow.');
    await session.screenshot(join(outputDirectory, 'text-layer-settings-wide.png'), true);
    await session.click('[data-testid="maximize-editor"]');
    await session.setViewport(390, 844);
    await session.click('[data-testid="mobile-editor-tab"]');
    await session.click('[data-testid="text-layer-font-summary"]');
    await assertTextAccordionState(session, 'font');
    const mobileFontLayout = await session.evaluate<{ rows: number; overflow: boolean }>(`
        const fields = document.querySelector('.text-layer-editor__fields');
        const labels = [...fields.querySelectorAll('label')];
        return {
            rows: new Set(labels.map(label => Math.round(label.getBoundingClientRect().top))).size,
            overflow: fields.scrollWidth > fields.clientWidth,
        };
    `);
    assert.equal(mobileFontLayout.rows, 4, 'text layers: mobile font settings use compact rows.');
    assert.equal(mobileFontLayout.overflow, false);
    await session.screenshot(join(outputDirectory, 'text-layer-font-mobile.png'), true);
    await session.click('[data-testid="text-layer-lines-summary"]');
    await assertTextAccordionState(session, 'lines');
    const mobileLineLayout = await session.evaluate<{ contentRow: boolean; optionRow: boolean }>(`
        const line = document.querySelector('.text-layer-editor__line-fields');
        const text = line.querySelector('[data-testid="text-layer-line-0"]');
        const color = line.querySelector('input[type="color"]');
        const options = line.querySelector('.text-layer-editor__line-options');
        return {
            contentRow: Math.round(text.getBoundingClientRect().top) ===
                Math.round(color.getBoundingClientRect().top),
            optionRow: new Set([...options.children].map((element) =>
                Math.round(element.getBoundingClientRect().top),
            )).size === 1,
        };
    `);
    assert.deepEqual(mobileLineLayout, { contentRow: true, optionRow: true });
    await session.screenshot(join(outputDirectory, 'text-layer-lines-mobile.png'), true);
    await session.setViewport(1440, 1000);
    await session.select('[data-testid="text-layer-effect-0"]', 'fly');
    const narrowLineLayout = await session.evaluate<{ settingsBelow: boolean }>(`
        const options = document.querySelector('.text-layer-editor__line-options');
        return {
            settingsBelow: options.querySelector('.text-layer-editor__effect').getBoundingClientRect().top >
                options.querySelector('select').getBoundingClientRect().top,
        };
    `);
    assert.equal(narrowLineLayout.settingsBelow, true);
    await session.click('[data-testid="maximize-editor"]');
    const wideLineLayout = await session.evaluate<{
        controlsBottomAligned: boolean;
        settingsToRight: boolean;
        overflow: boolean;
    }>(`
        const options = document.querySelector('.text-layer-editor__line-options');
        const bounds = [...options.children].map((element) => element.getBoundingClientRect());
        const effectSelect = options.querySelector('[data-testid="text-layer-effect-0"]');
        const duration = options.querySelector('[data-testid="text-layer-line-duration-0"]');
        const direction = options.querySelector('[data-testid="text-layer-line-direction-0"]');
        const rowBottom = effectSelect.getBoundingClientRect().bottom;
        const panel = document.querySelector('[data-testid="editor-properties-scroll"]');
        return {
            controlsBottomAligned: [duration, direction].every((control) =>
                Math.abs(control.getBoundingClientRect().bottom - rowBottom) < 1,
            ),
            settingsToRight: bounds[2].left > bounds[1].left,
            overflow: panel.scrollWidth > panel.clientWidth,
        };
    `);
    assert.deepEqual(wideLineLayout, {
        controlsBottomAligned: true,
        settingsToRight: true,
        overflow: false,
    });
    await session.screenshot(join(outputDirectory, 'text-layer-line-wide.png'), true);
    await session.click('[data-testid="maximize-editor"]');
    await session.select('[data-testid="text-layer-effect-0"]', 'none');
    await session.fill('[data-testid="text-layer-line-0"]', 'Guess');
    const addLineControl = await session.evaluate<{
        centered: boolean;
        iconOnly: boolean;
        named: boolean;
    }>(`
        const button = document.querySelector('[data-testid="text-layer-add-line"]');
        const section = button.closest('.text-layer-editor__section');
        const buttonBounds = button.getBoundingClientRect();
        const sectionBounds = section.getBoundingClientRect();
        return {
            centered: Math.abs(
                (buttonBounds.left + buttonBounds.right) / 2 -
                (sectionBounds.left + sectionBounds.right) / 2,
            ) < 1,
            iconOnly: Boolean(button.querySelector('.bi-plus')) && !button.textContent.trim(),
            named: Boolean(button.getAttribute('aria-label')),
        };
    `);
    assert.deepEqual(addLineControl, { centered: true, iconOnly: true, named: true });
    await session.click('[data-testid="text-layer-add-line"]');
    await session.waitForCount('.text-layer-editor__line', 2, 5_000);
    const colorField = await session.evaluate<{
        colorHeight: number;
        selectHeight: number;
        colorPadding: string;
    }>(`
        const color = document.querySelector('.text-layer-editor__line-content input[type="color"]');
        const select = document.querySelector('.text-layer-editor__line-options select');
        return {
            colorHeight: color.getBoundingClientRect().height,
            selectHeight: select.getBoundingClientRect().height,
            colorPadding: getComputedStyle(color).paddingTop,
        };
    `);
    assert.equal(colorField.colorHeight, colorField.selectHeight);
    assert.equal(colorField.colorPadding, '0px');
    const lineActions = await session.evaluate<{ deleteInHeader: boolean; moveButtons: number }>(`
        const line = document.querySelectorAll('.text-layer-editor__line')[1];
        return {
            deleteInHeader: Boolean(line.querySelector('summary [data-testid="text-layer-remove-1"]')),
            moveButtons: line.querySelectorAll('.text-layer-editor__line-fields button').length,
        };
    `);
    assert.deepEqual(lineActions, { deleteInHeader: true, moveButtons: 0 });
    await session.evaluate(`document.querySelectorAll('.text-layer-editor__line')[1].open = true;`);
    await session.fill('[data-testid="text-layer-line-1"]', 'The price');
    await session.fill('[data-testid="text-layer-offset-1"]', '500');
    await session.select('[data-testid="text-layer-effect-1"]', 'fly');
    const lineEffectControls = await session.evaluate<{
        durationUnitRight: boolean;
        directionPrefixLeft: boolean;
    }>(`
        const duration = document.querySelector('[data-testid="text-layer-line-duration-1"]');
        const direction = document.querySelector('[data-testid="text-layer-line-direction-1"]');
        const unit = duration.nextElementSibling;
        const prefix = direction.previousElementSibling;
        return {
            durationUnitRight: unit.textContent.trim() === 'ms' &&
                unit.getBoundingClientRect().left >= duration.getBoundingClientRect().right,
            directionPrefixLeft: /von|from/u.test(prefix.textContent.trim()) &&
                prefix.getBoundingClientRect().right <= direction.getBoundingClientRect().left,
        };
    `);
    assert.deepEqual(lineEffectControls, {
        durationUnitRight: true,
        directionPrefixLeft: true,
    });
    await session.drag('[data-testid="text-layer-drag-1"]', '[data-testid="text-layer-drag-0"]');
    const reorderedLines = await session.evaluate<{
        text: string[];
        offsets: string[];
    }>(`
        return {
            text: [...document.querySelectorAll('.text-layer-editor__line summary')]
                .map((summary) => summary.textContent?.trim() ?? ''),
            offsets: [...document.querySelectorAll('[data-testid^="text-layer-offset-"]')]
                .map((input) => input.value),
        };
    `);
    assert.deepEqual(reorderedLines.text, ['The price', 'Guess']);
    assert.deepEqual(reorderedLines.offsets, ['500']);
    await session.drag('[data-testid="text-layer-drag-0"]', '[data-testid="text-layer-drag-1"]');
    await session.click('[data-testid="text-layer-add-line"]');
    await session.waitForCount('.text-layer-editor__line', 3, 5_000);
    await session.click('[data-testid="text-layer-remove-2"]');
    await session.waitForCount('.text-layer-editor__line', 2, 5_000);
    await session.click('[data-testid="text-layer-layout-summary"]');
    await assertTextAccordionState(session, 'layout');
    await session.fill('[data-testid="placement-offset-x"]', '5');
    await session.fill('[data-testid="placement-offset-y"]', '10');
    await session.click('[data-testid="play-node-current"]');
    await session.switchFrame('.preview-viewport iframe');
    await session.waitForElement('.text-layer', 5_000);
    const textPreview = await session.evaluate<{
        id: string;
        lines: string[];
        anchorLeft: number;
        anchorTop: number;
        width: number;
        height: number;
    }>(`
        const layer = document.querySelector('.text-layer');
        const anchor = layer?.closest('.director-layer__anchor');
        return {
            id: layer?.id ?? '',
            lines: [...(layer?.querySelectorAll('.text-layer__line') ?? [])]
                .map((line) => line.textContent ?? ''),
            anchorLeft: anchor?.getBoundingClientRect().left ?? -1,
            anchorTop: anchor?.getBoundingClientRect().top ?? -1,
            width: window.innerWidth,
            height: window.innerHeight,
        };
    `);
    assert.match(textPreview.id, /^tl-[a-z0-9]+$/u);
    assert.deepEqual(textPreview.lines, ['Guess', 'The price']);
    assert.ok(Math.abs(textPreview.anchorLeft - textPreview.width * 0.05) < 1);
    assert.ok(Math.abs(textPreview.anchorTop - textPreview.height * 0.1) < 1);
    await session.switchFrame();
    await session.waitForScript(
        `return !document.querySelector('[data-testid="editor-properties-scroll"]')?.inert;`,
        [],
        10_000,
    );
    await ensureTextAccordionOpen(session, 'layout');
    await session.fill('[data-testid="layer-duration"]', '300');
    await session.waitForElement('.layer-duration-warning', 5_000);
    const durationWarning = await session.evaluate<{
        beneathName: boolean;
        outsideTiming: boolean;
        small: boolean;
        described: boolean;
        matchesDeleteColor: boolean;
        timingRowsUnchanged: boolean;
    }>(`
        const warning = document.querySelector('.layer-duration-warning');
        const input = document.querySelector('[data-testid="layer-duration"]');
        const name = document.querySelector('[data-testid="node-name"]');
        const toggle = document.querySelector('.layer-playback-properties__toggle');
        return {
            beneathName: warning.closest('.panel__header--editor') !== null &&
                warning.getBoundingClientRect().top >= name.getBoundingClientRect().bottom,
            outsideTiming: warning.closest('.layer-playback-properties') === null,
            small: parseFloat(getComputedStyle(warning).fontSize) <= 10,
            described: input.getAttribute('aria-describedby') === warning.id,
            matchesDeleteColor: getComputedStyle(warning).color === getComputedStyle(
                document.querySelector('[data-testid="delete-node"]'),
            ).color,
            timingRowsUnchanged: Math.abs(
                toggle.getBoundingClientRect().top - input.getBoundingClientRect().bottom -
                parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-2')),
            ) < 1,
        };
    `);
    assert.deepEqual(durationWarning, {
        beneathName: true,
        outsideTiming: true,
        small: true,
        described: true,
        matchesDeleteColor: true,
        timingRowsUnchanged: true,
    });
    await session.screenshot(join(outputDirectory, 'text-layer-editor.png'), true);
    await session.evaluate(`
        document.querySelector('.text-layer-editor__line')?.scrollIntoView({ block: 'start' });
    `);
    await session.screenshot(join(outputDirectory, 'text-layer-lines.png'), true);
    const convertControl = await session.evaluate<{
        beforeDelete: boolean;
        icon: boolean;
        footerRemoved: boolean;
    }>(`
        const convert = document.querySelector('[data-testid="text-layer-convert"]');
        const deleteButton = document.querySelector('[data-testid="delete-node"]');
        return {
            beforeDelete: convert.getBoundingClientRect().right <= deleteButton.getBoundingClientRect().left,
            icon: Boolean(convert.querySelector('.bi-code')),
            footerRemoved: !document.querySelector('.text-layer-editor__footer'),
        };
    `);
    assert.deepEqual(convertControl, { beforeDelete: true, icon: true, footerRemoved: true });
    await session.evaluate(`
        window.__originalConfirm = window.confirm;
        window.confirm = () => {
            window.__nativeConfirmCalls = (window.__nativeConfirmCalls ?? 0) + 1;
            return false;
        };
    `);
    await session.click('[data-testid="text-layer-convert"]');
    await session.waitForElement('[data-testid="action-dialog-backdrop"]', 5_000);
    const dialogAppearance = await session.evaluate<{
        modal: boolean;
        blurred: boolean;
        closeIsGhost: boolean;
        cancelFocused: boolean;
        nativeConfirmCalls: number;
    }>(`
        const backdrop = document.querySelector('[data-testid="action-dialog-backdrop"]');
        const close = document.querySelector('[data-testid="action-dialog-close"]');
        return {
            modal: backdrop.querySelector('[role="dialog"]').getAttribute('aria-modal') === 'true',
            blurred: getComputedStyle(backdrop).backdropFilter.includes('blur'),
            closeIsGhost: getComputedStyle(close).backgroundColor === 'rgba(0, 0, 0, 0)',
            cancelFocused: document.activeElement?.dataset.testid === 'action-dialog-cancel',
            nativeConfirmCalls: window.__nativeConfirmCalls ?? 0,
        };
    `);
    assert.deepEqual(dialogAppearance, {
        modal: true,
        blurred: true,
        closeIsGhost: true,
        cancelFocused: true,
        nativeConfirmCalls: 0,
    });
    await session.screenshot(join(outputDirectory, 'text-layer-convert-dialog.png'), true);
    await session.click('[data-testid="action-dialog-close"]');
    await session.waitForState('[data-testid="action-dialog-backdrop"]', 'absent', 5_000);
    assert.equal(
        await session.evaluate<boolean>(
            `return Boolean(document.querySelector('[data-testid="text-layer-editor"]'));`,
        ),
        true,
        'text layers: cancelling conversion must keep the visual editor.',
    );
    await session.click('[data-testid="text-layer-convert"]');
    await session.waitForElement('[data-testid="action-dialog-backdrop"]', 5_000);
    await session.evaluate(`
        document.querySelector('[data-testid="action-dialog-backdrop"]')
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    `);
    await session.waitForState('[data-testid="action-dialog-backdrop"]', 'absent', 5_000);
    assert.equal(
        await session.evaluate<boolean>(
            `return Boolean(document.querySelector('[data-testid="text-layer-editor"]'));`,
        ),
        true,
    );
    await session.click('[data-testid="text-layer-convert"]');
    await session.click('[data-testid="action-dialog-cancel"]');
    await session.waitForState('[data-testid="action-dialog-backdrop"]', 'absent', 5_000);
    await session.click('[data-testid="text-layer-convert"]');
    await session.evaluate(`
        document.activeElement.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
    `);
    await session.waitForState('[data-testid="action-dialog-backdrop"]', 'absent', 5_000);
    await session.click('[data-testid="text-layer-convert"]');
    await session.click('[data-testid="action-dialog-confirm"]');
    await session.waitForElement('.source-editor textarea', 5_000);
    await session.evaluate(
        `window.confirm = window.__originalConfirm; delete window.__originalConfirm;`,
    );
    assert.match(
        (await session.state('.source-editor textarea')).value ?? '',
        /text-layer__line--the-price/u,
        'nodes: conversion must keep readable generated markup.',
    );
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="node-category-browser"]');
    await session.click('[data-testid="add-browser-action-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    await session.fill('[data-testid="browser-action-selector"]', '#open-camera');
    assert.equal(
        (await session.state('[data-testid="browser-action-selector"]')).value,
        '#open-camera',
        'nodes: a browser action selector must be editable.',
    );
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="node-category-browser"]');
    await session.click('[data-testid="add-browser-wait-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    await session.fill('[data-testid="browser-wait-selector"]', '#camera-ready');
    await session.click('[data-testid="browser-wait-timing-summary"]');
    assert.equal(
        await session.evaluate<boolean>(`
            return document.querySelector('[data-testid="browser-wait-timing-group"]').open &&
                !document.querySelector('[data-testid="browser-wait-condition-group"]').open;
        `),
        true,
        'nodes: opening wait timing closes the condition settings.',
    );
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
    await session.click('[data-testid="browser-wait-condition-summary"]');
    await session.select('[data-testid="browser-wait-condition"]', 'url');
    await session.fill('[data-testid="browser-wait-url"]', '/price-check/value');
    await session.select('[data-testid="browser-wait-condition"]', 'script');
    const waitScript = `${Array.from({ length: 60 }, (_value, index) => `// step ${index + 1}`).join('\n')}
return document.body ? { cardName: 'Pikachu' } : false;`;
    await session.fill('[data-testid="browser-wait-script"]', waitScript);
    assert.match(
        (await session.state('[data-testid="browser-wait-script"]')).value ?? '',
        /cardName/u,
        'nodes: a script wait must retain its result-producing source.',
    );
    await session.waitForScript(
        `return document.querySelector('.source-editor__gutter')?.textContent.trim().endsWith('61');`,
        [],
        5_000,
    );
    const waitEditor = await session.evaluate<{
        gutterScrollTop: number;
        lineNumbers: string;
        tabLabel: string;
        textareaScrollTop: number;
    }>(`
        const textarea = document.querySelector('[data-testid="browser-wait-script"]');
        const gutter = document.querySelector('.source-editor__gutter');
        textarea.scrollTop = 80;
        textarea.dispatchEvent(new Event('scroll'));
        return {
            gutterScrollTop: gutter.scrollTop,
            lineNumbers: gutter.textContent.trim(),
            tabLabel: document.querySelector('.source-tab--javascript').textContent.trim(),
            textareaScrollTop: textarea.scrollTop,
        };
    `);
    assert.equal(
        waitEditor.gutterScrollTop,
        waitEditor.textareaScrollTop,
        'nodes: script-wait line numbers must follow the editor scroll position.',
    );
    assert.ok(
        waitEditor.textareaScrollTop > 0,
        'nodes: the script-wait editor must be scrollable.',
    );
    assert.match(
        waitEditor.lineNumbers,
        /^1\s+[\s\S]*61$/u,
        'nodes: script waits need line numbers.',
    );
    assert.match(
        waitEditor.tabLabel,
        /JavaScript/u,
        'nodes: script waits must use the JavaScript source-editor presentation.',
    );
    await session.screenshot(join(outputDirectory, 'wait-script-editor.png'), true);
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
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}

async function assertEditorSectionLayout(
    session: RemoteSession,
    sectionSelector: string,
    fieldSelector?: string,
): Promise<void> {
    const insets = await session.evaluate<{
        sectionLeft: number;
        sectionRight: number;
        scrollbarWidth: number;
        fieldLeft?: number;
        fieldRight?: number;
    }>(`
        const body = document.querySelector('[data-testid="editor-properties-scroll"]');
        const section = document.querySelector(${JSON.stringify(sectionSelector)});
        const field = ${fieldSelector ? `document.querySelector(${JSON.stringify(fieldSelector)})` : 'null'};
        const bodyBounds = body.getBoundingClientRect();
        const sectionBounds = section.getBoundingClientRect();
        const fieldBounds = field?.getBoundingClientRect();
        return {
            sectionLeft: sectionBounds.left - bodyBounds.left,
            sectionRight: bodyBounds.right - sectionBounds.right,
            scrollbarWidth: body.offsetWidth - body.clientWidth,
            fieldLeft: fieldBounds ? fieldBounds.left - sectionBounds.left : undefined,
            fieldRight: fieldBounds ? sectionBounds.right - fieldBounds.right : undefined,
        };
    `);
    assert.ok(
        Math.abs(insets.sectionLeft) < 1 &&
            Math.abs(insets.sectionRight) < 1 &&
            insets.scrollbarWidth === 0,
        `nodes: ${sectionSelector} must reach both panel edges (${JSON.stringify(insets)}).`,
    );

    if (fieldSelector) {
        assert.ok(
            insets.fieldLeft !== undefined &&
                insets.fieldRight !== undefined &&
                Math.abs(insets.fieldLeft - insets.fieldRight) < 1,
            `nodes: ${fieldSelector} needs equal side insets (${JSON.stringify(insets)}).`,
        );
    }
}

async function assertTextAccordionState(
    session: RemoteSession,
    expected: 'layout' | 'font' | 'effect' | 'lines',
): Promise<void> {
    const open = await session.evaluate<string[]>(`
        return [...document.querySelectorAll('details[name="text-layer-properties"]')]
            .filter((section) => section.open)
            .map((section) => section.dataset.testid ?? '');
    `);
    assert.deepEqual(open, [`text-layer-${expected}-group`]);
}

async function ensureTextAccordionOpen(
    session: RemoteSession,
    section: 'layout' | 'font' | 'effect' | 'lines',
): Promise<void> {
    const isOpen = await session.evaluate<boolean>(`
        return document.querySelector('[data-testid="text-layer-${section}-group"]')?.open ?? false;
    `);

    if (!isOpen) {
        await session.click(`[data-testid="text-layer-${section}-summary"]`);
    }

    await assertTextAccordionState(session, section);
}
