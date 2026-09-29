(() => {
    const { prefix, targetOrigin } = {/* director:configuration */};

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
        const mediaDevices = navigator.mediaDevices;

        if (previewCamera && mediaDevices) {
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
