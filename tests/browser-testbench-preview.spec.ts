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

        if (originalLocation) {
            Object.defineProperty(globalThis, 'location', originalLocation);
        } else {
            delete (globalThis as { location?: Location }).location;
        }
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

test('HTTPS-Editor öffnet Remote-Player über den zertifikatsfreien HTTP-Origin', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const requests: Array<{ url: string; body?: BodyInit | null }> = [];
    Object.defineProperty(globalThis, 'location', {
        value: new URL('https://127.0.0.1:5173/'),
        configurable: true,
    });
    globalThis.fetch = async (input, init = {}) => {
        requests.push({ url: String(input), body: init.body });
        const url = String(input);
        const payload = url.startsWith('/director-api/previews/')
            ? { url: '/director-preview/nodes/layer-1/preview-token' }
            : url === '/director-api/player-origin'
              ? { origin: 'http://127.0.0.1:61234' }
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

        if (originalLocation) {
            Object.defineProperty(globalThis, 'location', originalLocation);
        } else {
            delete (globalThis as { location?: Location }).location;
        }
    }

    assert.deepEqual(JSON.parse(String(requests[2]?.body)), {
        target: 'chrome',
        url: 'http://127.0.0.1:61234/director-preview/nodes/layer-1/preview-token',
        headless: false,
        leaseTimeoutMs: 15 * 60 * 1_000,
    });
});

