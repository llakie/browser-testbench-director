import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';

interface PreparationContext {
    readonly sourcePath: string;
    readonly targetPath: string;
}

interface PreparationResult {
    readonly filename: string;
    readonly contentType: string;
}

interface PreparationModule {
    readonly prepare?: (context: PreparationContext) => Promise<PreparationResult>;
}

export class DirectorInputPreparations {
    constructor(private readonly projectRoot = resolve('projects')) {}

    static resolveModule(modulePath: string, projectRoot = resolve('projects')): string {
        const resolved = resolve(modulePath);
        const projectRelativePath = relative(projectRoot, resolved);

        if (
            !modulePath.trim() ||
            isAbsolute(modulePath) ||
            projectRelativePath.startsWith('..') ||
            isAbsolute(projectRelativePath) ||
            !resolved.endsWith('.mjs')
        ) {
            throw new Error('Preparation modules must be .mjs files below projects/.');
        }

        return resolved;
    }

    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (request.method !== 'POST') {
            this.json(response, 405, { error: 'Method not allowed.' });
            return;
        }

        const directory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-input-'));
        const sourcePath = resolve(directory, 'input');
        const targetPath = resolve(directory, 'output');

        try {
            const modulePath = this.modulePath(request);
            await pipeline(request, createWriteStream(sourcePath));
            const moduleStats = await stat(modulePath);
            const imported = (await import(
                `${pathToFileURL(modulePath).href}?mtime=${moduleStats.mtimeMs}`
            )) as PreparationModule;

            if (typeof imported.prepare !== 'function') {
                throw new Error('Preparation module must export an async prepare function.');
            }

            const result = await imported.prepare({ sourcePath, targetPath });

            if (!result?.filename?.trim() || !result.contentType?.trim()) {
                throw new Error('Preparation module returned invalid output metadata.');
            }

            const output = await stat(targetPath);
            response.statusCode = 200;
            response.setHeader('Content-Type', result.contentType);
            response.setHeader('Content-Length', String(output.size));
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('X-Director-File-Name', encodeURIComponent(result.filename));
            await pipeline(createReadStream(targetPath), response);
        } catch (error) {
            if (!response.headersSent) {
                this.json(response, 422, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }

    private modulePath(request: IncomingMessage): string {
        const url = new URL(request.url ?? '/', 'http://director.local');
        return DirectorInputPreparations.resolveModule(
            url.searchParams.get('module') ?? '',
            this.projectRoot,
        );
    }

    private json(response: ServerResponse, status: number, payload: unknown): void {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(payload));
    }
}
