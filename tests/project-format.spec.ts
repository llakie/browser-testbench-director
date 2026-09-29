import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProjectFiles } from '../src/ui/client/core/project-files.js';
import { ProjectFormat, type BrowserWaitNode } from '../src/ui/client/core/project-format.js';
import { ProjectNodes } from '../src/ui/client/core/project-nodes.js';
import { PreviewDocument } from '../src/ui/client/core/preview-document.js';
import de from '../src/i18n/de.json' with { type: 'json' };
import en from '../src/i18n/en.json' with { type: 'json' };

test('Director-UI-Wörterbücher enthalten dieselben Schlüssel', () => {
    assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
});

test('Director-Projektformat erhält Layer-Quellen bei einem Roundtrip', () => {
    const project = ProjectFormat.create();
    const loaded = ProjectFormat.parse(ProjectFormat.stringify(project));
    const website = loaded.nodes.find((node) => node.type === 'website');
    const layer = loaded.nodes.find((node) => node.type === 'layer');

    assert.deepEqual(loaded, project);
    assert.deepEqual(loaded.viewport, { width: 360, height: 640 });
    assert.deepEqual(loaded.output, { width: 1080, height: 1920 });
    assert.equal(website?.id, 'website-root');
    assert.equal(website?.url, '');
    assert.equal(website?.position, null);
    assert.ok(layer);
    assert.equal(layer.position, null);
    assert.deepEqual(layer.placement, {
        reference: { type: 'viewport' },
        horizontal: 'center',
        vertical: 'center',
    });
    assert.equal(layer.source.html, '<div class="layer"></div>');
    assert.equal(layer.source.css, '.layer { }');
    assert.equal(layer.source.javascript, '');
});

test('Director-Projektformat verlangt genau eine Website-Root-Node', () => {
    const project = ProjectFormat.create();
    project.nodes = project.nodes.filter((node) => node.type === 'layer');
    project.connections = [];

    assert.throws(() => ProjectFormat.parse(JSON.stringify(project)), /exactly one website root/u);
});

