# Architecture review for 0.2.0

## Assessment

The project JSON remains the sole production description. The UI edits that model, the workflow planner resolves dependencies and branches, the preview runtime executes it, and the server handles local assets, the website proxy, and export. Browser Testbench owns remote targets and capture. This separation is appropriate for the current feature set and avoids a second production timeline.

The package contains the built UI, CLI, MCP server, format documentation, and dependency licenses. Local production projects and their assets are excluded. The server binds to loopback by default.

## Release checks

- Lint, formatting, type checking, unit tests, build, package-content check, and production dependency audit.
- Real browser UI, input persistence, remote workflow, and recording checks against a running Browser Testbench.
- `ffprobe` inspection and a representative frame from the exported recording.

## Risks and follow-up

- Release dependency: Browser Testbench 0.7.1 can retain an Android target and OBS lock after Chrome reports `tab crashed`. The upstream cleanup fix passed unit tests and a real forced-crash check, but must be released and installed before Director 0.2.0 is published.
- Android emulator capacity matters for production recording. The 2 GB Pixel 8a AVD repeatedly lost Chrome's renderer; Android's low-memory killer log identified memory pressure. At 4 GB one run passed and another failed. With a temporary 8 GB launch, two consecutive full GTP recordings passed at 19.33 and 19.31 seconds, with H.264 video and AAC audio. This is a test-environment requirement, not a persisted project setting.
- The earlier 58.7-second GTP export included a variable-length card-recognition wait. Marking that wait as omitted in the local production project brought Android's exported duration in line with desktop Chrome's 19.3 seconds. The GTP project is intentionally excluded from Git and the npm package.
- Several files remain large, especially preview integration, graph rendering, project validation, and the node editor template. They are maintenance hotspots, but splitting them without a behavior change is not a release prerequisite. Extract along stable responsibility boundaries when those areas are next changed.
- Browser Testbench, OBS, browser automation, and local certificate trust are external runtime dependencies. Automated CI covers the core and package on macOS, Windows, and Linux; the real browser/recording gate is run locally before release.
- Projects execute user-authored JavaScript and preparation modules by design. Run Director only for trusted projects and keep the default loopback binding unless the surrounding network is trusted.
