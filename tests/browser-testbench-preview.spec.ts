import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    BrowserTestbenchPreview,
    type BrowserTestbenchTarget,
} from '../src/ui/client/core/browser-testbench-preview.js';

const desktopTarget: BrowserTestbenchTarget = {
    id: 'chrome',
    label: 'Google Chrome',
    kind: 'desktop',
    browser: 'chrome',
    ready: true,
    serial: false,
    capabilities: {
        permissions: { native: [], origin: ['camera'] },
        localOrigins: { reverse: false },
        mediaInjection: { cameraImage: false },
        recording: { viewport: false },
    },
};

const androidTarget: BrowserTestbenchTarget = {
    ...desktopTarget,
    id: 'chrome-android-emulator',
    kind: 'mobile',
    browser: 'chrome-android',
    deviceKind: 'emulator',
    capabilities: {
        permissions: { native: ['camera'], origin: ['camera'] },
        localOrigins: { reverse: true },
        mediaInjection: { cameraImage: true },
        recording: { viewport: true },
    },
};

test('Browser-Testbench-Vorschau veröffentlicht ein Dokument unter einer virtuellen Route', async () => {
    const document = '<!doctype html><html><body>Guess the price €</body></html>';
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const requests: Array<{ url: string; method: string; body?: BodyInit | null }> = [];
    Object.defineProperty(globalThis, 'location', {
        value: new URL('http://127.0.0.1:5173/'),
        configurable: true,
    });
    globalThis.fetch = async (input, init = {}) => {
        requests.push({ url: String(input), method: init.method ?? 'GET', body: init.body });
        const payload = String(input).startsWith('/director-api/previews/')
            ? { url: '/director-preview/nodes/layer-1/preview-token' }
            : { id: 'session-1' };
        return new Response(JSON.stringify(payload), {
            status: String(input).startsWith('/director-api/previews/') ? 201 : 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        assert.equal(
            await BrowserTestbenchPreview.open('chrome', 'layer-1', document),
            'session-1',
        );
    } finally {
        globalThis.fetch = originalFetch;
        if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
        else delete (globalThis as { location?: Location }).location;
    }

    assert.deepEqual(requests[0], {
        url: '/director-api/previews/nodes/layer-1',
        method: 'POST',
        body: document,
    });
    assert.deepEqual(JSON.parse(String(requests[1]?.body)), {
        target: 'chrome',
        url: 'http://127.0.0.1:5173/director-preview/nodes/layer-1/preview-token',
        headless: false,
        leaseTimeoutMs: 15 * 60 * 1_000,
    });
    assert.deepEqual(JSON.parse(String(requests[2]?.body)), {
        type: 'script',
        script: 'return Boolean(window.__director?.run);',
        arguments: [],
        timeoutMs: 10_000,
    });
});

test('Lokale HTTPS-Shell akzeptiert das Director-Entwicklungszertifikat', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const requests: Array<{ url: string; body?: BodyInit | null }> = [];
    Object.defineProperty(globalThis, 'location', {
        value: new URL('https://127.0.0.1:5173/'),
        configurable: true,
    });
    globalThis.fetch = async (input, init = {}) => {
        requests.push({ url: String(input), body: init.body });
        const payload = String(input).startsWith('/director-api/previews/')
            ? { url: '/director-preview/nodes/layer-1/preview-token' }
            : { id: 'session-1' };
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        await BrowserTestbenchPreview.open('chrome', 'layer-1', '<!doctype html>');
    } finally {
        globalThis.fetch = originalFetch;
        if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
        else delete (globalThis as { location?: Location }).location;
    }

    assert.deepEqual(JSON.parse(String(requests[1]?.body)), {
        target: 'chrome',
        url: 'https://127.0.0.1:5173/director-preview/nodes/layer-1/preview-token',
        headless: false,
        leaseTimeoutMs: 15 * 60 * 1_000,
        capabilities: { acceptInsecureCerts: true },
    });
});

test('Lokale Website-Vorschau registriert eine Same-Origin-Proxy-Route', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ url: '/director-website/session/scan' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
        });
    }) as typeof fetch;

    const url = await BrowserTestbenchPreview.proxyWebsite('https://127.0.0.1:4200/scan');

    assert.equal(url, '/director-website/session/scan');
    assert.deepEqual(requests, [
        {
            url: '/director-api/website-proxies',
            body: { url: 'https://127.0.0.1:4200/scan' },
        },
    ]);
});

