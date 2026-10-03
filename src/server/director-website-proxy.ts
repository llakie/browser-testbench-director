import { randomUUID } from 'node:crypto';
import {
    request as httpRequest,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as connectNet } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as connectTls } from 'node:tls';

import { parse as parseJavaScript, type Identifier, type MemberExpression } from 'acorn';
import { simple as walkJavaScript } from 'acorn-walk';
import { init, parse } from 'es-module-lexer/minimal';

import { renderDirectorWebsiteBridge } from './director-website-bridge-renderer.js';

const moduleLexerReady = init();

interface WebsiteProxyTarget {
    readonly url: URL;
    readonly browserLanguage: string;
}

export class DirectorWebsiteProxy {
    static readonly apiPath = '/director-api/website-proxies';
    static readonly routePath = '/director-website/';

    readonly #targets = new Map<string, WebsiteProxyTarget>();

    async register(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (request.method !== 'POST') {
            this.#json(response, 405, { error: 'Method not allowed.' });
            return;
        }

        const registration = JSON.parse(await this.#body(request)) as {
            readonly url?: unknown;
            readonly language?: unknown;
            readonly locale?: unknown;
        };
        const target = this.#targetUrl(registration.url);
        const browserLanguage = this.#browserLanguage(registration.language, registration.locale);
        const existing = [...this.#targets].find(
            ([, value]) =>
                value.url.href === target.href && value.browserLanguage === browserLanguage,
        );
        const id = existing?.[0] ?? randomUUID();
        this.#targets.set(id, { url: target, browserLanguage });

        while (this.#targets.size > 32) {
            this.#targets.delete(this.#targets.keys().next().value!);
        }

        this.#json(response, 201, { url: this.#proxyUrl(id, target) });
    }

