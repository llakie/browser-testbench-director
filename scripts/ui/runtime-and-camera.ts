import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RemoteSession } from 'browser-testbench/client';

import { ProjectFormat } from '../../src/ui/client/core/project-format.js';
import { selectGraphNode } from '../support/director-ui.js';
import { exampleSiteUrl, outputDirectory } from '../support/ui-verification-context.js';

export async function verifyRuntimeDataFlow(session: RemoteSession): Promise<void> {
    const project = ProjectFormat.create();
    const website = project.nodes.find((node) => node.type === 'website')!;
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    website.url = exampleSiteUrl;
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

export async function verifyCameraSessionConfiguration(session: RemoteSession): Promise<void> {
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