test('Lokales HTTPS wird auf Android Chrome ohne Zertifikatswarnung geöffnet', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    let requestBody: Record<string, unknown> | undefined;
    Object.defineProperty(globalThis, 'location', {
        value: new URL('https://127.0.0.1:5173/'),
        configurable: true,
    });
    globalThis.fetch = async (_input, init = {}) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: 'android-https-session' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        await BrowserTestbenchPreview.openWebsite(
            { ...androidTarget, id: 'chrome-android-browser-testbench-api-36' },
            'https://127.0.0.1:4200/price-check/scan',
        );
    } finally {
        globalThis.fetch = originalFetch;
        if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
        else delete (globalThis as { location?: Location }).location;
    }

    assert.deepEqual(requestBody?.['capabilities'], {
        acceptInsecureCerts: true,
        'goog:chromeOptions': {
            args: ['--allow-insecure-localhost', '--disable-features=Translate,TranslateUI'],
        },
    });
});

test('Lokale Android-Vorschau navigiert nach dem Reverse-Tunnel kontrolliert neu', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    Object.defineProperty(globalThis, 'location', {
        value: new URL('https://127.0.0.1:5173/'),
        configurable: true,
    });
    globalThis.fetch = async (input, init = {}) => {
        requests.push({
            url: String(input),
            body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ id: 'android-local-session' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        await BrowserTestbenchPreview.openWebsite(
            androidTarget,
            'https://127.0.0.1:4200/price-check/scan',
            {
                target: { browser: 'chrome-android', deviceKind: 'emulator' },
                localOrigins: 'reverse',
                permissions: [],
                language: 'de',
                locale: 'DE',
            },
        );
    } finally {
        globalThis.fetch = originalFetch;
        if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
        else delete (globalThis as { location?: Location }).location;
    }

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, '/browser-testbench-api/sessions');
    assert.deepEqual(requests[1], {
        url: '/browser-testbench-api/sessions/android-local-session/navigate',
        body: { url: 'https://127.0.0.1:4200/price-check/scan' },
    });
});

test('Browser-Testbench-Targets erhalten verständliche Namen', () => {
    assert.equal(
        BrowserTestbenchPreview.label({
            ...desktopTarget,
        }),
        'Google Chrome',
    );
    assert.equal(
        BrowserTestbenchPreview.label({
            ...androidTarget,
            id: 'ios-device',
            label: { parameters: { deviceName: 'iPhone 17', version: '26.0' } },
        }),
        'iPhone 17 · 26.0',
    );
});

test('Desktop-Viewport behält sein Seitenverhältnis trotz Browser-Mindestbreite', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init = {}) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push(body);
        return new Response(
            JSON.stringify(
                body['action'] === 'evaluate'
                    ? { innerWidth: 500, innerHeight: 497, outerWidth: 500, outerHeight: 640 }
                    : {},
            ),
            { headers: { 'Content-Type': 'application/json' } },
        );
    };

    try {
        await BrowserTestbenchPreview.setViewport('desktop-session', {
            width: 360,
            height: 640,
        });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(requests[0], { action: 'viewport', width: 360, height: 640 });
    assert.equal(requests[1]?.['action'], 'evaluate');
    assert.deepEqual(requests[2], { action: 'viewport', width: 500, height: 1032 });
});