test('Preview-Shell übernimmt globale Sprache und Website-Berechtigungen', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const requests: Array<{ url: string; body?: BodyInit | null }> = [];
    Object.defineProperty(globalThis, 'location', {
        value: new URL('http://127.0.0.1:5173/'),
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
        await BrowserTestbenchPreview.open(
            desktopTarget,
            'layer-1',
            '<!doctype html>',
            {},
            [],
            false,
            {
                permissions: ['microphone'],
                language: 'de',
                locale: 'DE',
            },
        );
    } finally {
        globalThis.fetch = originalFetch;

        if (originalLocation) {
            Object.defineProperty(globalThis, 'location', originalLocation);
        } else {
            delete (globalThis as { location?: Location }).location;
        }
    }

    const session = JSON.parse(String(requests[1]?.body)) as Record<string, unknown>;
    assert.deepEqual(session['permissions'], [
        { name: 'microphone', origin: 'http://127.0.0.1:5173' },
    ]);
    assert.deepEqual(session['capabilities'], {
        'goog:chromeOptions': {
            args: [
                '--remote-allow-origins=https://chrome-devtools-frontend.appspot.com',
                '--lang=de-DE',
                '--disable-features=Translate,TranslateUI',
            ],
            prefs: { 'intl.accept_languages': 'de-DE,de' },
        },
    });
    assert.equal(session['require'], undefined);
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

test('Leere Website-URLs werden niemals auf den Director selbst aufgelöst', () => {
    assert.throws(
        () => BrowserTestbenchPreview.proxyWebsite('   '),
        /Website URL must not be empty/u,
    );
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

test('Kamera-Eingabe wird über die gemeinsame Player-Runtime übertragen', async () => {
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
        const url = String(input);
        const payload = url.startsWith('/director-api/previews/')
            ? { url: '/director-preview/nodes/camera/preview-token' }
            : { id: 'camera-session' };
        return new Response(JSON.stringify(payload), {
            status: url.startsWith('/director-api/previews/') ? 201 : 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        const file = new File([new Uint8Array([1, 2, 3, 4])], 'camera.png', {
            type: 'image/png',
        });
        const id = await BrowserTestbenchPreview.open(
            androidTarget,
            'camera',
            '<!doctype html>',
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
            false,
            {
                permissions: [],
                language: 'de',
                locale: 'DE',
            },
        );
        assert.equal(id, 'camera-session');
    } finally {
        globalThis.fetch = originalFetch;

        if (originalLocation) {
            Object.defineProperty(globalThis, 'location', originalLocation);
        } else {
            delete (globalThis as { location?: Location }).location;
        }
    }

    assert.equal(
        requests.some((request) => request.url.endsWith('/assets')),
        false,
    );
    const sessionRequest = requests.find((request) =>
        request.url.endsWith('/browser-testbench-api/sessions'),
    )!;
    const session = JSON.parse(String(sessionRequest.body)) as Record<string, unknown>;
    assert.equal(session['leaseTimeoutMs'], 15 * 60 * 1_000);
    assert.equal(session['permissions'], undefined);
    assert.equal(session['media'], undefined);
    assert.equal(session['require'], undefined);
    assert.equal(session['localOrigins'], 'reverse');
    assert.ok(
        requests.some((request) => String(request.body).includes('data:image/png;base64,AQIDBA==')),
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

        const payload = url.startsWith('/director-api/previews/')
            ? { url: '/director-preview/nodes/prepared/preview-token' }
            : { id: 'prepared-session' };
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        await BrowserTestbenchPreview.open(
            androidTarget,
            'prepared',
            '<!doctype html>',
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
            false,
            {
                permissions: [],
                language: 'de',
                locale: 'DE',
            },
        );
    } finally {
        globalThis.fetch = originalFetch;

        if (originalLocation) {
            Object.defineProperty(globalThis, 'location', originalLocation);
        } else {
            delete (globalThis as { location?: Location }).location;
        }
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
    assert.equal(
        requests.some((request) => request.url.endsWith('/assets')),
        false,
    );
    assert.ok(
        requests.some((request) => String(request.body).includes('data:image/png;base64,CQgH')),
    );
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

test('Workflow-Aufnahme normalisiert ungerade native Viewport-Maße für H.264', async () => {
    const originalFetch = globalThis.fetch;
    const video = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    const digest = await crypto.subtle.digest('SHA-256', video);
    const sha256 = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    const requests: Array<{ url: string; body?: BodyInit | null; headers?: HeadersInit }> = [];
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, body: init.body, headers: init.headers });

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
                    width: 1079,
                    height: 2069,
                    durationMs: 4_200,
                    marks: [
                        {
                            name: 'director.audio.start',
                            data: { nodeId: 'soundtrack', runtimeTimeMs: 0 },
                            recordingTimeMs: 600,
                        },
                        {
                            name: 'director.audio.end',
                            data: { nodeId: 'soundtrack', runtimeTimeMs: 1_000 },
                            recordingTimeMs: 3_600,
                        },
                    ],
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
            undefined,
            [
                {
                    nodeId: 'soundtrack',
                    asset: `${'a'.repeat(64)}/sound.mp3`,
                    volume: 0.7,
                    envelope: [
                        { time: 0, gain: 1 },
                        { time: 1, gain: 1 },
                    ],
                    durationMs: 4_000,
                },
            ],
        );
        assert.equal(recording.filename, 'guess-price.mp4');
        assert.equal(recording.blob.size, video.byteLength);
        assert.deepEqual(
            { width: recording.width, height: recording.height, durationMs: recording.durationMs },
            { width: 1080, height: 2070, durationMs: 4_200 },
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
    assert.equal(requests[3]?.url, '/director-api/video-exports');
    const exportHeaders = new Headers(requests[3]?.headers);
    assert.equal(exportHeaders.get('x-director-video-width'), '1080');
    assert.equal(exportHeaders.get('x-director-video-height'), '2070');
    assert.deepEqual(JSON.parse(exportHeaders.get('x-director-video-audio')!), [
        {
            asset: `${'a'.repeat(64)}/sound.mp3`,
            startMs: 600,
            endMs: 1_600,
            volume: 0.7,
            envelope: [
                { time: 0, gain: 1 },
                { time: 1, gain: 1 },
            ],
            durationMs: 4_000,
        },
    ]);
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

test('Überlappende Layer-Zweige erzeugen nur ein Exportintervall', () => {
    const intervals = BrowserTestbenchPreview.layerIntervals({
        artifactId: 'artifact-1',
        size: 1,
        sha256: 'a'.repeat(64),
        mimeType: 'video/mp4',
        width: 1080,
        height: 1920,
        durationMs: 5_000,
        startedSessionTimeMs: 0,
        endedSessionTimeMs: 5_000,
        marks: [
            { name: 'director.layer.start', data: { nodeId: 'title' }, recordingTimeMs: 500 },
            { name: 'director.layer.start', data: { nodeId: 'callout' }, recordingTimeMs: 520 },
            { name: 'director.layer.end', data: { nodeId: 'title' }, recordingTimeMs: 2_500 },
            { name: 'director.layer.end', data: { nodeId: 'callout' }, recordingTimeMs: 2_520 },
        ],
    });

    assert.deepEqual(intervals, [{ startMs: 500, endMs: 2_520 }]);
});

test('Runtime-Zeitstempel entkoppeln Layer-Dauern von schwankender Mark-Übertragung', () => {
    const intervals = BrowserTestbenchPreview.layerIntervals({
        artifactId: 'artifact-1',
        size: 1,
        sha256: 'a'.repeat(64),
        mimeType: 'video/mp4',
        width: 1080,
        height: 1920,
        durationMs: 5_000,
        startedSessionTimeMs: 0,
        endedSessionTimeMs: 5_000,
        marks: [
            {
                name: 'director.layer.start',
                data: { nodeId: 'scan', durationMs: 1_600, runtimeTimeMs: 400 },
                recordingTimeMs: 900,
            },
            {
                name: 'director.layer.end',
                data: { nodeId: 'scan', runtimeTimeMs: 2_000 },
                recordingTimeMs: 3_800,
            },
        ],
    });

    assert.deepEqual(intervals, [{ startMs: 900, endMs: 2_500 }]);
});

test('Preview-Shell übergibt den vollständigen Aufnahmeplan an die autonome Runtime', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init = {}) => {
        requests.push({
            url: String(input),
            body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        const body = requests.at(-1)!.body;
        const payload = String(body['script']).includes('.status(')
            ? { state: 'success', events: [] }
            : {};
        return new Response(JSON.stringify(payload), {
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        await BrowserTestbenchPreview.execute(
            'session-audio',
            [
                {
                    id: 'soundtrack',
                    type: 'audio',
                    speed: 'live',
                    source: '',
                    inputId: 'soundtrack-file',
                    volume: 0.6,
                    envelope: [
                        { time: 0, gain: 1 },
                        { time: 1, gain: 1 },
                    ],
                    waitForEnd: true,
                    durationMs: 1,
                },
            ],
            true,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(
        requests.map((request) => request.url.split('/').at(-1)),
        ['browser', 'browser', 'browser', 'browser'],
    );
    const start = requests.find((request) => String(request.body['script']).includes('.start('));
    const options = (start?.body['arguments'] as unknown[] | undefined)?.[1];
    assert.deepEqual(options, {
        recording: true,
        markUrl: '/browser-testbench-api/sessions/session-audio/marks',
    });
});

test('Remote-Audio kann für einen einzelnen Branch gestoppt werden', async () => {
    const originalFetch = globalThis.fetch;
    let request: { action?: string; script?: string; arguments?: unknown[] } | undefined;
    globalThis.fetch = async (_input, init = {}) => {
        request = JSON.parse(String(init.body)) as { action?: string; script?: string };
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    };

    try {
        await BrowserTestbenchPreview.stopAudio('session-audio', 'soundtrack');
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(request?.action, 'evaluate');
    assert.equal(request?.script, 'window.__director?.stopAudio?.(arguments[0]);');
    assert.deepEqual(request?.['arguments'], ['soundtrack']);
});

test('Preview-Shell hält während eines autonomen Layer-Laufs nur den Statuskanal offen', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init = {}) => {
        requests.push({
            url: String(input),
            body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        const body = requests.at(-1)!.body;
        const payload = String(body['script']).includes('.status(')
            ? { state: 'success', events: [] }
            : {};
        return new Response(JSON.stringify(payload), {
            headers: { 'Content-Type': 'application/json' },
        });
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
        requests.map(({ url }) => url.split('/').at(-1)),
        ['browser', 'browser', 'browser', 'browser'],
    );
});

test('Preview-Shell überträgt große Laufzeitdateien außerhalb des HTML-Dokuments', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const requests: Array<{ url: string; rawBody: string }> = [];
    Object.defineProperty(globalThis, 'location', {
        value: new URL('http://127.0.0.1:5173/'),
        configurable: true,
    });
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, rawBody: String(init.body ?? '') });
        const payload = url.startsWith('/director-api/previews/')
            ? { url: '/director-preview/nodes/audio/preview-token' }
            : url === '/browser-testbench-api/sessions'
              ? { id: 'large-shell-session' }
              : {};
        return new Response(JSON.stringify(payload), {
            status: url.startsWith('/director-api/previews/') ? 201 : 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        await BrowserTestbenchPreview.open(
            desktopTarget,
            'audio',
            '<!doctype html><title>Lean preview shell</title>',
            {
                soundtrack: new File([new Uint8Array(1_200_000)], 'soundtrack.wav', {
                    type: 'audio/wav',
                }),
            },
            [
                {
                    id: 'soundtrack',
                    type: 'input',
                    name: 'Soundtrack',
                    position: null,
                    accept: 'audio/*',
                    required: true,
                },
            ],
        );
    } finally {
        globalThis.fetch = originalFetch;

        if (originalLocation) {
            Object.defineProperty(globalThis, 'location', originalLocation);
        } else {
            delete (globalThis as { location?: Location }).location;
        }
    }

    assert.equal(
        requests.find((request) => request.url.startsWith('/director-api/previews/'))?.rawBody,
        '<!doctype html><title>Lean preview shell</title>',
    );
    assert.ok(
        requests
            .filter((request) => request.url.includes('/actions'))
            .every((request) => Buffer.byteLength(request.rawBody) < 1_000_000),
        'Large runtime inputs must use Browser Testbench requests below its JSON limit.',
    );
    assert.equal(
        requests.some((request) => request.rawBody.includes('__director?.setInputs')),
        true,
    );
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
