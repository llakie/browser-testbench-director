# Architecture review for 0.2.0

## Assessment

The project JSON remains the sole production description. The UI edits that model, the workflow planner resolves dependencies and branches, the preview runtime executes it, and the server handles local assets, the website proxy, and export. Browser Testbench owns remote targets and capture. This separation is appropriate for the current feature set and avoids a second production timeline.

The package contains the built UI, CLI, MCP server, format documentation, and dependency licenses. Local production projects and their assets are excluded. The server binds to loopback by default.

## Release checks

- Lint, formatting, type checking, unit tests, build, package-content check, and production dependency audit.
- Real browser UI, input persistence, remote workflow, and recording checks against a running Browser Testbench.
- `ffprobe` inspection and a representative frame from the exported recording.

## Risks and follow-up

- Release blocker: mobile and repeated recording runs are not yet reliable enough to call this a stable cross-device release. An Android system dialog reporting a repeatedly crashing Bluetooth process obscured Chrome's native WebView and caused `RECORDING_UNSUPPORTED` at `recording.geometry`. After that dialog disappeared, both a minimal Android recording and a full GTP recording succeeded; the GTP export was 58.7 seconds versus 19.3 seconds in Chrome, with a visibly prolonged intro. A later repeated Chrome GTP run reported `tab crashed`. Determine whether the duration difference is an intentionally retained project wait or a missing cut, and resolve the intermittent target failures before publication.
- Several files remain large, especially preview integration, graph rendering, project validation, and the node editor template. They are maintenance hotspots, but splitting them without a behavior change is not a release prerequisite. Extract along stable responsibility boundaries when those areas are next changed.
- Browser Testbench, OBS, browser automation, and local certificate trust are external runtime dependencies. Automated CI covers the core and package on macOS, Windows, and Linux; the real browser/recording gate is run locally before release.
- Projects execute user-authored JavaScript and preparation modules by design. Run Director only for trusted projects and keep the default loopback binding unless the surrounding network is trusted.
