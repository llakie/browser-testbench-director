import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
    createServer as createHttpServer,
    request as httpRequest,
    type IncomingMessage,
    type Server as HttpServer,
    type ServerResponse,
} from 'node:http';
import {
    createServer as createHttpsServer,
    request as httpsRequest,
    type Server as HttpsServer,
} from 'node:https';
import { extname, relative, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { BrowserTestbenchLifecycle } from './browser-testbench-lifecycle.js';
import type { BrowserTestbenchInstallationDetails } from './browser-testbench-installation.js';
import { DirectorInputPreparations } from './director-input-preparations.js';
import { DirectorPreviewRoutes } from './director-preview-routes.js';
import { DirectorProjectAssets } from './director-project-assets.js';
import { DirectorVideoExports } from './director-video-exports.js';
import { DirectorWebsiteProxy } from './director-website-proxy.js';
import type { HttpsCertificate } from './local-https-certificate.js';
import type { McpClientIntegration } from './mcp-client-integration.js';

export interface DirectorServerOptions {
    readonly host: string;
    readonly port: number;
    readonly projectDirectory: string;
    readonly clientDirectory: string;
    readonly browserTestbenchUrl: string;
    readonly browserTestbench: BrowserTestbenchInstallationDetails;
    readonly mcpIntegration?: McpClientIntegration;
    readonly https?: HttpsCertificate;
    readonly frontend?: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
}

const contentTypes: Readonly<Record<string, string>> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

export class DirectorServer {
    readonly #previewRoutes = new DirectorPreviewRoutes();
    readonly #inputPreparations: DirectorInputPreparations;
    readonly #projectAssets: DirectorProjectAssets;
    readonly #videoExports: DirectorVideoExports;
    readonly #websiteProxy = new DirectorWebsiteProxy();
    readonly #browserTestbenchLifecycle: BrowserTestbenchLifecycle;
    readonly #server: HttpServer | HttpsServer;

    constructor(private readonly options: DirectorServerOptions) {
        const handler = (request: IncomingMessage, response: ServerResponse): void => {
            void this.#handle(request, response);
        };
        this.#server = options.https
            ? createHttpsServer({ cert: options.https.cert, key: options.https.key }, handler)
            : createHttpServer(handler);
        this.#inputPreparations = new DirectorInputPreparations(
            resolve(options.projectDirectory, 'projects'),
        );
        const assetDirectory = resolve(options.projectDirectory, 'projects', '.director-assets');
        this.#projectAssets = new DirectorProjectAssets(assetDirectory);
        this.#videoExports = new DirectorVideoExports(assetDirectory);
        this.#browserTestbenchLifecycle = new BrowserTestbenchLifecycle(
            options.browserTestbenchUrl,
            options.browserTestbench.version,
            options.browserTestbench.executable,
        );
    }

    async start(): Promise<void> {
        await new Promise<void>((resolveStarted, reject) => {
            this.#server.once('error', reject);
            this.#server.listen(this.options.port, this.options.host, () => {
                this.#server.off('error', reject);
                resolveStarted();
            });
        });
    }

    async close(): Promise<void> {
        await this.#browserTestbenchLifecycle.close();

        if (!this.#server.listening) {
            return;
        }

        await new Promise<void>((resolveClosed, reject) => {
            this.#server.close((error) => (error ? reject(error) : resolveClosed()));
        });
    }

    origin(): string {
        const address = this.#server.address() as AddressInfo | null;

        if (!address) {
            throw new Error('Director server is not listening.');
        }

        const host = address.address.includes(':') ? `[${address.address}]` : address.address;
        return `${this.options.https ? 'https' : 'http'}://${host}:${address.port}`;
    }

    listener(): HttpServer | HttpsServer {
        return this.#server;
    }

    async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        try {
            const pathname = new URL(request.url ?? '/', 'http://director.local').pathname;

            if (pathname === '/director-api/browser-testbench') {
                await this.#browserTestbenchLifecycle.handle(request, response);
                return;
            }

            if (pathname.startsWith('/director-api/previews/nodes/')) {
                await this.#previewRoutes.publish(request, response);
                return;
            }

            if (pathname.startsWith('/director-preview/nodes/')) {
                this.#previewRoutes.render(request, response);
                return;
            }

            if (pathname === '/director-api/inputs/prepare') {
                await this.#inputPreparations.handle(request, response);
                return;
            }

            if (
                pathname === DirectorProjectAssets.apiPath ||
                pathname.startsWith(`${DirectorProjectAssets.apiPath}/`)
            ) {
                await this.#projectAssets.handle(request, response, pathname);
                return;
            }

            if (pathname === '/director-api/video-exports') {
                await this.#videoExports.handle(request, response);
                return;
            }

            if (pathname === DirectorWebsiteProxy.apiPath) {
                await this.#websiteProxy.register(request, response);
                return;
            }

            if (pathname.startsWith(DirectorWebsiteProxy.routePath)) {
                await this.#websiteProxy.proxy(request, response);
                return;
            }

            if (pathname === '/director-api/mcp') {
                if (!this.options.mcpIntegration) {
                    this.#json(response, 503, { error: 'MCP integration is unavailable.' });
                    return;
                }

                await this.options.mcpIntegration.handle(request, response);
                return;
            }

            if (
                pathname === '/browser-testbench-api' ||
                pathname.startsWith('/browser-testbench-api/')
            ) {
                await this.#proxyBrowserTestbench(request, response);
                return;
            }

            if (this.options.frontend) {
                await this.options.frontend(request, response);
                return;
            }

            await this.#serveClient(request, response, pathname);
        } catch (error) {
            if (response.headersSent) {
                response.destroy(error instanceof Error ? error : new Error(String(error)));
                return;
            }

            this.#json(response, 500, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    async #proxyBrowserTestbench(
        request: IncomingMessage,
        response: ServerResponse,
    ): Promise<void> {
        const target = new URL(this.options.browserTestbenchUrl);
        const source = new URL(request.url ?? '/', 'http://director.local');
        const path = `${source.pathname.replace(/^\/browser-testbench-api/u, '/v1')}${source.search}`;
        const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
        await new Promise<void>((resolveProxy, reject) => {
            const proxy = send(
                {
                    protocol: target.protocol,
                    hostname: target.hostname,
                    port: target.port,
                    method: request.method,
                    path,
                    headers: {
                        ...request.headers,
                        host: target.host,
                        'x-browser-testbench-version': this.options.browserTestbench.version,
                    },
                },
                (proxyResponse) => {
                    response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
                    proxyResponse.pipe(response);
                    proxyResponse.once('end', resolveProxy);
                    proxyResponse.once('error', reject);
                },
            );
            proxy.once('error', reject);
            request.pipe(proxy);
        });
    }

    async #serveClient(
        request: IncomingMessage,
        response: ServerResponse,
        pathname: string,
    ): Promise<void> {
        if (!['GET', 'HEAD'].includes(request.method ?? '')) {
            this.#json(response, 405, { error: 'Method not allowed.' });
            return;
        }

        const clientRoot = this.options.clientDirectory;
        const requestedPath = decodeURIComponent(pathname);
        let filePath = resolve(
            clientRoot,
            `.${requestedPath === '/' ? '/index.html' : requestedPath}`,
        );

        if (relative(clientRoot, filePath).startsWith('..')) {
            this.#json(response, 404, { error: 'Not found.' });
            return;
        }

        if (!(await this.#isFile(filePath))) {
            filePath = resolve(clientRoot, 'index.html');
        }

        if (!(await this.#isFile(filePath))) {
            this.#json(response, 503, { error: 'Director client is not built.' });
            return;
        }

        const file = await stat(filePath);
        response.statusCode = 200;
        response.setHeader(
            'Content-Type',
            contentTypes[extname(filePath)] ?? 'application/octet-stream',
        );
        response.setHeader('Content-Length', String(file.size));
        response.setHeader(
            'Cache-Control',
            filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );

        if (request.method === 'HEAD') {
            response.end();
            return;
        }

        createReadStream(filePath).pipe(response);
    }

    async #isFile(path: string): Promise<boolean> {
        try {
            return (await stat(path)).isFile();
        } catch {
            return false;
        }
    }

    #json(response: ServerResponse, status: number, payload: unknown): void {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(payload));
    }
}