test('Kamera-Session lädt die Eingabedatei hoch und fordert Emulator-Fähigkeiten an', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const requests: Array<{ url: string; headers: Headers; body: BodyInit | null | undefined }> =
        [];
    Object.defineProperty(globalThis, 'location', {
        value: new URL('http://127.0.0.1:5173/'),
        configurable: true,
    });
    globalThis.fetch = async (input, init = {}) => {
        requests.push({
            url: String(input),
            headers: new Headers(init.headers),
            body: init.body,
        });
        const payload = String(input).endsWith('/assets')
            ? {
                  id: '00000000-0000-4000-8000-000000000001',
                  name: 'camera.png',
                  contentType: 'image/png',
                  size: 4,
                  sha256: 'a'.repeat(64),
              }
            : { id: 'camera-session' };
        return new Response(JSON.stringify(payload), {
            status: String(input).endsWith('/assets') ? 201 : 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        const file = new File([new Uint8Array([1, 2, 3, 4])], 'camera.png', {
            type: 'image/png',
        });
        const id = await BrowserTestbenchPreview.openWebsite(
            androidTarget,
            'https://www.binderium.com/price-check/scan',
            {
                target: { browser: 'chrome-android', deviceKind: 'emulator' },
                localOrigins: 'reverse',
                permissions: [],
                language: 'de',
                locale: 'DE',
            },
            { 'camera-image': file },
            [
                {
                    id: 'camera-image',
                    type: 'input',
                    name: 'Camera image',
                    position: null,
                    accept: 'image/*',
                    required: true,
                },
            ],
            'camera-image',
        );
        assert.equal(id, 'camera-session');
    } finally {
        globalThis.fetch = originalFetch;
        if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
        else delete (globalThis as { location?: Location }).location;
    }

    assert.equal(requests[0]?.url, '/browser-testbench-api/assets');
    assert.equal(requests[0]?.headers.get('content-type'), 'application/octet-stream');
    assert.equal(requests[0]?.headers.get('x-browser-testbench-asset-content-type'), 'image/png');
    const session = JSON.parse(String(requests[1]?.body)) as Record<string, unknown>;
    assert.equal(session['leaseTimeoutMs'], 15 * 60 * 1_000);
    assert.deepEqual(session['permissions'], [
        { name: 'camera', origin: 'https://www.binderium.com' },
    ]);
    assert.deepEqual(session['media'], {
        camera: {
            facing: 'back',
            source: {
                id: '00000000-0000-4000-8000-000000000001',
                name: 'camera.png',
                contentType: 'image/png',
                size: 4,
                sha256: 'a'.repeat(64),
            },
        },
    });
    assert.deepEqual(session['require'], {
        localOrigins: { reverse: true },
        permissions: { native: ['camera'], origin: ['camera'] },
        mediaInjection: { cameraImage: true },
    });
});

test('Desktop-Kamera wird ausschließlich über die reloadfeste Preview-Shell geöffnet', async () => {
    await assert.rejects(
        BrowserTestbenchPreview.openWebsite(
            desktopTarget,
            'https://www.binderium.com/price-check/scan',
            {
                target: { browser: null, deviceKind: null },
                localOrigins: 'reverse',
                permissions: [],
                language: 'de',
                locale: 'DE',
            },
            {
                'camera-image': new File([new Uint8Array([1, 2, 3])], 'card.jpg', {
                    type: 'image/jpeg',
                }),
            },
            [
                {
                    id: 'camera-image',
                    type: 'input',
                    name: 'Camera image',
                    position: null,
                    accept: 'image/*',
                    required: true,
                },
            ],
            'camera-image',
        ),
        /preview shell/u,
    );
});

test('Projektmodul bereitet eine Eingabe vor dem Testbench-Upload auf', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const requests: Array<{ url: string; headers: Headers; body: BodyInit | null | undefined }> =
        [];
    Object.defineProperty(globalThis, 'location', {
        value: new URL('http://127.0.0.1:5173/'),
        configurable: true,
    });
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, headers: new Headers(init.headers), body: init.body });
        if (url.startsWith('/director-api/inputs/prepare?')) {
            return new Response(new Uint8Array([9, 8, 7]), {
                headers: {
                    'Content-Type': 'image/png',
                    'X-Director-File-Name': 'camera.png',
                },
            });
        }
        const payload = url.endsWith('/assets')
            ? {
                  id: 'prepared-asset',
                  name: 'camera.png',
                  contentType: 'image/png',
                  size: 3,
                  sha256: 'b'.repeat(64),
              }
            : { id: 'prepared-session' };
        return new Response(JSON.stringify(payload), {
            status: url.endsWith('/assets') ? 201 : 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        await BrowserTestbenchPreview.openWebsite(
            androidTarget,
            'https://www.binderium.com/price-check/scan',
            {
                target: { browser: 'chrome-android', deviceKind: 'emulator' },
                localOrigins: 'reverse',
                permissions: [],
                language: 'de',
                locale: 'DE',
            },
            {
                'camera-image': new File([new Uint8Array([1, 2, 3])], 'card.jpg', {
                    type: 'image/jpeg',
                }),
            },
            [
                {
                    id: 'camera-image',
                    type: 'input',
                    name: 'Kartenfoto',
                    position: null,
                    accept: 'image/*',
                    required: true,
                    prepare: {
                        modules: [
                            'projects/guess-price/prepare/orient-camera.mjs',
                            'projects/guess-price/prepare/camera.mjs',
                        ],
                    },
                },
            ],
            'camera-image',
        );
    } finally {
        globalThis.fetch = originalFetch;
        if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
        else delete (globalThis as { location?: Location }).location;
    }

    assert.equal(
        requests[0]?.url,
        '/director-api/inputs/prepare?module=projects%2Fguess-price%2Fprepare%2Forient-camera.mjs',
    );
    assert.equal(requests[1]?.headers.get('content-type'), 'image/png');
    assert.equal(
        requests[1]?.url,
        '/director-api/inputs/prepare?module=projects%2Fguess-price%2Fprepare%2Fcamera.mjs',
    );
    assert.equal(requests[0]?.headers.get('content-type'), 'image/jpeg');
    assert.equal(requests[2]?.url, '/browser-testbench-api/assets');
    assert.equal(requests[2]?.headers.get('x-browser-testbench-asset-name'), 'camera.png');
    assert.equal(requests[2]?.headers.get('x-browser-testbench-asset-content-type'), 'image/png');
});

