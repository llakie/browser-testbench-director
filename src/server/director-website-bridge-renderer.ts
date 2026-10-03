import { readFileSync } from 'node:fs';

export interface DirectorWebsiteBridgeConfiguration {
    readonly prefix: string;
    readonly targetOrigin: string;
    readonly browserLanguage?: string;
}

const configurationSlot = '/* director:configuration */';
const bridgeSource = readFileSync(new URL('./director-website-bridge.js', import.meta.url), 'utf8');

export function renderDirectorWebsiteBridge(
    configuration: DirectorWebsiteBridgeConfiguration,
): string {
    const properties = JSON.stringify(configuration).slice(1, -1).replace(/</gu, '\\u003c');
    const source = bridgeSource
        .replace(configurationSlot, properties)
        .replace(/<\/script/giu, '<\\/script');

    return `<script>${source}</script>`;
}
