(() => {
    const configuration = {/* director:configuration */};
    const { prefix, targetOrigin } = configuration;

    if (configuration.browserLanguage) {
        try {
            const language = configuration.browserLanguage;
            const languages = [language];
            const defineNavigatorValue = (name, value) => {
                try {
                    Object.defineProperty(navigator, name, {
                        configurable: true,
                        get: () => value,
                    });
                    return true;
                } catch {
                    try {
                        Object.defineProperty(Object.getPrototypeOf(navigator), name, {
                            configurable: true,
                            get: () => value,
                        });
                        return true;
                    } catch {
                        return false;
                    }
                }
            };

            defineNavigatorValue('language', language);
            defineNavigatorValue('languages', languages);
            document.documentElement.lang = language;
        } catch {
            // Safari may expose navigator language as a non-configurable property.
        }
    }

    Object.defineProperty(globalThis, '__directorWebsitePathname', {
        value: () =>
            location.pathname.startsWith(`${prefix}/`)
                ? location.pathname.slice(prefix.length)
                : location.pathname === prefix
                  ? '/'
                  : location.pathname,
    });

    try {
        const previewCamera =
            window.parent !== window ? window.parent.__directorPreviewCameraStream : undefined;

        if (previewCamera) {
            if (!window.isSecureContext) {
                Object.defineProperty(window, 'isSecureContext', {
                    configurable: true,
                    value: true,
                });
            }

            const mediaDevices = navigator.mediaDevices ?? {};
            Object.defineProperty(navigator, 'mediaDevices', {
                configurable: true,
                value: mediaDevices,
            });
            const nativeGetUserMedia = mediaDevices.getUserMedia?.bind(mediaDevices);
            Object.defineProperty(mediaDevices, 'getUserMedia', {
                configurable: true,
                value: async (constraints = {}) => {
                    if (!constraints.video && nativeGetUserMedia) {
                        return nativeGetUserMedia(constraints);
                    }

                    const stream = await previewCamera();

                    return new MediaStream(stream.getVideoTracks().map((track) => track.clone()));
                },
            });
        }
    } catch {
        // Camera passthrough is optional for proxied websites.
    }

    const rewrite = (value) => {
        const source = String(value);
        const url = new URL(source, location.href);

        if (
            url.origin === location.origin &&
            (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
        ) {
            return source;
        }

        if (
            url.origin === targetOrigin ||
            (url.origin === location.origin && !url.pathname.startsWith(`${prefix}/`))
        ) {
            return `${prefix}${url.pathname}${url.search}${url.hash}`;
        }

        return source;
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) =>
        nativeFetch(
            input instanceof Request ? new Request(rewrite(input.url), input) : rewrite(input),
            init,
        );

    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        return nativeOpen.call(this, method, rewrite(url), ...rest);
    };

    const nativePushState = history.pushState.bind(history);
    history.pushState = (state, unused, url) =>
        nativePushState(state, unused, url === undefined || url === null ? url : rewrite(url));
    const nativeReplaceState = history.replaceState.bind(history);
    history.replaceState = (state, unused, url) =>
        nativeReplaceState(state, unused, url === undefined || url === null ? url : rewrite(url));

    const NativeWebSocket = window.WebSocket;

    if (NativeWebSocket) {
        const target = new URL(targetOrigin);
        const rewriteWebSocket = (value) => {
            const url = new URL(String(value), targetOrigin);

            if (url.host !== target.host) {
                return String(value);
            }

            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${protocol}//${location.host}${prefix}${url.pathname}${url.search}${url.hash}`;
        };
        const DirectorWebSocket = function (url, protocols) {
            return protocols === undefined
                ? new NativeWebSocket(rewriteWebSocket(url))
                : new NativeWebSocket(rewriteWebSocket(url), protocols);
        };
        DirectorWebSocket.prototype = NativeWebSocket.prototype;
        Object.setPrototypeOf(DirectorWebSocket, NativeWebSocket);
        window.WebSocket = DirectorWebSocket;
    }

    const urlAttributes = new Set(['action', 'href', 'poster', 'src']);
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        const rewritten = urlAttributes.has(name.toLowerCase()) ? rewrite(value) : value;

        return nativeSetAttribute.call(this, name, rewritten);
    };

    const rewriteElementUrls = (element) => {
        for (const name of urlAttributes) {
            if (!element.hasAttribute(name)) {
                continue;
            }

            const value = element.getAttribute(name);
            const rewritten = rewrite(value);

            if (rewritten !== value) {
                nativeSetAttribute.call(element, name, rewritten);
            }
        }
    };

    new MutationObserver((records) => {
        for (const record of records) {
            if (record.type === 'attributes') {
                rewriteElementUrls(record.target);
                continue;
            }

            for (const node of record.addedNodes) {
                if (!(node instanceof Element)) {
                    continue;
                }

                rewriteElementUrls(node);

                for (const element of node.querySelectorAll('*')) {
                    rewriteElementUrls(element);
                }
            }
        }
    }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: [...urlAttributes],
        childList: true,
        subtree: true,
    });
})();