test('Projektdateien stehen der Runtime als Data-URLs zur Verfügung', async () => {
    const inputs = await BrowserTestbenchPreview.runtimeInputs(
        {
            camera: new File(['camera'], 'camera.jpg', { type: 'image/jpeg' }),
            font: new File(['font'], 'story.ttf', { type: 'font/ttf' }),
        },
        'camera',
    );

    assert.deepEqual(Object.keys(inputs), ['font']);
    assert.equal(inputs['font'], 'data:font/ttf;base64,Zm9udA==');
});

test('Workflow-Aufnahme lädt das geprüfte MP4-Artefakt von Browser Testbench', async () => {
    const originalFetch = globalThis.fetch;
    const video = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    const digest = await crypto.subtle.digest('SHA-256', video);
    const sha256 = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    const requests: Array<{ url: string; body?: BodyInit | null }> = [];
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, body: init.body });
        if (url.endsWith('/recording/start')) {
            return new Response(JSON.stringify({ id: 'recording-1' }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (url.endsWith('/recording/stop')) {
            return new Response(
                JSON.stringify({
                    artifactId: 'artifact-1',
                    size: video.byteLength,
                    sha256,
                    mimeType: 'video/mp4',
                    width: 1080,
                    height: 1920,
                    durationMs: 4_200,
                }),
                { headers: { 'Content-Type': 'application/json' } },
            );
        }
        return new Response(video, { headers: { 'Content-Type': 'video/mp4' } });
    };

    try {
        await BrowserTestbenchPreview.startRecording('session-1', 'guess-price.mp4');
        const recording = await BrowserTestbenchPreview.stopRecording(
            'session-1',
            'guess-price.mp4',
        );
        assert.equal(recording.filename, 'guess-price.mp4');
        assert.equal(recording.blob.size, video.byteLength);
        assert.deepEqual(
            { width: recording.width, height: recording.height, durationMs: recording.durationMs },
            { width: 1080, height: 1920, durationMs: 4_200 },
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(JSON.parse(String(requests[0]?.body)), {
        outputPath: 'guess-price.mp4',
        scope: 'viewport',
    });
    assert.equal(
        requests[2]?.url,
        '/browser-testbench-api/sessions/session-1/recording/artifacts/artifact-1',
    );
});

test('Aufnahmeintervalle für Layer und eingeschlossene Wartezeiten verwenden die native Aufnahmeuhr', () => {
    const intervals = BrowserTestbenchPreview.layerIntervals({
        artifactId: 'artifact-1',
        size: 1,
        sha256: 'a'.repeat(64),
        mimeType: 'video/mp4',
        width: 1080,
        height: 1920,
        durationMs: 9_000,
        startedSessionTimeMs: 1_000,
        endedSessionTimeMs: 11_000,
        marks: [
            {
                name: 'director.layer.start',
                data: { nodeId: 'intro' },
                recordingTimeMs: 2_000,
            },
            {
                name: 'director.layer.end',
                data: { nodeId: 'intro' },
                recordingTimeMs: 5_000,
            },
            {
                name: 'director.wait.start',
                data: { nodeId: 'visible-wait' },
                recordingTimeMs: 5_500,
            },
            {
                name: 'director.wait.end',
                data: { nodeId: 'visible-wait' },
                recordingTimeMs: 6_000,
            },
            {
                name: 'director.layer.start',
                data: { nodeId: 'outro' },
                recordingTimeMs: 8_000,
            },
            {
                name: 'director.layer.end',
                data: { nodeId: 'outro' },
                recordingTimeMs: 12_000,
            },
        ],
    });

    assert.deepEqual(intervals, [
        { startMs: 2_000, endMs: 5_000 },
        { startMs: 5_500, endMs: 6_000 },
        { startMs: 8_000, endMs: 9_000 },
    ]);
});

test('Aufnahme markiert nur Warte-Nodes, die im Export bleiben sollen', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input, init = {}) => {
        urls.push(String(input));
        const body = JSON.parse(String(init.body)) as { action?: string };
        const payload = body.action === 'evaluate' ? '{}' : '{}';
        return new Response(payload, { headers: { 'Content-Type': 'application/json' } });
    };

    try {
        await BrowserTestbenchPreview.executeOnWebsite(
            'session-wait',
            [
                {
                    id: 'visible-wait',
                    type: 'browser-wait',
                    speed: 'live',
                    source: '',
                    condition: 'element',
                    selector: '#ready',
                    value: '/',
                    script: 'return true;',
                    timeoutMs: 1_000,
                    omitFromRecording: false,
                },
                {
                    id: 'omitted-wait',
                    type: 'browser-wait',
                    speed: 'live',
                    source: '',
                    condition: 'element',
                    selector: '#done',
                    value: '/',
                    script: 'return true;',
                    timeoutMs: 1_000,
                    omitFromRecording: true,
                },
            ],
            true,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(
        urls.map((url) => url.split('/').at(-1)),
        ['browser', 'marks', 'wait', 'marks', 'browser', 'wait'],
    );
});

test('Browser-Aktion und Wartebedingung verwenden die nativen Testbench-Endpunkte', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = async (input, init = {}) => {
        requests.push({ url: String(input), body: JSON.parse(String(init.body)) });
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    };

    try {
        await BrowserTestbenchPreview.executeOnWebsite('session-1', [
            {
                id: 'ready',
                type: 'browser-wait',
                speed: 'live',
                source: '',
                condition: 'element',
                selector: '#ready',
                value: '/',
                script: 'return true;',
                timeoutMs: 12_000,
                omitFromRecording: true,
            },
            {
                id: 'click',
                type: 'browser-action',
                speed: 'live',
                source: '',
                action: 'click',
                selector: '#ready',
            },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(requests, [
        {
            url: '/browser-testbench-api/sessions/session-1/browser',
            body: {
                action: 'evaluate',
                script: `window.__directorResults ??= {};
                delete window.__directorResults[arguments[0]];`,
                arguments: ['ready'],
            },
        },
        {
            url: '/browser-testbench-api/sessions/session-1/wait',
            body: { type: 'element', selector: '#ready', timeoutMs: 12_000 },
        },
        {
            url: '/browser-testbench-api/sessions/session-1/browser',
            body: {
                action: 'evaluate',
                script: `window.__directorResults ??= {};
                delete window.__directorResults[arguments[0]];`,
                arguments: ['click'],
            },
        },
        {
            url: '/browser-testbench-api/sessions/session-1/click',
            body: { selector: '#ready' },
        },
    ]);
});

test('Script-Wait speichert sein Ergebnis für nachfolgende Nodes', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init = {}) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ url: String(input), body });
        const result =
            body['action'] === 'evaluate' && body['script'] === 'return { price: "42 €" };'
                ? { price: '42 €' }
                : {};
        return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        await BrowserTestbenchPreview.executeOnWebsite('session-2', [
            {
                id: 'price-result',
                type: 'browser-wait',
                speed: 'live',
                source: '',
                condition: 'script',
                selector: 'body',
                value: '/',
                script: 'return { price: "42 €" };',
                timeoutMs: 30_000,
                omitFromRecording: true,
            },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }

    const wait = requests.find((request) => request.url.endsWith('/wait'));
    assert.deepEqual(wait?.body, {
        type: 'script',
        script: 'return { price: "42 €" };',
        arguments: [],
        timeoutMs: 30_000,
    });
    const store = requests.at(-1)?.body;
    assert.deepEqual(store?.['arguments'], ['price-result', { price: '42 €' }]);
});

test('Aufnahme markiert ein Layer-Intervall erst nach dem Mount', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
        urls.push(String(input));
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    };

    try {
        await BrowserTestbenchPreview.executeOnWebsite(
            'session-3',
            [
                {
                    id: 'intro',
                    type: 'layer',
                    speed: 'live',
                    source: '',
                    html: '<strong>Intro</strong>',
                    css: '',
                    placement: {
                        reference: { type: 'viewport' },
                        horizontal: 'center',
                        vertical: 'center',
                    },
                    playback: { durationMs: 10, removeAfter: true },
                },
            ],
            true,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(
        urls.map((url) => url.split('/').at(-1)),
        ['browser', 'browser', 'marks', 'marks', 'browser'],
    );
});

test('Preview-Shell markiert Layer für den geschnittenen Aufnahmeexport', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init = {}) => {
        requests.push({
            url: String(input),
            body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    };

    try {
        await BrowserTestbenchPreview.execute(
            'session-shell',
            [
                {
                    id: 'intro',
                    type: 'layer',
                    speed: 'live',
                    source: '',
                    html: '<strong>Intro</strong>',
                    css: '',
                    placement: {
                        reference: { type: 'viewport' },
                        horizontal: 'center',
                        vertical: 'center',
                    },
                    playback: { durationMs: 10, removeAfter: true },
                },
            ],
            true,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(
        requests.map(({ url, body }) => ({
            endpoint: url.split('/').at(-1),
            name: body['name'],
        })),
        [
            { endpoint: 'browser', name: undefined },
            { endpoint: 'marks', name: 'director.layer.start' },
            { endpoint: 'marks', name: 'director.layer.end' },
            { endpoint: 'browser', name: undefined },
        ],
    );
});

test('Große Script-Inputs werden unterhalb der JSON-Grenze gestückelt', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ rawBody: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (_input, init = {}) => {
        const rawBody = String(init.body);
        requests.push({
            rawBody,
            body: JSON.parse(rawBody) as Record<string, unknown>,
        });
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    };
    const font = `data:font/ttf;base64,${'a'.repeat(1_200_000)}`;
    const camera = `data:image/jpeg;base64,${'b'.repeat(1_200_000)}`;

    try {
        await BrowserTestbenchPreview.executeOnWebsite(
            'session-large-input',
            [
                {
                    id: 'install-font',
                    type: 'javascript',
                    speed: 'live',
                    source: "return director.inputs['font'];",
                },
            ],
            false,
            { font, camera },
            'camera',
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.ok(
        requests.every((request) => Buffer.byteLength(request.rawBody) < 1_000_000),
        'Every Browser Testbench JSON request must stay below its 1 MB limit.',
    );
    const transferred = requests
        .map((request) => request.body['arguments'])
        .filter(
            (arguments_): arguments_ is [string, string, boolean] =>
                Array.isArray(arguments_) && arguments_.length === 3 && arguments_[0] === 'font',
        )
        .map((arguments_) => arguments_[1])
        .join('');
    assert.equal(transferred, font);
    assert.equal(
        requests.some((request) => request.rawBody.includes(camera)),
        false,
    );
    assert.deepEqual(requests.at(-1)?.body['arguments'], [
        'live',
        'install-font',
        { durationMs: 0, removeAfter: false },
    ]);
});

test('Browser-Testbench-Lifecycle verwendet den lokalen Director-Endpunkt', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = async (input, init = {}) => {
        requests.push({ url: String(input), method: init.method ?? 'GET' });
        return new Response(JSON.stringify({ running: init.method === 'POST', managed: true }), {
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        await BrowserTestbenchPreview.status();
        await BrowserTestbenchPreview.start();
        await BrowserTestbenchPreview.stop();
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(requests, [
        { url: '/director-api/browser-testbench', method: 'GET' },
        { url: '/director-api/browser-testbench', method: 'POST' },
        { url: '/director-api/browser-testbench', method: 'DELETE' },
    ]);
});
