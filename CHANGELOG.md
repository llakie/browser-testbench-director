# Changelog

All notable changes to Browser Testbench Director are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-10-01

### Fixed

- Safari recordings wait for audio playback to become ready after the unlock click, avoiding an intermittent start failure.

## [0.2.0] - 2026-10-01

### Added

- Audio file inputs and playback nodes with volume envelopes and branch-aware playback.
- Source formatting for layer HTML, CSS, and JavaScript.
- Recording controls on video-output nodes and their properties panel.

### Changed

- Preview and recording now use the same Browser Testbench runtime; Director preserves captured audio instead of mixing replacement tracks.
- Workflow planning and graph routing handle parallel branches, merge cancellation, and playback-to-node more consistently.
- Node editing, status indicators, and recording controls were refined for active runs.
- Graph ports now match their node header colors, and the editor has a dedicated favicon.
- The bundled Axios version is pinned to a patched release across Browser Testbench's Appium dependencies.

### Fixed

- Dragging a graph node now retains its SVG view and updates connection routing without rebuilding or moving the rest of the graph.
- Input assets are restored for immediate node playback after a project is reopened.
- Audio playback is unlocked before a remote workflow starts, including Firefox recording.
- Recording output retains synchronized captured audio when omitted intervals are removed.

## [0.1.0] - 2026-09-29

### Added

- JSON-based workflow editor for website, input, capability, layer, JavaScript, browser action, and browser wait nodes.
- Local viewport and Browser Testbench remote previews with reproducible catch-up execution.
- Desktop recording derived from preview preset dimensions and DPR, plus native simulator, emulator, and device recording.
- Content-addressed project inputs, project-owned preparation modules, and omitted wait intervals in video exports.
- Director server, CLI, HTTPS development certificates, CSS selector picker, and stdio MCP server.
- Parallel workflow branches and explicit merge nodes with `Wait all` and `Wait any` strategies.
- Audio playback nodes with reusable file inputs, master volume, editable linear volume envelopes, optional blocking playback, GainNode-based local and remote playback, and synchronized audio mixing during video export.
- Terminal video-output nodes with a recording target, configurable MP4 filename, and graph-local record control.

### Changed

- Project format 15 rejects unknown persisted properties, removes redundant browser-action,
  wait-condition, and input-asset fields, supports parallel workflow connections, and stores audio playback and terminal video-output nodes.
