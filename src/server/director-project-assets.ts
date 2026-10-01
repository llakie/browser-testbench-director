import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, resolve } from 'node:path';

export class DirectorProjectAssets {
    static readonly apiPath = '/director-api/assets';

    constructor(private readonly directory: string) {}

    async handle(
        request: IncomingMessage,
        response: ServerResponse,
        pathname: string,
    ): Promise<void> {
        if (pathname === DirectorProjectAssets.apiPath && request.method === 'POST') {
            await this.#store(request, response);
            return;
        }

        if (pathname.startsWith(`${DirectorProjectAssets.apiPath}/`) && request.method === 'GET') {
            await this.#read(response, pathname.slice(DirectorProjectAssets.apiPath.length + 1));
            return;
        }

        this.#json(response, 405, { error: 'Method not allowed.' });
    }

    async #store(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const content = await this.#body(request);
        const sha256 = createHash('sha256').update(content).digest('hex');
        const suppliedDigest = String(request.headers['x-director-asset-sha256'] ?? '');

        if (suppliedDigest && suppliedDigest !== sha256) {
            throw new Error('Asset checksum mismatch.');
        }

        const encodedName = String(request.headers['x-director-asset-name'] ?? 'asset');
        const name = basename(decodeURIComponent(encodedName)) || 'asset';
        const targetDirectory = resolve(this.directory, sha256);
        const target = resolve(targetDirectory, name);
        await mkdir(targetDirectory, { recursive: true });
        await writeFile(target, content, { flag: 'wx' }).catch(async (error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }

            if ((await stat(target)).size !== content.length) {
                throw new Error('Stored asset is invalid.');
            }
        });
        this.#json(response, 201, {
            asset: `${sha256}/${encodeURIComponent(name)}`,
            name,
            type: String(request.headers['content-type'] ?? 'application/octet-stream'),
            size: content.length,
        });
    }

    async #read(response: ServerResponse, reference: string): Promise<void> {
        const [sha256, encodedName, ...rest] = reference.split('/');

        if (!/^[a-f0-9]{64}$/u.test(sha256 ?? '') || !encodedName || rest.length) {
            this.#json(response, 404, { error: 'Invalid asset reference.' });
            return;
        }

        const name = basename(decodeURIComponent(encodedName));
        const content = await readFile(resolve(this.directory, sha256!, name));
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/octet-stream');
        response.setHeader('Content-Length', String(content.length));
        response.setHeader('X-Director-Asset-Name', encodeURIComponent(name));
        response.end(content);
    }

    async #body(request: IncomingMessage): Promise<Buffer> {
        const chunks: Buffer[] = [];
        let size = 0;

        for await (const chunk of request) {
            const buffer = Buffer.from(chunk);
            size += buffer.length;

            if (size > 250 * 1_024 * 1_024) {
                throw new Error('Asset exceeds 250 MB.');
            }

            chunks.push(buffer);
        }

        return Buffer.concat(chunks);
    }

    #json(response: ServerResponse, status: number, payload: unknown): void {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(payload));
    }
}
