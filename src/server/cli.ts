#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserTestbenchInstallation } from './browser-testbench-installation.js';
import { DirectorServer } from './director-server.js';
import { LocalHttpsCertificate } from './local-https-certificate.js';
import { McpClientIntegration } from './mcp-client-integration.js';
import { DirectorMcpServer } from './mcp-server.js';

interface ServerOptions {
    readonly host: string;
    readonly port: number;
    readonly browserTestbenchUrl: string;
    readonly development: boolean;
    readonly https: boolean;
    readonly httpsCertificate?: string;
    readonly httpsKey?: string;
}

await main(process.argv.slice(2));

async function main(arguments_: readonly string[]): Promise<void> {
    const command = arguments_[0] && !arguments_[0].startsWith('--') ? arguments_[0] : 'start';
    const commandArguments =
        command === 'start' && arguments_[0] !== 'start' ? arguments_ : arguments_.slice(1);
    const values = parseValues(commandArguments);
    const workspace = resolve(values.get('workspace') ?? process.cwd());

    if (command === 'mcp') {
        await DirectorMcpServer.start(workspace);
        return;
    }

    const integration = mcpIntegration(workspace);

    if (command === 'mcp-config') {
        process.stdout.write(`${integration.configuration(values.get('client') ?? 'codex')}\n`);
        return;
    }

    if (command !== 'start') {
        throw new Error(`Unknown command: ${command}`);
    }

    await startServer(serverOptions(values), workspace, integration);
}

async function startServer(
    options: ServerOptions,
    projectDirectory: string,
    mcpIntegrationService: McpClientIntegration,
): Promise<void> {
    const packageRoot = await findPackageRoot(dirname(fileURLToPath(import.meta.url)));
    const browserTestbench = await BrowserTestbenchInstallation.resolve();
    const https = options.https
        ? await LocalHttpsCertificate.resolve(
              projectDirectory,
              options.httpsCertificate,
              options.httpsKey,
          )
        : undefined;
    let closeFrontend = async (): Promise<void> => undefined;
    let frontend:
        ((request: IncomingMessage, response: ServerResponse) => Promise<void>) | undefined;
    let handleFrontend:
        ((request: IncomingMessage, response: ServerResponse) => Promise<void>) | undefined;

    if (options.development) {
        frontend = async (request, response) => {
            if (!handleFrontend) {
                throw new Error('Director frontend is not ready.');
            }

            await handleFrontend(request, response);
        };
    }

    const server = new DirectorServer({
        host: options.host,
        port: options.port,
        projectDirectory,
        clientDirectory: resolve(packageRoot, 'dist/ui'),
        browserTestbenchUrl: options.browserTestbenchUrl,
        browserTestbench,
        https,
        mcpIntegration: mcpIntegrationService,
        frontend,
    });

    if (options.development) {
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({
            root: packageRoot,
            appType: 'spa',
            plugins: options.https
                ? [
                      {
                          name: 'director-disable-https-hmr-client',
                          transformIndexHtml: {
                              order: 'post',
                              handler: (html: string) =>
                                  html.replace(
                                      /\s*<script type="module" src="\/@vite\/client"><\/script>/u,
                                      '',
                                  ),
                          },
                      },
                  ]
                : [],
            server: {
                middlewareMode: true,
                hmr: options.https
                    ? false
                    : {
                          server: server.listener(),
                          host: options.host,
                          clientPort: options.port,
                      },
            },
        });

        if (options.https) {
            await vite.ws.close();
        }

        handleFrontend = (request, response) =>
            new Promise<void>((resolveRequest, reject) => {
                response.once('finish', resolveRequest);
                vite.middlewares(request, response, (error?: unknown) => {
                    if (error) {
                        reject(error);
                    } else if (!response.writableEnded) {
                        response.statusCode = 404;
                        response.end('Not found.');
                    }
                });
            });
        closeFrontend = () => vite.close();
    }

    await server.start();
    process.stdout.write(`Browser Testbench Director listening on ${server.origin()}\n`);

    let closing = false;
    const close = async (): Promise<void> => {
        if (closing) {
            return;
        }

        closing = true;
        await closeFrontend();
        await server.close();
    };

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
            void close().finally(() => process.exit(0));
        });
    }
}

function mcpIntegration(workspace: string): McpClientIntegration {
    const executionArguments = process.execArgv.map((argument) =>
        argument === 'tsx' ? fileURLToPath(import.meta.resolve('tsx')) : argument,
    );
    return new McpClientIntegration(process.execPath, [
        ...executionArguments,
        fileURLToPath(import.meta.url),
        'mcp',
        '--workspace',
        workspace,
    ]);
}

async function findPackageRoot(start: string): Promise<string> {
    let directory = start;

    while (true) {
        try {
            const packageJson = JSON.parse(
                await readFile(resolve(directory, 'package.json'), 'utf8'),
            ) as { name?: string };

            if (packageJson.name === 'browser-testbench-director') {
                return directory;
            }
        } catch {
            // Continue with the parent directory.
        }

        const parent = dirname(directory);

        if (parent === directory) {
            throw new Error('Director package root could not be located.');
        }

        directory = parent;
    }
}

function parseValues(arguments_: readonly string[]): Map<string, string> {
    const values = new Map<string, string>();

    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index]!;

        if (argument === '--dev' || argument === '--https') {
            values.set(argument.slice(2), 'true');
            continue;
        }

        if (!argument.startsWith('--') || !arguments_[index + 1]) {
            throw new Error(`Unknown or incomplete option: ${argument}`);
        }

        values.set(argument.slice(2), arguments_[index + 1]!);
        index += 1;
    }

    return values;
}

function serverOptions(values: ReadonlyMap<string, string>): ServerOptions {
    const port = Number(values.get('port') ?? process.env['PORT'] ?? 5173);

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('Port must be an integer between 1 and 65535.');
    }

    return {
        host: values.get('host') ?? process.env['HOST'] ?? '127.0.0.1',
        port,
        browserTestbenchUrl:
            values.get('browser-testbench-url') ??
            process.env['BROWSER_TESTBENCH_URL'] ??
            'http://127.0.0.1:55808',
        development: values.get('dev') === 'true',
        https:
            values.get('https') === 'true' ||
            Boolean(values.get('https-cert') || values.get('https-key')),
        httpsCertificate: values.get('https-cert'),
        httpsKey: values.get('https-key'),
    };
}
