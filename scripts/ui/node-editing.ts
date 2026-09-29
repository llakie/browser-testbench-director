import assert from 'node:assert/strict';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { outputDirectory } from '../support/ui-verification-context.js';

export async function verifyNodeEditing(session: RemoteSession): Promise<void> {
    await session.setViewport(1440, 1000);
    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
    await session.click('[model-id="website-root"] [joint-selector="body"]');
    await session.waitForElement(
        '[model-id="website-root"] [joint-selector="outline"][stroke-width="2"]',
        5_000,
    );
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
    await session.click('[data-testid="add-javascript-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);
    await session.waitForElement('.source-editor textarea', 5_000);
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
    await session.click('[data-testid="add-merge-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 4, 5_000);
    await session.select('[data-testid="merge-wait-for"]', 'any');
    assert.equal(
        (await session.state('[data-testid="merge-wait-for"]')).value,
        'any',
        'nodes: a merge can continue after any incoming branch.',
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
    await session.click('[data-testid="node-actions-trigger"]');
    await session.click('[data-testid="delete-node"]');
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 3, 5_000);

    await session.refresh();
    await session.waitForCount('[data-testid="graph-canvas"] .joint-element', 2, 10_000);
}
