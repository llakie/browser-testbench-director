import type { BrowserSession } from '../core/types.js';

export interface StyleAsset {
    readonly id: string;
    readonly content: string;
}

export interface HtmlAsset {
    readonly id: string;
    readonly content: string;
    readonly tagName?: string;
    readonly parentSelector?: string;
}

const DEFAULT_CHUNK_SIZE = 192 * 1_024;

export class DomAssetInstaller {
    readonly #session: BrowserSession;
    readonly #chunkSize: number;
    #transferSequence = 0;

    constructor(session: BrowserSession, { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
        if (!session?.evaluate) {
            throw new TypeError('DomAssetInstaller benötigt eine Browser-Session.');
        }
        if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
            throw new TypeError('Die Chunk-Größe muss eine positive Ganzzahl sein.');
        }
        this.#session = session;
        this.#chunkSize = chunkSize;
    }

    async installStyle(asset: StyleAsset): Promise<void> {
        validateAsset(asset, 'Style');
        const transferKey = await this.#transfer(asset.content);
        try {
            await this.#session.evaluate(INSTALL_STYLE_SCRIPT, [asset.id, transferKey]);
        } finally {
            await this.#clearTransfer(transferKey);
        }
    }

    async installHtml(asset: HtmlAsset): Promise<void> {
        validateAsset(asset, 'HTML');
        const transferKey = await this.#transfer(asset.content);
        try {
            await this.#session.evaluate(INSTALL_HTML_SCRIPT, [
                asset.id,
                transferKey,
                asset.tagName ?? 'div',
                asset.parentSelector ?? 'body',
            ]);
        } finally {
            await this.#clearTransfer(transferKey);
        }
    }

    async #transfer(content: string): Promise<string> {
        const key = `__browserTestbenchAsset_${process.pid}_${Date.now()}_${this.#transferSequence++}`;
        await this.#session.evaluate(`window[arguments[0]] = '';`, [key]);
        for (let offset = 0; offset < content.length; offset += this.#chunkSize) {
            await this.#session.evaluate(`window[arguments[0]] += arguments[1];`, [
                key,
                content.slice(offset, offset + this.#chunkSize),
            ]);
        }
        return key;
    }

    async #clearTransfer(key: string): Promise<void> {
        await this.#session.evaluate(`delete window[arguments[0]];`, [key]);
    }
}

function validateAsset(asset: StyleAsset | HtmlAsset, kind: string): void {
    if (!asset?.id || typeof asset.id !== 'string') {
        throw new TypeError(`${kind}-Asset benötigt eine ID.`);
    }
    if (typeof asset.content !== 'string') {
        throw new TypeError(`${kind}-Asset benötigt String-Inhalt.`);
    }
}

const INSTALL_STYLE_SCRIPT = String.raw`
    const id = arguments[0];
    const content = window[arguments[1]];
    let style = document.getElementById(id);
    if (!style) {
        style = document.createElement('style');
        style.id = id;
        document.head.append(style);
    }
    style.textContent = content;
`;

const INSTALL_HTML_SCRIPT = String.raw`
    const id = arguments[0];
    const content = window[arguments[1]];
    const tagName = arguments[2];
    const parentSelector = arguments[3];
    let element = document.getElementById(id);
    if (!element) {
        const parent = document.querySelector(parentSelector);
        if (!parent) throw new Error('DOM-Asset-Ziel nicht gefunden: ' + parentSelector);
        element = document.createElement(tagName);
        element.id = id;
        parent.append(element);
    }
    element.innerHTML = content;
`;
