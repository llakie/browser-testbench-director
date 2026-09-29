# Development Guidelines

- Keep changes scoped to the current objective and follow KISS, YAGNI, DRY, and Clean Code.
- Reuse existing project patterns, design tokens, and generic runtime abstractions; project-specific production logic stays within its project.
- Fix defects at their root cause. New edge cases require a reproducible test.
- Keep selection, editing, execution, remote preview, and recording as separate states.
- The JSON project is the only executable production description; do not generate parallel timeline code.
- Before completion, run `npm run verify:core` and the affected browser checks. A release candidate must pass the complete `npm run verify` gate.
- Additionally inspect real video exports with `ffprobe` and representative frames.
- Do not overwrite unrelated user changes. Only create commits when explicitly requested.
