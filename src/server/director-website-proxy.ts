import { randomUUID } from 'node:crypto';
import {
    request as httpRequest,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';

import { parse as parseJavaScript, type Identifier, type MemberExpression } from 'acorn';
import { simple as walkJavaScript } from 'acorn-walk';
import { init, parse } from 'es-module-lexer/minimal';

const moduleLexerReady = init();

export class DirectorWebsiteProxy {
    static readonly apiPath = '/director-api/website-proxies';
    static readonly routePath = '/director-website/';

    readonly #targets = new Map<string, URL>();

    async register(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (request.method !== 'POST') {
            this.#json(response, 405, { error: 'Method not allowed.' });
            return;
        }
        const registration = JSON.parse(await this.#body(request)) as { readonly url?: unknown };
        const target = this.#targetUrl(registration.url);
        const existing = [...this.#targets].find(([, value]) => value.href === target.href);
        const id = existing?.[0] ?? randomUUID();
        this.#targets.set(id, target);
        while (this.#targets.size > 32) this.#targets.delete(this.#targets.keys().next().value!);
        this.#json(response, 201, { url: this.#proxyUrl(id, target) });
    }

    async proxy(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const source = new URL(request.url ?? '/', 'http://director.local');
        const match = /^\/director-website\/([^/]+)(\/.*)?$/u.exec(source.pathname);
        const id = match?.[1] ? decodeURIComponent(match[1]) : '';
        const registered = this.#targets.get(id);
        if (!registered) {
            this.#json(response, 404, { error: 'Unknown website proxy.' });
            return;
        }
        const target = new URL(`${match?.[2] || '/'}${source.search}`, registered.origin);
        const prefix = `${DirectorWebsiteProxy.routePath}${encodeURIComponent(id)}`;
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
                        void this.#proxyText(proxyResponse, response, prefix, target, 'html').then(
                            resolveProxy,
                            reject,
                        );
                        return;
                    }
                    if (contentType.toLowerCase().includes('javascript')) {
                        void this.#proxyText(
                            proxyResponse,
                            response,
                            prefix,
                            target,
                            'javascript',
                        ).then(resolveProxy, reject);
                        return;
                    }
                    if (contentType.toLowerCase().includes('text/css')) {
                        void this.#proxyText(proxyResponse, response, prefix, target, 'css').then(
                            resolveProxy,
                            reject,
                        );
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

    async #proxyText(
        upstream: IncomingMessage,
        response: ServerResponse,
        prefix: string,
        target: URL,
        kind: 'html' | 'javascript' | 'css',
    ): Promise<void> {
        const chunks: Buffer[] = [];
        for await (const chunk of upstream) chunks.push(Buffer.from(chunk));
        const base = `${prefix}/`;
        let html = Buffer.concat(chunks).toString('utf8');
        if (kind === 'html') {
            html = html.replace(
                /<script\b[^>]*\bsrc=["']\/@vite\/client["'][^>]*><\/script>\s*/iu,
                '',
            );
            html = html.replace(/(\b(?:src|href|action)=["'])\/(?!\/)/giu, `$1${prefix}/`);
            html = /<base\b[^>]*>/iu.test(html)
                ? html.replace(/<base\b[^>]*>/iu, `<base href="${base}">`)
                : html.replace(/<head(\s[^>]*)?>/iu, (head) => `${head}<base href="${base}">`);
            html = html.replace(
                /<head(\s[^>]*)?>/iu,
                (head) => `${head}${this.#requestBridge(prefix, target.origin)}`,
            );
        } else if (kind === 'javascript') {
            html = await this.#rewriteModuleSpecifiers(html, prefix);
        } else {
            html = html.replace(/url\(\s*(["']?)\/(?!\/)/giu, `url($1${prefix}/`);
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
                    if (!this.#isWebsitePathname(node)) return;
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
        return rewritten;
    }

    #isWebsitePathname(node: MemberExpression): boolean {
        if (node.computed || !this.#isIdentifier(node.property, 'pathname')) return false;
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

    #requestBridge(prefix: string, targetOrigin: string): string {
        const configuration = JSON.stringify({ prefix, targetOrigin }).replace(/</gu, '\\u003c');
        return `<script>(() => {
            const { prefix, targetOrigin } = ${configuration};
            Object.defineProperty(globalThis, '__directorWebsitePathname', {
                value: () => location.pathname.startsWith(prefix + '/')
                    ? location.pathname.slice(prefix.length)
                    : location.pathname === prefix ? '/' : location.pathname,
            });
            try {
                const previewCamera = window.parent !== window &&
                    window.parent.__directorPreviewCameraStream;
                const mediaDevices = navigator.mediaDevices;
                if (typeof previewCamera === 'function' && mediaDevices) {
                    const nativeGetUserMedia = mediaDevices.getUserMedia?.bind(mediaDevices);
                    Object.defineProperty(mediaDevices, 'getUserMedia', {
                        configurable: true,
                        value: async (constraints = {}) => {
                            if (!constraints.video && nativeGetUserMedia) {
                                return nativeGetUserMedia(constraints);
                            }
                            const stream = await previewCamera();
                            return new MediaStream(
                                stream.getVideoTracks().map((track) => track.clone()),
                            );
                        },
                    });
                }
            } catch {}
            const rewrite = (value) => {
                const source = String(value);
                const url = new URL(source, location.href);
                if (url.origin === location.origin &&
                    (url.pathname === prefix || url.pathname.startsWith(prefix + '/'))) {
                    return source;
                }
                if (url.origin === targetOrigin ||
                    (url.origin === location.origin && !url.pathname.startsWith(prefix + '/'))) {
                    return prefix + url.pathname + url.search + url.hash;
                }
                return source;
            };
            const nativeFetch = window.fetch.bind(window);
            window.fetch = (input, init) => nativeFetch(
                input instanceof Request ? new Request(rewrite(input.url), input) : rewrite(input),
                init,
            );
            const nativeOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                return nativeOpen.call(this, method, rewrite(url), ...rest);
            };
            const urlAttributes = new Set(['action', 'href', 'poster', 'src']);
            const nativeSetAttribute = Element.prototype.setAttribute;
            Element.prototype.setAttribute = function(name, value) {
                const rewritten = urlAttributes.has(String(name).toLowerCase())
                    ? rewrite(value)
                    : value;
                return nativeSetAttribute.call(this, name, rewritten);
            };
            const rewriteElementUrls = (element) => {
                for (const name of urlAttributes) {
                    if (!element.hasAttribute(name)) continue;
                    const value = element.getAttribute(name);
                    const rewritten = rewrite(value);
                    if (rewritten !== value) nativeSetAttribute.call(element, name, rewritten);
                }
            };
            new MutationObserver((records) => {
                for (const record of records) {
                    if (record.type === 'attributes') {
                        rewriteElementUrls(record.target);
                        continue;
                    }
                    for (const node of record.addedNodes) {
                        if (!(node instanceof Element)) continue;
                        rewriteElementUrls(node);
                        for (const element of node.querySelectorAll('*')) rewriteElementUrls(element);
                    }
                }
            }).observe(document.documentElement, {
                attributes: true,
                attributeFilter: [...urlAttributes],
                childList: true,
                subtree: true,
            });
        })();</script>`;
    }

    #requestHeaders(headers: IncomingHttpHeaders, target: URL): IncomingHttpHeaders {
        const result = { ...headers };
        result.host = target.host;
        result['accept-encoding'] = 'identity';
        if (result.origin) result.origin = target.origin;
        if (result.referer) result.referer = new URL(target.pathname, target.origin).href;
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

    #proxyUrl(id: string, target: URL): string {
        return `${DirectorWebsiteProxy.routePath}${encodeURIComponent(id)}${target.pathname}${target.search}${target.hash}`;
    }

    #targetUrl(value: unknown): URL {
        if (typeof value !== 'string') throw new TypeError('Website URL must be a string.');
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
            if (size > 64 * 1_024) throw new Error('Request body is too large.');
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
