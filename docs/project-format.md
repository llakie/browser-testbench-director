# Director Project Format

Director projects are stored as UTF-8 encoded JSON files with the `.btd.json` extension. `format` and `version` form the stable format identifier. Version 15 contains `input`, `capability`, `merge`, `audio`, and terminal `video-output` nodes, exactly one `website` root node, executable `layer`, `javascript`, `browser-action`, and `browser-wait` nodes, and explicit connections. Earlier versions are not supported.

```json
{
    "format": "browser-testbench-director",
    "version": 15,
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
        },
        {
            "id": "story-merge",
            "type": "merge",
            "name": "Story complete",
            "position": null,
            "waitFor": "all"
        },
        {
            "id": "play-soundtrack",
            "type": "audio",
            "name": "Play soundtrack",
            "position": null,
            "volume": 0.8,
            "envelope": [
                { "time": 0, "gain": 0 },
                { "time": 0.1, "gain": 1 },
                { "time": 0.9, "gain": 1 },
                { "time": 1, "gain": 0 }
            ],
            "waitForEnd": false
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

Every node and connection ID must be unique within a project. IDs, node types, graph positions, connection endpoints, asset metadata, `format`, and `version` are managed by Director rather than entered as free-form project settings. A connection references existing nodes through `source` and `target`. Any workflow node may have multiple outgoing connections; their branches start independently as soon as their predecessor completes. Only a `merge` node may have multiple workflow predecessors. `waitFor: "all"` releases its successor after every incoming branch completes, while `waitFor: "any"` releases it after the first branch completes. The losing branches are cancelled. Any number of input nodes may connect directly to the website root, to a capability, or to an audio node. A connected capability has exactly one input and then connects to the website root. An audio node has one workflow predecessor plus one audio file input; its asset connection is not a second workflow predecessor. Its `volume` is the master gain. Its `envelope` contains at least two strictly time-ordered `{ "time", "gain" }` points between `0` and `1`; it starts at time `0`, ends at time `1`, and is linearly interpolated. A `video-output` node has at most one predecessor and no successor. It stores its Browser Testbench `targetId` and MP4 `filename`. The order of the `nodes` array does not affect execution. Version 15 rejects unknown properties instead of silently preserving hidden state.

`preview.preset` stores only the portable local-preview choice. Supported references are `phone-portrait`, `phone-landscape`, `tablet-portrait`, `tablet-landscape`, and `desktop`; Director resolves their CSS viewport dimensions and device-pixel ratio from its central preset catalog. Remote preview selections remain transient; only a video-output node persists the target selected for that export. A real device, simulator, or emulator records at its native fixed dimensions. A desktop recording that emulates the preview preset is exported at CSS viewport × preset DPR (for example, `360 × 640` at DPR 3 becomes `1080 × 1920`).

`input` nodes describe any number of generic runtime files without embedding their local contents in the project file. A selection is stored by content address under `projects/.director-assets/`; in the JSON, `file` contains only the content-addressed asset path, filename, MIME type, and size. The SHA-256 digest is the first segment of the asset path and is not stored a second time. When the project is opened again, Director restores and verifies the file automatically. The file picker and current selection are visible directly in the diagram node; MIME types, required state, and preparation modules are configured in the node properties. Connected input nodes are validated and prepared before the website starts. `required: true` prevents execution until a file has been selected. Optionally, `prepare.modules` contains an ordered pipeline of `.mjs` modules below `projects/`. Each module exports `async prepare({ sourcePath, targetPath })`, writes the prepared file to `targetPath`, and returns `{ filename, contentType }`; its output becomes the next module's input. Director itself has no knowledge of project-specific transformations.

An input node accepting `text/css` and connected directly to the website root is a global stylesheet for the layer document. Its file is required for playback even when the input's `required` flag is false. Director loads it before executing any layer, including in remote preview and recording. Multiple global stylesheets follow their input-node order in the project. They can define shared variables and styles for all layers, but do not style the website inside its separate iframe. Ordinary layer CSS still belongs to its layer and is removed with that layer.

A `capability` node describes how the browser environment provides a connected input. The initially supported `camera` capability connects an image input to the website as a virtual camera. Director automatically derives camera permission, media injection, and target compatibility from it. Browser Testbench can inject the image natively on mobile targets; desktop browsers use Director's reload-safe preview shell. Recording targets must additionally support viewport recording. The file itself remains owned by the preceding input node.

An `audio` node plays the file supplied by its connected input at `volume` from `0` to `1`. Its normalized `envelope` multiplies that master volume over the complete source-file duration. With `waitForEnd: true`, the workflow successor waits for playback to finish. With `false`, playback continues while the workflow advances. Optional `loop: true` repeats the file until the run ends or a JavaScript/layer node calls `director.stopAudio(nodeId)`. A loop with `waitForEnd: true` needs a `waitFor: "any"` merge or manual cancellation. Catch-up skips audible playback. Audio assets use the same persistent input storage and validation as every other file input.

The global project settings expose `language`, `locale`, and additional website `permissions`. On mobile targets, language and locale configure the Appium language and region. On supported desktop browsers Director combines them into a browser language such as `de-DE`, which is then available through `navigator.language`. Empty language values retain the target defaults. Permissions are granted to the website origin when the Browser Testbench session starts. Requirements derived from capability nodes are added automatically and do not need to be configured again. Local Android loopback URLs automatically use Browser Testbench's secure reverse mapping; this runtime detail is intentionally not stored in the project.

In the scene graph, a connection is drawn from a node's orange output to the next node's gray input. Multiple outgoing connections create parallel branches. Multiple workflow inputs are valid only on a merge node; an audio node additionally accepts one file-input connection. Clicking the midpoint of a connection selects it; it can then be deleted with the trash button in the graph header or with `Delete`/`Backspace`. Nodes that cannot be reached from the website root are rendered with a dashed outline and skipped during workflow playback.

`position: null` means that ELK arranges the node automatically. New and duplicated nodes start in this state. Director stores a fixed `{ "x": …, "y": … }` position only after a node has actually been moved. Manually positioned nodes remain untouched by later automatic recalculations. The auto-layout button resets every position to `null`. ELK Layered distributes long workflows compactly across multiple rows with graph wrapping; JointJS routes connections orthogonally around other nodes. The workflow order remains unchanged.

The website root's `url` is loaded behind the layers. A `javascript` node runs in that website's document, while layer JavaScript runs in the overlay document. `browser-wait` waits for the configured `element`, `url`, or `script` condition with a positive `timeoutMs`. It stores exactly one condition payload: `selector`, `value`, or `script`, respectively. A script wait repeats until it returns a truthy value. A `browser-action` is currently a click node, so its selector is sufficient and no redundant one-option action field is stored. Both node types use native Browser Testbench endpoints in a remote preview.

`placement` aligns layer content within a reference rectangle. `horizontal` accepts `left`, `center`, or `right`; `vertical` accepts `top`, `center`, or `bottom`. Together, the two values form the 3×3 alignment grid. Optional `offsetXPercent` and `offsetYPercent` shift the aligned content by a percentage of that reference rectangle's width or height (default `0`). `reference` selects the reference rectangle:

- `{ "type": "viewport" }` uses the entire viewport.
- `{ "type": "layer", "nodeId": "…" }` uses the content container of a preceding layer node. Its geometry is followed live while it remains visible; after removal, the last valid rectangle from the current run is used.
- `{ "type": "dom", "selector": "…" }` uses the first matching element in the website DOM. The editor can select the element through Browser Testbench.

The runtime positions a dedicated anchor container for this purpose. It does not modify the actual layer content's `transform`, leaving it fully available for layer animations. A target that cannot be measured causes an execution error. Measured rectangles belong only to the current run and are not stored in the project.

Content dimensions remain the responsibility of the layer CSS. HTML, CSS, and JavaScript are preserved unchanged as strings and assembled in an isolated `iframe` for preview. Unknown formats, versions, placements, or incomplete layer sources are rejected during loading.

A visual text layer is still a `layer` node. Its optional `text` settings describe the block and its ordered lines, including an optional dark outline and shadow for readability; Director regenerates readable `source.html` and `source.css` when saving. The generated markup and animation names use a short, node-specific `tl-` ID prefix so styles cannot affect other layers. Converting the visual editor to raw source removes `text` permanently but keeps the generated HTML/CSS. A project font is supplied by a connected font file input and referenced through `text.fontInputId`; after conversion, the same reference is retained as the layer's `fontInputId`. Both forms load the font before the layer starts. Generic `sans-serif`, `serif`, and `monospace` fonts need no input.

`playback.durationMs` keeps a layer visible for the specified duration after its JavaScript completes. With `removeAfter: true`, the runtime then removes both the overlay and its associated style. Catch-up skips the hold duration while still executing mount, JavaScript, return value handling, and cleanup. With `durationMs: 0` and `removeAfter: false`, a layer remains mounted.

## Playback and Runtime

- **Play node** reloads the website, plays the complete required timeline live through the selected node, and then stops. Selecting a node alone does not modify browser state.
- **Run on current state** is a secondary development action that executes only the selected node without a reset.
- **Play workflow** reloads the website and executes every node live. Independent branches run concurrently; merge nodes apply their configured `all` or `any` strategy.
- **Record at video output** opens a fresh Browser Testbench session for the node's target and records the complete workflow through OBS using the configured MP4 filename. Mobile targets keep their native fixed pixel dimensions; desktop emulation derives them from the selected preview preset and its DPR. Audio nodes play on the target during capture. Director's export pass preserves the captured audio and selected dimensions, removing omitted wait intervals from video and audio together.

The runtime provides layer and JavaScript nodes with `director.wait(milliseconds)`, `director.waitFor(selector, timeout?)`, `director.stopAudio(nodeId)`, `director.results`, and `director.inputs`. `director.inputs` is an immutable mapping from selected non-camera files to data URLs. `director.wait` waits for real time during live playback and returns immediately during catch-up. `waitFor` and standalone `browser-wait` nodes remain real state conditions during catch-up. With `omitFromRecording: true`, a `browser-wait` node still runs in real time, but its interval is excluded from the video export. With `false`, the wait remains part of the export. Independently used global timers are deliberately not modified. This keeps arbitrary JavaScript understandable; only time described explicitly through the runtime can be accelerated safely.

Every executable node may return a JSON-compatible value. The runtime stores it under the node ID. Subsequent layer and JavaScript nodes can access it, for example through `director.results['recognized-card'].cardName`. A complete workflow and primary node playback begin with an empty result context; predecessors rebuild it during live playback. Only the secondary development action runs with results from the current page state. Navigating or reloading the website discards the context.

In a layer node, `director.root` references that layer's content root; in a JavaScript node, it is `null`. `director.document` references the website document currently being controlled. Director loads the website through a same-origin proxy and places layers above it. Local preview, remote preview, and recording use the same player document and runtime; Browser Testbench opens that player on the selected device.
