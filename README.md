# Browser Testbench Director

Browser Testbench Director is a JSON-based editor and player for website automation and video layers rendered above
the controlled website. Production projects live locally under `projects/`, remain untracked, and provide their own
project-specific assets, preparation modules, and verification scripts.

Release documentation: [Browser Testbench Director 0.2.0](docs/releases/0.2.0.md).

## Installation

Browser Testbench Director requires Node.js 22.12 or Node.js 24, plus `ffmpeg` and `ffprobe` on `PATH` for video
exports. Browser Testbench is installed as a package dependency and does not require a separate global installation.

```bash
npm install --global browser-testbench-director
browser-testbench-director start
```

The UI is available at `http://127.0.0.1:5173` by default. `browser-testbench-director start --https` creates a local
certificate in the current working directory. Project files and their associated assets also remain in the selected
working directory.

## Director UI

The Director editor supports input nodes, one website root, and layer, JavaScript, browser action, wait, merge, and
audio nodes. Each layer occupies a transparent full-screen surface. Its content can be aligned within that surface or
placed at an inherited position, while its own CSS determines its size. Browser actions and wait conditions use typed
configuration. Element, URL, and script waits as well as clicks run both locally and through Browser Testbench.
Multiple outputs start parallel branches. Only a merge node may have multiple workflow inputs; it continues after
either every branch (`Wait all`) or the first branch (`Wait any`) completes. Return values are stored under the node ID
and are available to later layers and scripts through `director.results`.

Clicking a node only selects it. A node's play button reloads the website, reconstructs every predecessor and its data
flow in catch-up mode, and plays only the selected node live. Direct execution against the current page state remains
available as a development action in the node menu. The play button in the graph header restarts the complete
workflow.

Changing execution-relevant node properties never runs code automatically. Instead, the changed node's play button
receives an accent outline. Clicking it reconstructs the website and predecessors in catch-up mode and plays the node
with its current properties. The outline disappears after successful playback. The display name is excluded because
it does not affect runtime state. Selection, editing, and execution therefore remain separate even when arbitrary
JavaScript changes the website DOM.

Nodes without a manually assigned position store `"position": null` and are arranged automatically with ELK Layered.
Long workflows and parallel branches remain compact while preserving their dependencies; JointJS then routes
connections orthogonally around the nodes. Only an actual drag stores `{ "x": …, "y": … }` for a node. The automatic
layout button returns every node to the automatically managed state.

Layers can define a hold duration and be removed completely afterwards. This models finite story clips. Catch-up skips
only the hold time while preserving page effects and return values.

For portrait projects, the viewport-only preview docks on the right; for landscape projects, it docks at the top.
Panel boundaries are resizable, their positions are stored locally, and every panel can be maximized. On small
viewports, the scene graph, node properties, and preview become three tabs inside a `100dvh` application shell, with
the scene graph selected initially. The mobile header groups project, AI, Browser Testbench, and file actions inside a
hamburger menu. Projects can be loaded and saved as versioned `.btd.json` files.

The shared playback-device selector contains local viewport presets and, while Browser Testbench is enabled in the
global header, compatible remote targets. Local presets automatically fit the available space; there is no separate
preview zoom. Selecting a remote target immediately transfers the last successfully executed state and replaces the
local preview with a clear placeholder. Switching back to a local preset closes the remote session and reproduces the
same state locally. The remote selection is session state and is not part of the project format.

Recording target selection remains independent and lists only targets that can record. Global project settings
configure language, region, and additional website permissions for every Browser Testbench session. Supported desktop
browsers expose the combined language, for example, as `navigator.language === 'de-DE'`.

The record button on a video-output node starts a clean remote session, captures its viewport during the complete
workflow, and downloads an MP4 afterwards. If the selected target is already used for remote preview, Director resets
that session reproducibly and leaves it displaying the final state after recording. Recording on a different target
does not disturb the active preview. Director verifies the size and SHA-256 digest of the Browser Testbench artifact.
Physical devices, simulators, and emulators retain their native fixed video resolution. For desktop recording,
Director derives the output from the CSS viewport and DPR of the centrally defined preview preset. Server-side removal
of omitted wait times preserves those dimensions; the project stores only the portable preset ID.

Recording uses Browser Testbench 0.7.3 or newer and OBS. Configure OBS and any per-device audio offset in the
Browser Testbench setup UI; Director does not maintain separate recorder or synchronization settings.
Desktop browsers stay visible during recording. Audio nodes play on the target just as they do in preview,
including volume envelopes and branch cancellation. Director preserves the captured audio and cuts it together
with the video when omitting wait times; it does not mix replacement audio tracks. Because desktop capture includes
system audio, silence unrelated applications while recording. OBS and FFmpeg must be installed on the Testbench
machine, and FFmpeg is also required on the Director server for the final export.

