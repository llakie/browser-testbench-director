import { readFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build, type Plugin } from 'esbuild';
import { compileAsync } from 'sass';

export interface ProductionCompilerOptions {
    readonly outputPath?: string;
    readonly minify?: boolean;
    readonly sourcemap?: boolean | 'inline' | 'linked' | 'external';
}

export class CompiledProduction {
    readonly path: string;
    readonly url: URL;

    constructor(path: string) {
        this.path = path;
        this.url = pathToFileURL(path);
    }

    async load(): Promise<unknown> {
        return import(`${this.url.href}?compiled=${Date.now()}`);
    }

    async dispose(): Promise<void> {
        await unlink(this.path).catch(() => undefined);
        await unlink(`${this.path}.map`).catch(() => undefined);
    }
}

export class ProductionCompiler {
    static async compile(
        entryPoint: string | URL,
        options: ProductionCompilerOptions = {},
    ): Promise<CompiledProduction> {
        const sourcePath = entryPoint instanceof URL ? fileURLToPath(entryPoint) : entryPoint;
        const outputPath =
            options.outputPath ??
            join(
                dirname(sourcePath),
                `.${basename(sourcePath, extname(sourcePath))}.bundle-${process.pid}-${Date.now()}.mjs`,
            );
        await build({
            entryPoints: [sourcePath],
            outfile: outputPath,
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node22',
            packages: 'external',
            minify: options.minify ?? false,
            sourcemap: options.sourcemap ?? 'inline',
            plugins: [textAssetPlugin()],
            logLevel: 'silent',
        });
        return new CompiledProduction(outputPath);
    }
}

function textAssetPlugin(): Plugin {
    return {
        name: 'browser-testbench-video-assets',
        setup(buildContext) {
            buildContext.onLoad({ filter: /\.s?css$/ }, async ({ path }) => {
                if (extname(path) === '.scss') {
                    const result = await compileAsync(path, { style: 'expanded' });
                    return {
                        contents: await inlineLocalUrls(result.css, path),
                        loader: 'text',
                        watchFiles: [path, ...result.loadedUrls.map((url) => fileURLToPath(url))],
                    };
                }
                return {
                    contents: await inlineLocalUrls(await readFile(path, 'utf8'), path),
                    loader: 'text',
                };
            });
            buildContext.onLoad({ filter: /\.html$/ }, async ({ path }) => ({
                contents: await readFile(path, 'utf8'),
                loader: 'text',
            }));
        },
    };
}

async function inlineLocalUrls(stylesheet: string, sourcePath: string): Promise<string> {
    const expression = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g;
    let result = '';
    let cursor = 0;
    for (const match of stylesheet.matchAll(expression)) {
        const reference = match[2]?.trim();
        const index = match.index;
        if (!reference || index === undefined || isExternalUrl(reference)) continue;
        const assetPath = resolveAsset(reference, sourcePath);
        const asset = await readFile(assetPath);
        result += stylesheet.slice(cursor, index);
        result += `url("data:${mimeType(assetPath)};base64,${asset.toString('base64')}")`;
        cursor = index + match[0].length;
    }
    return result + stylesheet.slice(cursor);
}

function resolveAsset(reference: string, sourcePath: string): string {
    const cleanReference = reference.split(/[?#]/, 1)[0] ?? reference;
    if (isAbsolute(cleanReference)) return cleanReference;
    if (cleanReference.startsWith('.')) return resolve(dirname(sourcePath), cleanReference);
    return createRequire(pathToFileURL(sourcePath)).resolve(cleanReference);
}

function isExternalUrl(reference: string): boolean {
    return /^(?:data:|https?:|#)/i.test(reference);
}

function mimeType(path: string): string {
    const extension = extname(path).toLowerCase();
    const types: Readonly<Record<string, string>> = {
        '.otf': 'font/otf',
        '.ttf': 'font/ttf',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
    };
    return types[extension] ?? 'application/octet-stream';
}
