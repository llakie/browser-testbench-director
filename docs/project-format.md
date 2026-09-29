# Director Project Format

Director projects are stored as UTF-8 encoded JSON files with the `.btd.json` extension. `format` and `version` form the stable format identifier. Version 10 contains `input` and `capability` nodes, exactly one `website` root node, executable `layer`, `javascript`, `browser-action`, and `browser-wait` nodes, and explicit connections. Earlier versions are not supported.

```json
{
    "format": "browser-testbench-director",
    "version": 10,
    "name": "Guess the Price",
    "preview": {
        "preset": "phone-portrait"
    },
    "browserSession": {
        "permissions": [],
        "language": "",
        "locale": ""
    },
    "nodes": [
        {
            "id": "camera-image",
            "type": "input",
            "name": "Card image",
            "position": null,
            "accept": "image/jpeg,image/png,image/webp",
            "required": true,
            "prepare": {
                "modules": [
                    "projects/guess-the-price/prepare/orient-camera.mjs",
                    "projects/guess-the-price/prepare/camera.mjs"
                ]
            }
        },
        {
            "id": "story-font",
            "type": "input",
            "name": "Story font",
            "position": null,
            "accept": ".ttf,font/ttf",
            "required": true
        },
        {
            "id": "camera-capability",
            "type": "capability",
            "name": "Virtual camera",
            "position": null,
            "capability": "camera"
        },
        {
            "id": "website-root",
            "type": "website",
            "name": "Website",
            "position": null,
            "url": "https://www.binderium.com/"
        },
        {
            "id": "prepare-website",
            "type": "javascript",
            "name": "Prepare website",
            "position": null,
            "source": "const card = await director.waitFor('#card');\ncard.dataset.ready = 'true';"
        },
        {
            "id": "wait-for-camera-choice",
            "type": "browser-wait",
            "name": "Wait for camera choice",
            "position": null,
            "condition": "element",
            "selector": "[data-testid=\"select-camera-source\"]",
            "timeoutMs": 30000,
            "omitFromRecording": true
        },
        {
            "id": "open-camera",
            "type": "browser-action",
            "name": "Open camera",
            "position": null,
            "selector": "[data-testid=\"select-camera-source\"]"
        },
        {
            "id": "layer-guess-price",
            "type": "layer",
            "name": "Guess the Price",
            "position": null,
            "placement": {
                "reference": {
                    "type": "viewport"
                },
                "horizontal": "center",
                "vertical": "center"
            },
            "playback": {
                "durationMs": 0,
                "removeAfter": false
            },
            "source": {
                "html": "<section id=\"guess-price-layer\"></section>",
                "css": "#guess-price-layer { width: min(90vw, 32rem); }",
                "javascript": "await director.wait(500);\ndocument.querySelector('#guess-price-layer').textContent = 'Play';"
            }
        }
    ],
    "connections": [
        {
            "id": "camera-image--camera-capability",
            "source": "camera-image",
            "target": "camera-capability"
        },
        {
            "id": "camera-capability--website-root",
            "source": "camera-capability",
            "target": "website-root"
        },
        {
            "id": "story-font--website-root",
            "source": "story-font",
            "target": "website-root"
        },
        {
            "id": "website-root--prepare-website",
            "source": "website-root",
            "target": "prepare-website"
        },
        {
            "id": "prepare-website--wait-for-camera-choice",
            "source": "prepare-website",
            "target": "wait-for-camera-choice"
        },
        {
            "id": "wait-for-camera-choice--open-camera",
            "source": "wait-for-camera-choice",
            "target": "open-camera"
        },
        {
            "id": "open-camera--layer-guess-price",
            "source": "open-camera",
            "target": "layer-guess-price"
        }
    ]
}
```

Every node and connection ID must be unique within a project. IDs, node types, graph positions, connection endpoints, asset metadata, `format`, and `version` are managed by Director rather than entered as free-form project settings. A connection references existing nodes through `source` and `target`. The executable workflow starting at the website root remains linear. Any number of input nodes may connect directly to the website root or to a capability. A connected capability has exactly one input and then connects to the website root. The order of the `nodes` array does not affect execution. Version 10 rejects unknown properties instead of silently preserving hidden state.

`preview.preset` stores only the portable local-preview choice. Supported references are `phone-portrait`, `phone-landscape`, `tablet-portrait`, `tablet-landscape`, and `desktop`; Director resolves their CSS viewport dimensions and device-pixel ratio from its central preset catalog. Browser Testbench target IDs are installation-specific and are therefore never stored in a project. A real device, simulator, or emulator records at its native fixed dimensions. A desktop recording that emulates the preview preset is exported at CSS viewport × preset DPR (for example, `360 × 640` at DPR 3 becomes `1080 × 1920`).

`input` nodes describe any number of generic runtime files without embedding their local contents in the project file. A selection is stored by content address under `projects/.director-assets/`; in the JSON, `file` contains only the content-addressed asset path, filename, MIME type, and size. The SHA-256 digest is the first segment of the asset path and is not stored a second time. When the project is opened again, Director restores and verifies the file automatically. The file picker and current selection are visible directly in the diagram node; MIME types, required state, and preparation modules are configured in the node properties. Connected input nodes are validated and prepared before the website starts. `required: true` prevents execution until a file has been selected. Optionally, `prepare.modules` contains an ordered pipeline of `.mjs` modules below `projects/`. Each module exports `async prepare({ sourcePath, targetPath })`, writes the prepared file to `targetPath`, and returns `{ filename, contentType }`; its output becomes the next module's input. Director itself has no knowledge of project-specific transformations.

