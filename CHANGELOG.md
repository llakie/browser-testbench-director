# Changelog

All notable changes to Browser Testbench Director are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Parallel workflow branches and explicit merge nodes with `Wait all` and `Wait any` strategies.

### Changed

- Project format 11 permits multiple outgoing workflow connections and reserves multiple incoming connections for merge nodes.

## [0.1.0] - 2026-09-29

### Added

- JSON-based workflow editor for website, input, capability, layer, JavaScript, browser action, and browser wait nodes.
- Local viewport and Browser Testbench remote previews with reproducible catch-up execution.
- Desktop recording derived from preview preset dimensions and DPR, plus native simulator, emulator, and device recording.
- Content-addressed project inputs, project-owned preparation modules, and omitted wait intervals in video exports.
- Director server, CLI, HTTPS development certificates, CSS selector picker, and stdio MCP server.

### Changed

- Project format 10 rejects unknown persisted properties and removes redundant browser-action,
  wait-condition, and input-asset fields.
