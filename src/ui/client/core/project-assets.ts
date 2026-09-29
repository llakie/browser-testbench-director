import type { InputFileReference } from './project-format.js';

export class ProjectAssets {
    static async store(file: File): Promise<InputFileReference> {
        const content = await file.arrayBuffer();
        const sha256 = await this.sha256(content);
        const response = await fetch('/director-api/assets', {
            method: 'POST',
            body: content,
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-Director-Asset-Name': encodeURIComponent(file.name),
                'X-Director-Asset-Sha256': sha256,
            },
        });
        if (!response.ok) throw new Error(await this.error(response));
        return (await response.json()) as InputFileReference;
    }

    static async load(reference: InputFileReference): Promise<File> {
        const response = await fetch(`/director-api/assets/${reference.asset}`);
        if (!response.ok) throw new Error(await this.error(response));
        const content = await response.arrayBuffer();
        if (
            content.byteLength !== reference.size ||
            (await this.sha256(content)) !== reference.sha256
        ) {
            throw new Error(`Project asset is invalid: ${reference.name}`);
        }
        return new File([content], reference.name, { type: reference.type });
    }

    private static async sha256(content: ArrayBuffer): Promise<string> {
        const digest = await crypto.subtle.digest('SHA-256', content);
        return [...new Uint8Array(digest)]
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('');
    }

    private static async error(response: Response): Promise<string> {
        const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
        return typeof payload.error === 'string'
            ? payload.error
            : `Director responded with HTTP ${response.status}.`;
    }
}
