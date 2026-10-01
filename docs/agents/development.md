# Development Guidelines

- Keep changes scoped to the current objective and follow KISS, YAGNI, DRY, and Clean Code.
- Always wrap control-statement bodies in braces. Keep control blocks multiline and separate complete control statements from surrounding statements with a blank line. Do not insert a blank line between `if`/`else`, `try`/`catch`/`finally`, or `do`/`while` clauses. Prefer guard clauses and omit `else` after a branch that unconditionally returns.
- Reuse existing project patterns, design tokens, and generic runtime abstractions; project-specific production logic stays within its project.
- Fix defects at their root cause. New edge cases require a reproducible test.
- Keep selection, editing, execution, remote preview, and recording as separate states.
- The JSON project is the only executable production description; do not generate parallel timeline code.
- Before completion, run `npm run verify:core` and the affected browser checks. ESLint enforces the shared control-flow style as part of this gate. A release candidate must pass the complete `npm run verify` gate.
- Additionally inspect real video exports with `ffprobe` and representative frames.
- Do not overwrite unrelated user changes. Only create commits when explicitly requested.