For a paired remote Testbench, run Director with `--host 0.0.0.0` and open the editor through the
Director computer's LAN address rather than `localhost`. The remote host must be able to reach
Director's separate HTTP player port. OBS and FFmpeg run on the remote Testbench computer; the
captured video returns through the local Testbench gateway before Director performs its final export.

Projects declare runtime files as input nodes before the website root. The file picker and current selection are shown
directly in the node; MIME types, required state, and preparation modules are configured in its properties. Selected
files are stored by content address under `projects/.director-assets/` and referenced from project JSON by name, type,
size, and SHA-256. Director restores them automatically when the project is reopened. It validates and prepares every
connected input before starting the website.

Camera sources are transferred to Browser Testbench as binary assets. Other files are available to scripts as data
URLs through `director.inputs`. Audio inputs feed audio nodes, which support volume control and optionally wait for
playback to finish. For local Android URLs, Director enables Browser Testbench's secure reverse mapping automatically.
A project can therefore start an Android emulator with camera permission, language and locale, an injected camera
image, and a font without storing binary data or transport-specific network details in its `.btd.json` file.

Director contains no hard-coded production logic. During video export, marked intervals of captured video and audio
are joined together. Wait nodes can be explicitly removed from the video and audio through
`omitFromRecording`, or retained in the export.

```bash
npm run dev
npm run dev:https
```

`npm run dev` starts the standalone Director server with embedded Vite middleware. On first launch,
`npm run dev:https` creates and then reuses a local certificate for `localhost`, `127.0.0.1`, and `::1` under `.certs/`.
Use `--https-cert` and `--https-key` to supply a different certificate. Websites are loaded through a temporary
same-origin Director proxy route. Local and remote previews use the same player document and runtime.

For production, the client and Node.js server are built together and then served without Vite:

```bash
npm run build
npm start
```

The CLI entry point is `browser-testbench-director start`. It accepts `--host`, `--port`, `--https`, `--https-cert`,
`--https-key`, and `--browser-testbench-url`. The server runtime lives under `src/server/` and provides preview routes,
the website proxy, preparation modules, video export, the Browser Testbench lifecycle, and the
`/browser-testbench-api` proxy. The built client is served from `dist/ui`. Project files continue to be opened and
saved directly through the browser file APIs and require no server-side data store.

## MCP

Director includes a stdio MCP server based on the official TypeScript SDK. It lists, reads, validates, and edits
`.btd.json` projects inside an explicit workspace. Changes are fully validated and saved atomically. The Connect AI
dialog detects Codex, Claude Code, Gemini CLI, and VS Code. Supported CLI clients can be registered directly; for other
clients, the dialog copies the appropriate configuration.

```bash
browser-testbench-director mcp --workspace /path/to/workspace
browser-testbench-director mcp-config --client codex --workspace /path/to/workspace
```

The MCP server provides tools for listing, reading, creating, and replacing complete projects, plus validating,
adding, or removing nodes and connecting them. File paths cannot leave the configured workspace.

## Selector Picker

Browser action nodes and element-based wait nodes provide a crosshair button beside the CSS selector. Director opens a
fresh session on the selected Browser Testbench target, executes every predecessor in catch-up mode, and then enables
element selection. Hovered elements are highlighted; the click itself is suppressed and converted into a stable
selector. Director prefers `data-testid`, unique IDs, and semantic attributes, followed by unique classes and finally
a structural path. Press `Escape` or the active picker button to cancel selection.

The project format is documented in [docs/project-format.md](docs/project-format.md).

The npm package includes the project license and dependency notices as `LICENSE.txt` and
`THIRD_PARTY_LICENSES.txt`.

The reproducible browser tests expect a running Director UI and a local Browser Testbench:

```bash
npm run dev
npx browser-testbench start --no-open
npm run test:ui
npm run test:remote
npm run test:recording
```

The complete release gate combines type checking, unit tests, the production build, and all four browser checks.
Director and Browser Testbench must be running as described above:

```bash
npm run verify
```

Set `BROWSER_TESTBENCH_TARGET` to use a different target for `test:ui`, such as `firefox`. By default, the remote test
controls the UI in Firefox and opens the preview in Chrome. `DIRECTOR_CONTROLLER_TARGET` and
`DIRECTOR_PREVIEW_TARGET` change those targets.

`test:recording` runs a short workflow in Chrome through the same UI, downloads the recording, and verifies its
container, video dimensions, and duration with `ffprobe`. Set `DIRECTOR_RECORDING_TARGET` to run the same test on a
different recording-capable target.