A `capability` node describes how the browser environment provides a connected input. The initially supported `camera` capability connects an image input to the website as a virtual camera. Director automatically derives camera permission, media injection, and target compatibility from it. Browser Testbench can inject the image natively on mobile targets; desktop browsers use Director's reload-safe preview shell. Recording targets must additionally support viewport recording. The file itself remains owned by the preceding input node.

The global project settings expose `language`, `locale`, and additional website `permissions`. On mobile targets, language and locale configure the Appium language and region. On supported desktop browsers Director combines them into a browser language such as `de-DE`, which is then available through `navigator.language`. Empty language values retain the target defaults. Permissions are granted to the website origin when the Browser Testbench session starts. Requirements derived from capability nodes are added automatically and do not need to be configured again. Local Android loopback URLs automatically use Browser Testbench's secure reverse mapping; this runtime detail is intentionally not stored in the project.

In the scene graph, a connection is drawn from a node's orange output to the next node's gray input. Clicking the midpoint of a connection selects it; it can then be deleted with the trash button in the graph header or with `Delete`/`Backspace`. Nodes that cannot be reached from the website root are rendered with a dashed outline and skipped during workflow playback.

`position: null` means that ELK arranges the node automatically. New and duplicated nodes start in this state. Director stores a fixed `{ "x": …, "y": … }` position only after a node has actually been moved. Manually positioned nodes remain untouched by later automatic recalculations. The auto-layout button resets every position to `null`. ELK Layered distributes long workflows compactly across multiple rows with graph wrapping; JointJS routes connections orthogonally around other nodes. The workflow order remains unchanged.

The website root's `url` is loaded behind the layers. A `javascript` node runs in that website's document, while layer JavaScript runs in the overlay document. `browser-wait` waits for the configured `element`, `url`, or `script` condition with a positive `timeoutMs`. It stores exactly one condition payload: `selector`, `value`, or `script`, respectively. A script wait repeats until it returns a truthy value. A `browser-action` is currently a click node, so its selector is sufficient and no redundant one-option action field is stored. Both node types use native Browser Testbench endpoints in a remote preview.

`placement` aligns layer content within a reference rectangle. `horizontal` accepts `left`, `center`, or `right`; `vertical` accepts `top`, `center`, or `bottom`. Together, the two values form the 3×3 alignment grid. `reference` selects the reference rectangle:

- `{ "type": "viewport" }` uses the entire viewport.
- `{ "type": "layer", "nodeId": "…" }` uses the content container of a preceding layer node. Its geometry is followed live while it remains visible; after removal, the last valid rectangle from the current run is used.
- `{ "type": "dom", "selector": "…" }` uses the first matching element in the website DOM. The editor can select the element through Browser Testbench.

The runtime positions a dedicated anchor container for this purpose. It does not modify the actual layer content's `transform`, leaving it fully available for layer animations. A target that cannot be measured causes an execution error. Measured rectangles belong only to the current run and are not stored in the project.

Content dimensions remain the responsibility of the layer CSS. HTML, CSS, and JavaScript are preserved unchanged as strings and assembled in an isolated `iframe` for preview. Unknown formats, versions, placements, or incomplete layer sources are rejected during loading.

`playback.durationMs` keeps a layer visible for the specified duration after its JavaScript completes. With `removeAfter: true`, the runtime then removes both the overlay and its associated style. Catch-up skips the hold duration while still executing mount, JavaScript, return value handling, and cleanup. With `durationMs: 0` and `removeAfter: false`, a layer remains mounted.

## Playback and Runtime

- **Play node** reloads the website, executes every predecessor with `director.speed === "catchup"`, plays only the selected node live, and then stops. Selecting a node alone does not modify browser state.
- **Run on current state** is a secondary development action that executes only the selected node without a reset.
- **Play workflow** reloads the website and executes every node live.
- **Record workflow** opens a fresh Browser Testbench session and records its viewport during complete workflow playback. Mobile targets keep their native fixed pixel dimensions; desktop emulation derives them from the selected preview preset and its DPR. Director's export pass preserves the selected dimensions while removing omitted wait intervals.

The runtime provides layer and JavaScript nodes with `director.wait(milliseconds)`, `director.waitFor(selector, timeout?)`, `director.results`, and `director.inputs`. `director.inputs` is an immutable mapping from selected non-camera files to data URLs. `director.wait` waits for real time during live playback and returns immediately during catch-up. `waitFor` and standalone `browser-wait` nodes remain real state conditions during catch-up. With `omitFromRecording: true`, a `browser-wait` node still runs in real time, but its interval is excluded from the video export. With `false`, the wait remains part of the export. Independently used global timers are deliberately not modified. This keeps arbitrary JavaScript understandable; only time described explicitly through the runtime can be accelerated safely.

Every executable node may return a JSON-compatible value. The runtime stores it under the node ID. Subsequent layer and JavaScript nodes can access it, for example through `director.results['recognized-card'].cardName`. A complete workflow and primary node playback begin with an empty result context; predecessors rebuild it during catch-up. Only the secondary development action runs with results from the current page state. Navigating or reloading the website discards the context.

In a layer node, `director.root` references that layer's content root; in a JavaScript node, it is `null`. `director.document` references the document currently being controlled. Websites such as Binderium that prevent embedding through `frame-ancestors 'none'` or `X-Frame-Options: DENY` cannot appear as the background of the local iframe preview. Instead, the Browser Testbench preview opens such websites as the main document and injects layers and JavaScript directly into the page through WebDriver.
