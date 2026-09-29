import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { DirectorServer } from '../src/server/director-server.js';

test('Director-Server hostet Client, APIs und Browser-Testbench-Proxy eigenständig', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'director-server-'));
    const clientDirectory = join(directory, 'client');
    await mkdir(clientDirectory);
    await writeFile(join(clientDirectory, 'index.html'), '<h1>Director standalone</h1>', 'utf8');

    let proxiedPath = '';
    let proxiedVersion = '';
    const browserTestbench = createServer((request, response) => {
        proxiedPath = request.url ?? '';
        proxiedVersion = String(request.headers['x-browser-testbench-version'] ?? '');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify([{ id: 'chrome' }]));
    });
    await new Promise<void>((resolveStarted) => browserTestbench.listen(0, resolveStarted));
    const browserAddress = browserTestbench.address();
    if (!browserAddress || typeof browserAddress === 'string') {
        throw new Error('Browser Testbench fixture did not start.');
    }

    const server = new DirectorServer({
        host: '127.0.0.1',
        port: 0,
        projectDirectory: directory,
        clientDirectory,
        browserTestbenchUrl: `http://127.0.0.1:${browserAddress.port}`,
        browserTestbench: { version: '0.5.1-test', executable: process.execPath },
    });

    try {
        await server.start();
        const origin = server.origin();
        const client = await fetch(`${origin}/workflow/deep-link`);
        assert.equal(client.status, 200);
        assert.match(await client.text(), /Director standalone/u);

        const targets = await fetch(`${origin}/browser-testbench-api/targets`);
        assert.deepEqual(await targets.json(), [{ id: 'chrome' }]);
        assert.equal(proxiedPath, '/v1/targets');
        assert.equal(proxiedVersion, '0.5.1-test');

        const published = await fetch(`${origin}/director-api/previews/nodes/layer-1`, {
            method: 'POST',
            body: '<p>Layer preview</p>',
        });
        assert.equal(published.status, 201);
        const previewUrl = (await published.json()) as { url: string };
        const preview = await fetch(`${origin}${previewUrl.url}`);
        assert.equal(
            preview.headers.get('content-security-policy'),
            'sandbox allow-scripts allow-same-origin',
        );
        assert.equal(await preview.text(), '<p>Layer preview</p>');

        const assetContent = new TextEncoder().encode('persistent input');
        const storedAsset = await fetch(`${origin}/director-api/assets`, {
            method: 'POST',
            body: assetContent,
            headers: {
                'Content-Type': 'text/plain',
                'X-Director-Asset-Name': 'input.txt',
            },
        });
        assert.equal(storedAsset.status, 201);
        const assetReference = (await storedAsset.json()) as Record<string, unknown>;
        assert.deepEqual(Object.keys(assetReference).sort(), ['asset', 'name', 'size', 'type']);
        const restoredAsset = await fetch(`${origin}/director-api/assets/${assetReference.asset}`);
        assert.equal(await restoredAsset.text(), 'persistent input');

        const status = await fetch(`${origin}/director-api/browser-testbench`);
        assert.deepEqual(await status.json(), { running: true, managed: false });
    } finally {
        await server.close();
        await new Promise<void>((resolveClosed, reject) =>
            browserTestbench.close((error) => (error ? reject(error) : resolveClosed())),
        );
        await rm(directory, { recursive: true, force: true });
    }
});

test('Director-Server proxyt eine Website samt HTML-Basis und Assets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'director-proxy-'));
    const clientDirectory = join(directory, 'client');
    await mkdir(clientDirectory);
    await writeFile(join(clientDirectory, 'index.html'), '<h1>Director</h1>', 'utf8');

    const websiteRequests: string[] = [];
    const website = createServer((request, response) => {
        websiteRequests.push(request.url ?? '');
        if (request.url === '/main.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(
                'const root = "/"; const pattern = /["\']\\//gu; import "/@fs/module.js"; const lazy = import("/lazy.js"); const path = window.location.pathname; window.websiteLoaded = true;',
            );
            return;
        }
        if (request.url === '/@fs/module.js' || request.url === '/lazy.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end('window.moduleLoaded = true;');
            return;
        }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
        response.setHeader('X-Frame-Options', 'DENY');
        response.end(
            '<head><script type="module" src="/@vite/client"></script><base href="/"></head><body><script src="main.js"></script></body>',
        );
    });
    await new Promise<void>((resolveStarted) => website.listen(0, resolveStarted));
    const websiteAddress = website.address();
    if (!websiteAddress || typeof websiteAddress === 'string') {
        throw new Error('Website fixture did not start.');
    }

    const browserTestbench = createServer((_request, response) => response.end('{}'));
    await new Promise<void>((resolveStarted) => browserTestbench.listen(0, resolveStarted));
    const browserAddress = browserTestbench.address();
    if (!browserAddress || typeof browserAddress === 'string') {
        throw new Error('Browser Testbench fixture did not start.');
    }

    const server = new DirectorServer({
        host: '127.0.0.1',
        port: 0,
        projectDirectory: directory,
        clientDirectory,
        browserTestbenchUrl: `http://127.0.0.1:${browserAddress.port}`,
        browserTestbench: { version: '0.5.1-test', executable: process.execPath },
    });

    try {
        await server.start();
        const target = `http://127.0.0.1:${websiteAddress.port}/price-check/scan`;
        const registration = await fetch(`${server.origin()}/director-api/website-proxies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: target }),
        });
        assert.equal(registration.status, 201);
        const { url } = (await registration.json()) as { url: string };
        const page = await fetch(`${server.origin()}${url}`);
        const html = await page.text();
        assert.equal(page.headers.get('content-security-policy'), null);
        assert.equal(page.headers.get('x-frame-options'), null);
        assert.doesNotMatch(html, /@vite\/client/u);
        assert.match(html, /<base href="\/director-website\/[^/]+\/">/u);
        assert.match(html, /Element\.prototype\.setAttribute/u);
        assert.match(html, /new MutationObserver/u);
        assert.match(
            html,
            /url\.pathname === prefix \|\| url\.pathname\.startsWith\(prefix \+ '\/'\)/u,
            'Already proxied same-origin URLs must not be rewritten repeatedly.',
        );
        assert.match(
            html,
            /__directorPreviewCameraStream/u,
            'The preview camera bridge must run before application scripts.',
        );

        const prefix = url.slice(0, url.indexOf('/price-check/scan'));
        const asset = await fetch(`${server.origin()}${prefix}/main.js`);
        const script = await asset.text();
        assert.equal(
            script,
            `const root = "/"; const pattern = /["']\\//gu; import "${prefix}/@fs/module.js"; const lazy = import("${prefix}/lazy.js"); const path = globalThis.__directorWebsitePathname(); window.websiteLoaded = true;`,
        );
        const module = await fetch(`${server.origin()}${prefix}/@fs/module.js`);
        assert.equal(await module.text(), 'window.moduleLoaded = true;');
        assert.deepEqual(websiteRequests, ['/price-check/scan', '/main.js', '/@fs/module.js']);
    } finally {
        await server.close();
        await Promise.all([
            new Promise<void>((resolveClosed, reject) =>
                website.close((error) => (error ? reject(error) : resolveClosed())),
            ),
            new Promise<void>((resolveClosed, reject) =>
                browserTestbench.close((error) => (error ? reject(error) : resolveClosed())),
            ),
        ]);
        await rm(directory, { recursive: true, force: true });
    }
});
