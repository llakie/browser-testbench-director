# Changelog

All notable changes to Browser Testbench Director are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-29

### Added

- JSON-based workflow editor for website, input, capability, layer, JavaScript, browser action, and browser wait nodes.
- Local viewport and Browser Testbench remote previews with reproducible catch-up execution.
- Desktop recording derived from preview preset dimensions and DPR, plus native simulator, emulator, and device recording.
- Content-addressed project inputs, project-owned preparation modules, and omitted wait intervals in video exports.
- Director server, CLI, HTTPS development certificates, CSS selector picker, and stdio MCP server.
- Parallel workflow branches and explicit merge nodes with `Wait all` and `Wait any` strategies.
- Audio playback nodes with reusable file inputs, volume control, optional blocking playback, remote preview support, and synchronized audio mixing during video export.

### Changed

- Project format 12 rejects unknown persisted properties, removes redundant browser-action,
  wait-condition, and input-asset fields, supports parallel workflow connections, and stores audio playback nodes.
