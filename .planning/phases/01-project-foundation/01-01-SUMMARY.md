---
phase: 01-project-foundation
plan: 01
subsystem: infra
tags: [typescript, esm, nodenext, tsup, vitest, tsx, node20]

# Dependency graph
requires: []
provides:
  - ESM TypeScript project scaffold with NodeNext module resolution
  - tsup single-file CLI build producing shebang-topped dist/index.js
  - vitest ESM-native test runner with passing smoke test
  - All runtime and dev dependencies installed for all 9 phases
  - src/index.ts entry point stub with explicit main() guard
affects:
  - 01-02-project-foundation
  - 02-config-loader-and-auth
  - all downstream phases (compile environment)

# Tech tracking
tech-stack:
  added:
    - typescript@5.9.3
    - tsup@8.5.1
    - vitest@4.0.18
    - tsx@4.21.0
    - js-yaml@4.1.1
    - zod@4.3.6
    - commander@14.0.3
    - handlebars@4.7.8
    - ora@9.3.0
    - chalk@5.6.2
    - date-fns@4.1.0
    - "@types/node@25.3.0"
    - "@types/js-yaml@4.0.9"
  patterns:
    - ESM module system (type: module, NodeNext resolution)
    - .js extension in TypeScript ESM imports (resolves to .ts at compile time)
    - isMain guard in entry point prevents auto-execution on import
    - tsup banner option for shebang injection into dist output

key-files:
  created:
    - package.json
    - tsconfig.json
    - tsup.config.ts
    - vitest.config.ts
    - src/index.ts
    - tests/smoke.test.ts
    - dist/index.js
  modified: []

key-decisions:
  - "NodeNext module resolution chosen (not commonjs) — required for ESM type:module package"
  - "All 9-phase runtime dependencies installed in Phase 1 to prevent version surprises in later phases"
  - "isMain guard in src/index.ts prevents console output when smoke test imports the module"
  - "tsup banner injects shebang; chmod +x in build script makes dist/index.js directly executable"

patterns-established:
  - "Pattern: All .ts imports use .js extension (ESM NodeNext convention)"
  - "Pattern: Entry point uses import.meta.url === file://... guard for conditional execution"
  - "Pattern: vitest globals:true eliminates per-file describe/it/expect imports"

requirements-completed:
  - CFG-05

# Metrics
duration: 7min
completed: 2026-02-23
---

# Phase 1 Plan 1: ESM TypeScript Toolchain Setup Summary

**Node.js ESM TypeScript scaffold with NodeNext resolution, tsup single-file CLI bundle, vitest smoke test — all passing from a fresh state in one `npm install` + `npm run build`**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-23T19:47:19Z
- **Completed:** 2026-02-23T19:55:13Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Full ESM TypeScript toolchain configured: NodeNext module resolution, tsup build, vitest test runner
- All 9-phase dependencies pre-installed: runtime (js-yaml, zod, commander, handlebars, ora, chalk, date-fns) and dev (typescript 5.9.3, tsup 8.5.1, vitest 4.0.18, tsx 4.21.0)
- `npm run build` produces `dist/index.js` with shebang, `npm test` passes 2/2, `typecheck` passes — all from a clean state
- Entry point stub with `isMain` guard prevents console output during test imports

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize project with ESM TypeScript toolchain** - `c549110` (chore)
2. **Task 2: Create entry point stub and smoke test, verify build and test pass** - `9e8c6d4` (feat)

## Files Created/Modified

- `package.json` — Project metadata with `"type": "module"`, scripts (build/dev/test/typecheck), all dependencies
- `tsconfig.json` — TypeScript config with `"module": "NodeNext"`, strict mode, ESM settings
- `tsup.config.ts` — Bundle config: ESM format, node20 target, shebang banner, clean output
- `vitest.config.ts` — Test runner config: globals enabled, node environment
- `src/index.ts` — CLI entry point stub with explicit `main()` function and `isMain` guard
- `tests/smoke.test.ts` — ESM import chain smoke test (2 tests: import resolves, main() callable)
- `dist/index.js` — Built output (committed as verification artifact)

## Installed Dependency Versions

From `npm list --depth=0` (Node.js v25.2.0):

| Package | Version | Role |
|---------|---------|------|
| typescript | 5.9.3 | TypeScript compiler |
| tsup | 8.5.1 | CLI bundler |
| vitest | 4.0.18 | Test runner |
| tsx | 4.21.0 | Dev execution |
| @types/node | 25.3.0 | Node built-in types |
| @types/js-yaml | 4.0.9 | js-yaml types |
| js-yaml | 4.1.1 | YAML config parsing |
| zod | 4.3.6 | Runtime schema validation |
| commander | 14.0.3 | CLI argument parsing |
| handlebars | 4.7.8 | HTML report templating |
| ora | 9.3.0 | Terminal spinner |
| chalk | 5.6.2 | Terminal color output |
| date-fns | 4.1.0 | Date/time manipulation |

All versions match RESEARCH.md documented current versions exactly.

## Decisions Made

- **NodeNext module resolution:** Required by `"type": "module"` in package.json. Using `"module": "commonjs"` would create dual-mode conflicts.
- **All 9-phase deps installed upfront:** RESEARCH.md recommendation to avoid version surprises when later phases add packages.
- **`isMain` guard pattern:** `import.meta.url === \`file://${process.argv[1]}\`` prevents `main()` from firing during dynamic import in smoke test, enabling the test to assert on the exported function without console output side effects.
- **`chmod +x` in build script:** tsup banner adds shebang but not the executable bit — `&& chmod +x dist/index.js` appended to build command.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. All tooling configured and tests passed on first run.

## Smoke Test Output

```
 ✓ tests/smoke.test.ts (2 tests) 5ms

 Test Files  1 passed (1)
       Tests  2 passed (2)
   Start at  20:52:26
   Duration  97ms
```

## Node.js Version

Node.js v25.2.0 (above the required >=20.0.0 minimum).

## Next Phase Readiness

- Phase 1 Plan 2 (config.example.yaml / CFG-05) was already completed (db61289)
- Phase 2 (Config Loader and Auth) can begin — project compiles, dependencies installed
- TypeScript ESM environment is stable; all downstream phases can import modules without resolution errors

---
*Phase: 01-project-foundation*
*Completed: 2026-02-23*
