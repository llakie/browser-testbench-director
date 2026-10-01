import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface StoredPreview {
    readonly nodeId: string;
    readonly document: string;
}

export class DirectorPreviewRoutes {
    private static readonly maximumDocumentBytes = 10 * 1024 * 1024;
    private static readonly maximumStoredPreviews = 32;
    private readonly previews = new Map<string, StoredPreview>();

    async publish(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (request.method !== 'POST') {
            this.json(response, 405, { error: 'Method not allowed.' });
            return;
        }

        try {
            const nodeId = decodeURIComponent(
                (request.url ?? '/').replace(/^\/director-api\/previews\/nodes\/?/u, ''),
            );

            if (!nodeId) {
                this.json(response, 400, { error: 'A node ID is required.' });
                return;
            }

            const document = await this.readDocument(request);
            const token = randomUUID();
            this.previews.set(token, { nodeId, document });
            this.prune();
            this.json(response, 201, {
                url: `/director-preview/nodes/${encodeURIComponent(nodeId)}/${token}`,
            });
        } catch (error) {
            this.json(response, 413, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    render(request: IncomingMessage, response: ServerResponse): void {
        if (request.method !== 'GET') {
            this.json(response, 405, { error: 'Method not allowed.' });
            return;
        }

        const parts = (request.url ?? '').split('/').filter(Boolean);
        const token = parts.at(-1) ?? '';
        const preview = this.previews.get(token);
        const requestedNodeId = parts.length > 1 ? decodeURIComponent(parts.at(-2) ?? '') : '';

        if (!preview || preview.nodeId !== requestedNodeId) {
            this.json(response, 404, { error: 'Preview not found.' });
            return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-same-origin');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(preview.document);
    }

    private async readDocument(request: IncomingMessage): Promise<string> {
        const chunks: Buffer[] = [];
        let size = 0;

        for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.byteLength;

            if (size > DirectorPreviewRoutes.maximumDocumentBytes) {
                throw new Error('The preview document exceeds the 10 MB limit.');
            }

            chunks.push(buffer);
        }

        return Buffer.concat(chunks).toString('utf8');
    }

    private prune(): void {
        while (this.previews.size > DirectorPreviewRoutes.maximumStoredPreviews) {
            const oldest = this.previews.keys().next().value as string | undefined;

            if (!oldest) {
                return;
            }

            this.previews.delete(oldest);
        }
    }

    private json(response: ServerResponse, status: number, payload: unknown): void {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(payload));
    }
}