    async proxy(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const source = new URL(request.url ?? '/', 'http://director.local');
        const route = this.#route(source);

        if (!route) {
            this.#json(response, 404, { error: 'Unknown website proxy.' });
            return;
        }

        const { prefix, target, browserLanguage } = route;
        const send = target.protocol === 'https:' ? httpsRequest : httpRequest;

        await new Promise<void>((resolveProxy, reject) => {
            const proxy = send(
                {
                    protocol: target.protocol,
                    hostname: target.hostname,
                    port: target.port,
                    method: request.method,
                    path: `${target.pathname}${target.search}`,
                    headers: this.#requestHeaders(request.headers, target),
                    rejectUnauthorized: !this.#isLoopback(target.hostname),
                },
                (proxyResponse) => {
                    const contentType = String(proxyResponse.headers['content-type'] ?? '');

                    if (contentType.toLowerCase().includes('text/html')) {
                        void this.#proxyText(
                            proxyResponse,
                            response,
                            prefix,
                            target,
                            browserLanguage,
                            'html',
                        ).then(resolveProxy, reject);
                        return;
                    }

                    if (contentType.toLowerCase().includes('javascript')) {
                        void this.#proxyText(
                            proxyResponse,
                            response,
                            prefix,
                            target,
                            browserLanguage,
                            'javascript',
                        ).then(resolveProxy, reject);
                        return;
                    }

                    if (contentType.toLowerCase().includes('text/css')) {
                        void this.#proxyText(
                            proxyResponse,
                            response,
                            prefix,
                            target,
                            browserLanguage,
                            'css',
                        ).then(resolveProxy, reject);
                        return;
                    }

                    response.writeHead(
                        proxyResponse.statusCode ?? 502,
                        this.#responseHeaders(proxyResponse.headers, prefix, target),
                    );
                    proxyResponse.pipe(response);
                    proxyResponse.once('end', resolveProxy);
                    proxyResponse.once('error', reject);
                },
            );
            proxy.once('error', reject);
            request.pipe(proxy);
        });
    }

    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
        const source = new URL(request.url ?? '/', 'http://director.local');
        const route = this.#route(source);

        if (!route) {
            return false;
        }

        const { target } = route;
        const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
        const upstream =
            target.protocol === 'https:'
                ? connectTls({
                      host: target.hostname,
                      port,
                      servername: this.#isLoopback(target.hostname) ? undefined : target.hostname,
                      rejectUnauthorized: !this.#isLoopback(target.hostname),
                  })
                : connectNet({ host: target.hostname, port });

        upstream.once('connect', () => {
            const headers = this.#requestHeaders(request.headers, target);
            const lines = [
                `${request.method ?? 'GET'} ${target.pathname}${target.search} HTTP/${request.httpVersion}`,
                ...Object.entries(headers).flatMap(([name, value]) => {
                    if (value === undefined) {
                        return [];
                    }

                    return Array.isArray(value)
                        ? value.map((item) => `${name}: ${item}`)
                        : [`${name}: ${value}`];
                }),
                '',
                '',
            ];
            upstream.write(lines.join('\r\n'));

            if (head.length > 0) {
                upstream.write(head);
            }

            socket.pipe(upstream).pipe(socket);
        });
        upstream.once('error', () => socket.destroy());
        socket.once('error', () => upstream.destroy());
        return true;
    }

    async #proxyText(
        upstream: IncomingMessage,
        response: ServerResponse,
        prefix: string,
        target: URL,
        browserLanguage: string,
        kind: 'html' | 'javascript' | 'css',
    ): Promise<void> {
        const chunks: Buffer[] = [];

        for await (const chunk of upstream) {
            chunks.push(Buffer.from(chunk));
        }

        const base = `${prefix}/`;
        let html = Buffer.concat(chunks).toString('utf8');

        if (kind === 'html') {
            html = html.replace(
                /<script\b[^>]*\bsrc=["']\/@vite\/client["'][^>]*><\/script>\s*/iu,
                '',
            );
            html = html.replace(
                /<head(\s[^>]*)?>/iu,
                (head) => `${head}<meta name="google" content="notranslate">`,
            );
            html = html.replace(/(\b(?:src|href|action)=["'])\/(?!\/)/giu, `$1${prefix}/`);
            html = /<base\b[^>]*>/iu.test(html)
                ? html.replace(/<base\b[^>]*>/iu, `<base href="${base}">`)
                : html.replace(/<head(\s[^>]*)?>/iu, (head) => `${head}<base href="${base}">`);
            html = html.replace(
                /<head(\s[^>]*)?>/iu,
                (head) =>
                    `${head}${renderDirectorWebsiteBridge({
                        prefix,
                        targetOrigin: target.origin,
                        browserLanguage,
                    })}`,
            );
        } else if (kind === 'javascript') {
            html = await this.#rewriteModuleSpecifiers(html, prefix);
        } else {
            html = this.#rewriteCssUrls(html, prefix);
        }

        const headers = this.#responseHeaders(upstream.headers, prefix, target);
        delete headers['content-length'];
        delete headers['content-encoding'];
        response.writeHead(upstream.statusCode ?? 502, headers);
        response.end(html);
    }

    async #rewriteModuleSpecifiers(source: string, prefix: string): Promise<string> {
        await moduleLexerReady;
        const [imports] = parse(source);
        const replacements = imports
            .filter(
                (imported) =>
                    imported.n?.startsWith('/') &&
                    !imported.n.startsWith('//') &&
                    !imported.n.startsWith(`${prefix}/`),
            )
            .map((imported) => {
                const specifier = `${prefix}${imported.n}`;
                return {
                    start: imported.s,
                    end: imported.e,
                    value: imported.d >= 0 ? JSON.stringify(specifier) : specifier,
                };
            });

        try {
            const syntax = parseJavaScript(source, {
                allowHashBang: true,
                ecmaVersion: 'latest',
                sourceType: 'module',
            });
            walkJavaScript(syntax, {
                MemberExpression: (node) => {
                    if (!this.#isWebsitePathname(node)) {
                        return;
                    }

                    replacements.push({
                        start: node.start,
                        end: node.end,
                        value: 'globalThis.__directorWebsitePathname()',
                    });
                },
            });
        } catch {
            // A non-standard module can still be proxied without virtualizing its pathname access.
        }

        let rewritten = source;

        for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
            rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`;
        }

        return this.#rewriteCssUrls(rewritten, prefix);
    }

    #rewriteCssUrls(source: string, prefix: string): string {
        return source.replace(/(?<![\w$])url\(\s*(["']?)\/(?!\/)/giu, `url($1${prefix}/`);
    }

    #isWebsitePathname(node: MemberExpression): boolean {
        if (node.computed || !this.#isIdentifier(node.property, 'pathname')) {
            return false;
        }

        const location = node.object;

        if (
            location.type !== 'MemberExpression' ||
            location.computed ||
            !this.#isIdentifier(location.property, 'location')
        ) {
            return false;
        }

        return (
            this.#isIdentifier(location.object, 'window') ||
            this.#isIdentifier(location.object, 'globalThis') ||
            this.#isIdentifier(location.object, 'self')
        );
    }

    #isIdentifier(value: unknown, name: string): value is Identifier {
        return (
            typeof value === 'object' &&
            value !== null &&
            'type' in value &&
            value.type === 'Identifier' &&
            'name' in value &&
            value.name === name
        );
    }

    #requestHeaders(headers: IncomingHttpHeaders, target: URL): IncomingHttpHeaders {
        const result = { ...headers };
        result.host = target.host;
        result['accept-encoding'] = 'identity';

        if (result.origin) {
            result.origin = target.origin;
        }

        if (result.referer) {
            result.referer = new URL(target.pathname, target.origin).href;
        }

        delete result.connection;
        return result;
    }

    #responseHeaders(
        headers: IncomingHttpHeaders,
        prefix: string,
        target: URL,
    ): Record<string, string | string[] | undefined> {
        const result = { ...headers };
        delete result.connection;
        delete result['content-security-policy'];
        delete result['content-security-policy-report-only'];
        delete result['x-frame-options'];
        delete result['transfer-encoding'];

        if (result.location) {
            const location = new URL(String(result.location), target);

            if (location.origin === target.origin) {
                result.location = `${prefix}${location.pathname}${location.search}${location.hash}`;
            }
        }

        if (result['set-cookie']) {
            result['set-cookie'] = result['set-cookie'].map((cookie) =>
                cookie
                    .replace(/;\s*Domain=[^;]*/giu, '')
                    .replace(/;\s*Path=[^;]*/giu, `; Path=${prefix}/`),
            );
        }

        return result;
    }

    #route(source: URL): {
        readonly prefix: string;
        readonly target: URL;
        readonly browserLanguage: string;
    } | null {
        const match = /^\/director-website\/([^/]+)(\/.*)?$/u.exec(source.pathname);
        const id = match?.[1] ? decodeURIComponent(match[1]) : '';
        const registered = this.#targets.get(id);

        if (!registered) {
            return null;
        }

        return {
            prefix: `${DirectorWebsiteProxy.routePath}${encodeURIComponent(id)}`,
            target: new URL(`${match?.[2] || '/'}${source.search}`, registered.url.origin),
            browserLanguage: registered.browserLanguage,
        };
    }

    #proxyUrl(id: string, target: URL): string {
        return `${DirectorWebsiteProxy.routePath}${encodeURIComponent(id)}${target.pathname}${target.search}${target.hash}`;
    }

    #browserLanguage(language: unknown, locale: unknown): string {
        const languageValue =
            typeof language === 'string' ? language.trim().replaceAll('_', '-') : '';
        const region = typeof locale === 'string' ? locale.trim().toUpperCase() : '';

        if (!languageValue) {
            return '';
        }

        try {
            const parsed = new Intl.Locale(languageValue);
            return new Intl.Locale(
                !parsed.region && region ? `${languageValue}-${region}` : languageValue,
            ).toString();
        } catch {
            return region && !languageValue.includes('-')
                ? `${languageValue}-${region}`
                : languageValue;
        }
    }

    #targetUrl(value: unknown): URL {
        if (typeof value !== 'string') {
            throw new TypeError('Website URL must be a string.');
        }

        const url = new URL(value);

        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new TypeError('Website URL must use HTTP or HTTPS.');
        }

        if (url.username || url.password) {
            throw new TypeError('Website URL must not contain credentials.');
        }

        return url;
    }

    #isLoopback(hostname: string): boolean {
        return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
    }

    async #body(request: IncomingMessage): Promise<string> {
        const chunks: Buffer[] = [];
        let size = 0;

        for await (const chunk of request) {
            const buffer = Buffer.from(chunk);
            size += buffer.length;

            if (size > 64 * 1_024) {
                throw new Error('Request body is too large.');
            }

            chunks.push(buffer);
        }

        return Buffer.concat(chunks).toString('utf8');
    }

    #json(response: ServerResponse, status: number, payload: unknown): void {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(payload));
    }
}