test('Director-Projektformat speichert JavaScript-Nodes ohne Quelltextverlust', () => {
    const project = ProjectFormat.create();
    project.nodes.splice(1, 0, {
        id: 'prepare-website',
        type: 'javascript',
        name: 'Prepare website',
        position: { x: 288, y: 8 },
        source: "await director.waitFor('#card');",
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

    const loaded = ProjectFormat.parse(ProjectFormat.stringify(project));
    const script = loaded.nodes.find((node) => node.type === 'javascript');

    assert.equal(script?.source, "await director.waitFor('#card');");
});

test('Director-Projektformat speichert typisierte Browser-Aktionen und Wartebedingungen', () => {
    const project = ProjectFormat.create();
    project.nodes.push(
        {
            id: 'open-camera',
            type: 'browser-action',
            name: 'Kamera öffnen',
            position: { x: 544, y: 8 },
            action: 'click',
            selector: '[data-testid="select-camera-source"]',
        },
        {
            id: 'camera-ready',
            type: 'browser-wait',
            name: 'Auf Kamera warten',
            position: { x: 800, y: 8 },
            condition: 'element',
            selector: '[data-testid="scanner-camera-preview"]',
            value: '/price-check/value',
            script: 'return true;',
            timeoutMs: 90_000,
            omitFromRecording: true,
        },
    );

    const loaded = ProjectFormat.parse(ProjectFormat.stringify(project));
    assert.deepEqual(loaded.nodes.slice(-2), project.nodes.slice(-2));
});

test('Director-Projektformat verlangt eine explizite Exportentscheidung für Warte-Nodes', () => {
    const project = ProjectFormat.create();
    const wait: BrowserWaitNode = ProjectNodes.createBrowserWait(project, 'Warten');
    delete (wait as unknown as { omitFromRecording?: boolean }).omitFromRecording;
    project.nodes.push(wait);
    project.connections = [
        ...project.connections,
        { id: 'layer-1--wait', source: 'layer-1', target: wait.id },
    ];

    assert.throws(
        () => ProjectFormat.parse(JSON.stringify(project)),
        /must define its recording behavior/u,
    );
});

test('Director-Projektformat speichert Dateieingaben und Browser-Session-Anforderungen', () => {
    const project = ProjectFormat.create();
    project.nodes.unshift({
        id: 'camera-image',
        type: 'input',
        name: 'Kamerabild',
        position: null,
        accept: 'image/png',
        required: true,
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
        target: { browser: 'chrome-android', deviceKind: 'emulator' },
        localOrigins: 'reverse',
        permissions: [],
        language: 'de',
        locale: 'DE',
    };

    const loaded = ProjectFormat.parse(ProjectFormat.stringify(project));
    assert.deepEqual(loaded.nodes, project.nodes);
    assert.deepEqual(loaded.browserSession, project.browserSession);

    project.nodes = project.nodes.filter((node) => node.type !== 'input');
    project.connections = project.connections.filter(
        (connection) => connection.source !== 'camera-image',
    );
    assert.throws(
        () => ProjectFormat.parse(JSON.stringify(project)),
        /capability node must receive/u,
    );
});

test('Director-Projektformat speichert mehrere Prepare-Module pro Datei-Input', () => {
    const project = ProjectFormat.create();
    project.nodes.unshift({
        id: 'camera-image',
        type: 'input',
        name: 'Kartenfoto',
        position: null,
        accept: 'image/*',
        required: false,
        file: {
            asset: `${'a'.repeat(64)}/card.png`,
            name: 'card.png',
            type: 'image/png',
            size: 123,
            sha256: 'a'.repeat(64),
        },
        prepare: {
            modules: [
                'projects/example/prepare/orient-camera.mjs',
                'projects/example/prepare/crop-camera.mjs',
            ],
        },
    });

    assert.deepEqual(ProjectFormat.parse(ProjectFormat.stringify(project)).nodes, project.nodes);

    const input = project.nodes.find((node) => node.type === 'input')!;
    input.prepare = { modules: ['../outside-project.mjs'] };

    assert.throws(() => ProjectFormat.parse(JSON.stringify(project)), /contains invalid settings/u);
});

test('Director-Projektformat lehnt unbekannte Versionen ab', () => {
    const project = { ...ProjectFormat.create(), version: 8 };
    assert.throws(
        () => ProjectFormat.parse(JSON.stringify(project)),
        /Unsupported project version/u,
    );
});

test('Director-Projektformat migriert Version 5 auf getrennte Vorschau und Ausgabe', () => {
    const project = ProjectFormat.create();
    const legacy = {
        ...project,
        version: 5,
        viewport: { width: 1080, height: 1920 },
    } as Record<string, unknown>;
    delete legacy['output'];

    const loaded = ProjectFormat.parse(JSON.stringify(legacy));

    assert.equal(loaded.version, 7);
    assert.deepEqual(loaded.viewport, { width: 360, height: 640 });
    assert.deepEqual(loaded.output, { width: 1080, height: 1920 });
});

test('Version-5-Migration unterscheidet Desktop und mobiles Querformat', () => {
    const desktop = ProjectFormat.create();
    const mobile = ProjectFormat.create();
    mobile.browserSession.target.browser = 'chrome-android';
    for (const project of [desktop, mobile]) {
        Object.assign(project, { version: 5, viewport: { width: 1920, height: 1080 } });
        delete (project as unknown as { output?: unknown }).output;
    }

    assert.deepEqual(ProjectFormat.parse(JSON.stringify(desktop)).viewport, {
        width: 1920,
        height: 1080,
    });
    assert.deepEqual(ProjectFormat.parse(JSON.stringify(mobile)).viewport, {
        width: 640,
        height: 360,
    });
});

test('Director-Projektformat trennt CSS-Viewport und Videoausgabe', () => {
    const project = ProjectFormat.create();
    project.viewport = { width: 390, height: 844 };
    project.output = { width: 1080, height: 1920 };

    const loaded = ProjectFormat.parse(ProjectFormat.stringify(project));

    assert.deepEqual(loaded.viewport, { width: 390, height: 844 });
    assert.deepEqual(loaded.output, { width: 1080, height: 1920 });

    delete (project as unknown as { output?: unknown }).output;
    assert.throws(() => ProjectFormat.parse(JSON.stringify(project)), /Project output/u);
});

test('Director-Projektformat migriert Version 1 bewusst nicht', () => {
    const project = { ...ProjectFormat.create(), version: 1 };
    assert.throws(
        () => ProjectFormat.parse(JSON.stringify(project)),
        /Unsupported project version: 1/u,
    );
});

test('Director-Projektformat lehnt unbekannte Layer-Positionierungen ab', () => {
    const project = ProjectFormat.create();
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.placement = {
        reference: { type: 'viewport' },
        horizontal: 'outside',
        vertical: 'center',
    } as never;

    assert.throws(() => ProjectFormat.parse(JSON.stringify(project)), /invalid placement/u);
});

test('Director-Projektformat speichert Viewport-, Layer- und DOM-Bezugsflächen', () => {
    const project = ProjectFormat.create();
    const parent = project.nodes.find((node) => node.type === 'layer')!;
    const child = ProjectNodes.createLayer(project, 'Child');
    child.placement = {
        reference: { type: 'layer', nodeId: parent.id },
        horizontal: 'right',
        vertical: 'bottom',
    };
    project.nodes.push(child);
    project.connections.push({
        id: `${parent.id}--${child.id}`,
        source: parent.id,
        target: child.id,
    });
    const dom = ProjectNodes.createLayer(project, 'DOM');
    dom.placement.reference = { type: 'dom', selector: '#price-card' };
    project.nodes.push(dom);
    project.connections.push({ id: `${child.id}--${dom.id}`, source: child.id, target: dom.id });

    const loaded = ProjectFormat.parse(ProjectFormat.stringify(project));

    assert.deepEqual(
        loaded.nodes.filter((node) => node.type === 'layer').map((node) => node.placement),
        [parent.placement, child.placement, dom.placement],
    );
});

test('Director-Projektformat lehnt unbekannte Parent-Layer ab', () => {
    const project = ProjectFormat.create();
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.placement.reference = { type: 'layer', nodeId: 'missing-layer' };

    assert.throws(() => ProjectFormat.parse(JSON.stringify(project)), /invalid parent layer/u);
});

test('Director-Projektformat lehnt ungültige Layer-Lebenszyklen ab', () => {
    const project = ProjectFormat.create();
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.playback.durationMs = -1;

    assert.throws(() => ProjectFormat.parse(JSON.stringify(project)), /playback settings/u);
});

test('Projektdateinamen sind stabil und tragen die Director-Endung', () => {
    assert.equal(ProjectFiles.filename('Guess the Price'), 'guess-the-price.btd.json');
    assert.equal(ProjectFiles.filename('guess-the-price.btd.json'), 'guess-the-price.btd.json');
});

test('Vorschau serialisiert Layer-Quellen ohne das Runtime-Script vorzeitig zu schließen', () => {
    const project = ProjectFormat.create();
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    layer.source.css = '</style><p>escaped</p>';
    layer.source.javascript = '</script><p>escaped</p>';

    const preview = PreviewDocument.build(layer);
    assert.match(preview, /<\\\/script/u);
    assert.doesNotMatch(preview, /<\/script><p>escaped/u);
});

test('Vorschau setzt den Layer auf eine transparente Vollbildfläche', () => {
    const project = ProjectFormat.create();
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    const preview = PreviewDocument.build(layer, 'https://example.com/?a=1&b=2');

    assert.match(preview, /\.director-layer \{[^}]*width: 100vw;[^}]*height: 100vh;/u);
    assert.match(preview, /\.director-layer \{[^}]*pointer-events: none;/u);
    assert.doesNotMatch(
        preview,
        /\.director-layer__content \{[^}]*pointer-events: auto;/u,
        'Non-interactive overlays must not intercept the controlled website by default.',
    );
    assert.match(
        preview,
        /"placement":\{"reference":\{"type":"viewport"\},"horizontal":"center","vertical":"center"\}/u,
    );
    assert.match(preview, /content\.className = 'director-layer__content'/u);
    assert.match(preview, /class="director-website"/u);
    assert.match(preview, /https:\/\/example\.com\/\?a=1&amp;b=2/u);
    assert.doesNotMatch(preview, /preview-card|Binderium Scan/u);
});

test('Layer-Skripte steuern in der lokalen Vorschau das Website-Dokument', () => {
    const project = ProjectFormat.create();
    const layer = project.nodes.find((node) => node.type === 'layer')!;
    const preview = PreviewDocument.build(layer, 'https://example.com/');

    assert.match(preview, /await websiteReady;\s+const targetDocument = websiteDocument\(\);/u);
    assert.match(preview, /createDirectorRuntime\([\s\S]*?inputs,\s+websiteDocument,\s+\);/u);
});

test('Lokale Vorschau verwendet den konfigurierten Datei-Input als virtuelle Kamera', () => {
    const project = ProjectFormat.create();
    const preview = PreviewDocument.buildPlan(
        {
            mode: 'workflow',
            inputs: [],
            cameraInputId: 'camera',
            website: project.nodes.find((node) => node.type === 'website')!,
            resetWebsite: true,
            steps: [],
        },
        null,
        { camera: 'data:image/png;base64,Y2FtZXJh' },
    );

    assert.match(preview, /const cameraInputId = "camera";/u);
    assert.match(preview, /createPreviewCameraStream\(inputs\[cameraInputId\]\)/u);
    assert.match(preview, /Object\.defineProperty\(mediaDevices, 'getUserMedia'/u);
});
