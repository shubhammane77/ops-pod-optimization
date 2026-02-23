# Phase 1: Project Foundation - Research

**Researched:** 2026-02-23
**Domain:** Node.js TypeScript CLI project scaffolding — ESM module system, tsup build, vitest test framework, YAML config example, fixture data structure
**Confidence:** HIGH

---

## Summary

Phase 1 is purely about creating a working development environment — not about Dynatrace API integration. The goal is that a developer can clone the repo, run `npm run build`, and get a runnable binary; run `npm test` and see tests pass in a TypeScript-native ESM environment; and have a `config.example.yaml` and `fixtures/` directory ready for all downstream phases.

The technology choices for this project are already locked by the architecture decisions recorded in STATE.md: ESM module system (`"type": "module"`, TypeScript `"module": "NodeNext"`), tsup for bundling, vitest for testing, and TypeScript 5.x throughout. These are stable, well-understood tools with current versions verifiable from npm. The primary execution risk for Phase 1 is ESM configuration — getting TypeScript, tsup, and vitest all agreeing on module resolution requires precise configuration, and the `.js` extension convention in ESM TypeScript imports catches almost every developer the first time.

The two requirements for Phase 1 are CFG-05 (annotated `config.example.yaml`) and DEV-01 (realistic fixture data representing Dynatrace API responses). Both are content-creation tasks, not code tasks. CFG-05 requires knowing the full config schema (all fields from all future phases), and DEV-01 requires constructing realistic Dynatrace API response JSON that represents a multi-namespace cluster — this fixture data will be used heavily in testing throughout all subsequent phases.

**Primary recommendation:** Lock in ESM + NodeNext configuration on day one. Get a passing `npm test` with a trivial test before adding any source code. Use `tsx` for development execution and `tsup` for production bundle. The `config.example.yaml` should document all fields across all phases (not just Phase 1 requirements) to avoid rework.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CFG-05 | Repository includes a sample annotated config file (`config.example.yaml`) documenting all fields with defaults and valid values | The full config schema is derivable from CFG-01 through CFG-04 requirements — all config fields are defined in REQUIREMENTS.md. Writing the example file requires forward knowledge of the full schema. |
| DEV-01 | Repository includes sample fixture data representing a realistic Dynatrace API response for local development and testing without a live Dynatrace connection | Fixture data structure must mirror the actual Dynatrace v2 API response shape for `/api/v2/entities` and `/api/v2/metrics/query`. The data shape is documented in ARCHITECTURE.md and STACK.md. |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 20 LTS | Runtime | LTS with native `fetch`; required by ora v9, chalk v5 ESM-only design; Node 22 is too new for SRE bastion environments |
| TypeScript | 5.9.3 (current) | Type safety + compilation | Interfaces on Dynatrace's deeply nested JSON prevent silent field-name bugs; standard for any CLI tool being handed to a team |
| tsup | 8.5.1 (current) | Bundle to single-file CLI distributable | Handles ESM/CJS interop, produces `dist/index.js` with all deps inlined; SREs run from bastion without `npm install` |
| vitest | 4.0.18 (current) | Test runner | ESM-native; TypeScript-first; Jest-compatible API; no transform config needed for `.ts` files |
| tsx | 4.21.0 (current) | Run TypeScript directly in dev | Esbuild-based; faster than ts-node; no separate compilation step during development iteration |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/node | 25.3.0 (current) | Node.js built-in types | Always — needed for `process`, `fs`, `path` types |
| js-yaml | 4.1.1 (current) | YAML config parsing | Always — config file is YAML for SRE comment support |
| @types/js-yaml | 4.0.9 (current) | TypeScript types for js-yaml | Always alongside js-yaml |
| zod | 4.3.6 (current) | Runtime config + API response validation | Phase 2 for config schema; Phase 4+ for API response shapes |
| commander | 14.0.3 (current) | CLI argument parsing | Phase 9 for full CLI wiring; stub in Phase 1 |
| handlebars | 4.7.8 (current) | HTML report templating | Phase 8; install now to avoid version surprises |
| ora | 9.3.0 (current) | Terminal spinner | Phase 9 CLI polish |
| chalk | 5.6.2 (current) | Terminal color output | Phase 9 CLI polish |
| date-fns | 4.1.0 (current) | Date/time manipulation | Phase 2 time window parsing |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsup | tsc + rollup | tsup is 10-line config vs complex pipeline; produces equivalent output; active maintenance |
| vitest | jest | jest requires ESM transform config; vitest is ESM-native; no advantage to jest here |
| tsx | ts-node | tsx uses esbuild (faster); ts-node uses tsc (slower but more correct for edge cases); tsx sufficient for dev |
| handlebars | EJS | Both work; STATE.md has locked handlebars for logic-less template constraint; do not reconsider |

**Installation:**
```bash
npm init -y
npm pkg set type=module

# Build toolchain
npm install -D typescript tsx tsup vitest @types/node

# Runtime deps (install now even if used in later phases)
npm install js-yaml zod commander handlebars ora chalk date-fns
npm install -D @types/js-yaml
```

---

## Architecture Patterns

### Recommended Project Structure

```
ops-pod-optimization/
├── src/
│   ├── index.ts               # CLI entry point stub (Phase 1: just prints version)
│   ├── config/
│   │   ├── loader.ts          # YAML config loading + zod validation (Phase 2)
│   │   └── schema.ts          # Zod schema for config file (Phase 2)
│   ├── api/
│   │   ├── client.ts          # Dynatrace API client (Phase 3)
│   │   └── types.ts           # Zod schemas + TS types for API responses (Phase 3+)
│   ├── collectors/
│   │   ├── entities.ts        # /api/v2/entities queries (Phase 4)
│   │   └── metrics.ts         # /api/v2/metrics/query queries (Phase 5)
│   ├── analysis/
│   │   ├── correlator.ts      # Join entities + metrics (Phase 6)
│   │   └── recommender.ts     # Right-sizing + replica reduction logic (Phase 7)
│   └── report/
│       ├── renderer.ts        # Handlebars rendering + file write (Phase 8)
│       └── template.hbs       # Main HTML template (Phase 8)
├── tests/
│   ├── fixtures/              # Dynatrace API JSON responses (Phase 1 — DEV-01)
│   │   ├── entities-response.json
│   │   ├── metrics-cpu-response.json
│   │   ├── metrics-memory-response.json
│   │   ├── metrics-network-response.json
│   │   └── README.md          # Documents fixture structure and source
│   └── (test files per module, added in later phases)
├── config.example.yaml        # Annotated example config (Phase 1 — CFG-05)
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── package.json
```

### Pattern 1: ESM TypeScript with NodeNext Module Resolution

**What:** TypeScript compiled with `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`. All imports in `.ts` source files use `.js` extensions (not `.ts`). This is the TypeScript ESM convention — the `.js` extension refers to the compiled output, not the source file.

**When to use:** Always — this project is locked to ESM per STATE.md architecture decisions.

**Why this matters:** If you use `.ts` extensions or omit extensions in imports, TypeScript compiles successfully but Node.js fails at runtime. This is the most common Phase 1 failure mode.

**Example:**
```typescript
// CORRECT — use .js extension in TypeScript ESM imports
import { loadConfig } from './config/loader.js';
import { DynatraceClient } from './api/client.js';

// WRONG — will compile but fail at runtime
import { loadConfig } from './config/loader';
import { loadConfig } from './config/loader.ts';
```

### Pattern 2: tsup Configuration for CLI Bundle

**What:** tsup config that produces a single bundled `dist/index.js` with a shebang, all deps inlined, and clean `bin` field in package.json.

**When to use:** Phase 1 scaffolding — configure once, never revisit.

**Example:**
```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  bundle: true,
  minify: false,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
```

```json
// package.json relevant fields
{
  "type": "module",
  "bin": {
    "ops-pod-opt": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Pattern 3: vitest Configuration for ESM TypeScript

**What:** Minimal vitest config that handles TypeScript natively without any additional transforms.

**When to use:** Phase 1 — set once, never change.

**Example:**
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

A test file in vitest with TypeScript ESM:
```typescript
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('true is true', () => {
    expect(true).toBe(true);
  });
});
```

### Pattern 4: tsconfig.json for NodeNext

**What:** TypeScript configuration that aligns with Node 20 ESM runtime expectations.

**Example:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Note:** `skipLibCheck: true` avoids spurious type errors from packages with imperfect type definitions. Essential for a project with many third-party dependencies.

### Pattern 5: config.example.yaml Structure (CFG-05)

**What:** The annotated example config file that satisfies CFG-05. Must document ALL config fields across ALL phases (not just Phase 1) so it does not need to be rewritten in later phases.

**When to use:** Write this in Phase 1 as a forward-declaration of the full config schema. The actual `ConfigLoader` and `zod` schema are built in Phase 2, but the YAML file should already contain all fields.

**Example:**
```yaml
# Ops Pod Optimization Tool — Example Configuration
# Copy this file to config.yaml and fill in your values.
# All fields are documented with their type, default value, and valid values.

# ============================================================
# Dynatrace Connection
# ============================================================

# Base URL of your Dynatrace Managed instance.
# Format: https://<your-managed-host>/e/<environment-id>
# Required. No default.
endpoint: "https://your-dynatrace-host.example.com/e/your-env-id"

# API token for authentication.
# Requires scopes: metrics.read, entities.read
# Can be overridden by DYNATRACE_API_TOKEN environment variable (env var takes precedence).
# Required unless DYNATRACE_API_TOKEN is set.
apiToken: "dt0c01.YOUR_TOKEN_HERE"

# ============================================================
# Analysis Scope
# ============================================================

# Kubernetes namespaces to analyze.
# Names must exactly match namespace names as indexed by Dynatrace OneAgent.
# Use --discover-namespaces to list available namespaces.
# Required. At least one namespace must be provided.
namespaces:
  - production
  - staging
  - platform

# ============================================================
# Time Window
# ============================================================

# Default analysis time window.
# Format: <N>d (days) or <N>h (hours).
# Can be overridden at runtime with --window flag.
# Default: "7d"
# Valid: "1d", "3d", "7d", "14d", "30d", "2h", "24h", etc.
timeWindow: "7d"

# ============================================================
# Metric Configuration
# ============================================================

# Percentile to use for baseline utilization calculation.
# Default: 90
# Valid: integer between 50 and 99 (inclusive)
percentile: 90

# Headroom multiplier for CPU request recommendations.
# Recommended CPU request = p{percentile} CPU * cpuHeadroomMultiplier
# Default: 1.10 (10% headroom)
# Valid: float >= 1.0
cpuHeadroomMultiplier: 1.10

# Headroom multiplier for memory request recommendations.
# Recommended memory request = p{percentile} memory * memoryHeadroomMultiplier
# MINIMUM: 1.30 — even if you set a lower value, 30% headroom is enforced.
# Default: 1.30 (30% headroom)
# Valid: float >= 1.30
memoryHeadroomMultiplier: 1.30

# ============================================================
# Recommendation Thresholds
# ============================================================

# Pods using less than this fraction of their CPU request are flagged as over-provisioned.
# Default: 0.6 (pod using < 60% of its CPU request is over-provisioned)
# Valid: float between 0.1 and 0.9
cpuOverProvisionedThreshold: 0.6

# Pods using more than this fraction of their CPU request are flagged as under-provisioned.
# Default: 0.9 (pod using > 90% of its CPU request is under-provisioned)
# Valid: float between 0.5 and 1.0
cpuUnderProvisionedThreshold: 0.9

# Memory thresholds follow the same convention as CPU.
memoryOverProvisionedThreshold: 0.6
memoryUnderProvisionedThreshold: 0.9

# Minimum replica count floor for all replica reduction recommendations.
# Deployments will never be recommended to scale below this value.
# Default: 2
# Valid: integer >= 1
minReplicaFloor: 2

# ============================================================
# Output
# ============================================================

# Path for the generated HTML report file.
# Default: "./report.html"
outputPath: "./report.html"
```

### Pattern 6: Fixture Data Structure (DEV-01)

**What:** Realistic Dynatrace API JSON responses that represent a multi-namespace cluster with diverse workloads. Used by all downstream phases to test without a live Dynatrace connection.

**Fixture files required:**

`tests/fixtures/entities-response.json` — Response from `GET /api/v2/entities?entitySelector=type(CLOUD_APPLICATION),...` with 5-10 workloads across 2 namespaces, mix of DEPLOYMENT/STATEFUL_SET/DAEMON_SET types.

`tests/fixtures/metrics-cpu-response.json` — Response from `GET /api/v2/metrics/query` for `builtin:containers.cpu.usagePercent:percentile(90)`.

`tests/fixtures/metrics-memory-response.json` — Response for `builtin:containers.memory.residentMemoryBytes:percentile(90)`.

`tests/fixtures/metrics-network-response.json` — Response for `builtin:containers.net.bytesRx:percentile(90)` — include one response where some entities have null values to represent unavailable network monitoring.

**Entities response shape:**
```json
{
  "totalCount": 3,
  "pageSize": 50,
  "entities": [
    {
      "entityId": "CLOUD_APPLICATION-AABBCC1122330001",
      "displayName": "api-gateway",
      "firstSeenTms": 1700000000000,
      "lastSeenTms": 1706000000000,
      "properties": {
        "kubernetesNamespace": "production",
        "workloadType": "DEPLOYMENT",
        "desiredReplicas": 5,
        "availableReplicas": 5,
        "cpuRequest": 250,
        "memoryRequest": 536870912
      }
    },
    {
      "entityId": "CLOUD_APPLICATION-AABBCC1122330002",
      "displayName": "postgres",
      "firstSeenTms": 1700000000000,
      "lastSeenTms": 1706000000000,
      "properties": {
        "kubernetesNamespace": "production",
        "workloadType": "STATEFUL_SET",
        "desiredReplicas": 3,
        "availableReplicas": 3,
        "cpuRequest": 1000,
        "memoryRequest": 2147483648
      }
    }
  ]
}
```

**Metrics response shape:**
```json
{
  "resolution": "1h",
  "result": [
    {
      "metricId": "builtin:containers.cpu.usagePercent:percentile(90)",
      "data": [
        {
          "dimensionMap": {
            "dt.entity.cloud_application_instance": "CLOUD_APPLICATION_INSTANCE-XXYYZZ0000000001"
          },
          "timestamps": [
            1705708800000,
            1705712400000,
            1705716000000
          ],
          "values": [
            32.4,
            41.7,
            28.9
          ]
        }
      ]
    }
  ]
}
```

**Fixture design guidance:** Include at least:
- 2 namespaces (`production`, `staging`) in fixtures
- 1 DEPLOYMENT, 1 STATEFUL_SET, 1 DAEMON_SET per namespace
- 1 workload where `cpuRequest`/`memoryRequest` are null (tests the fallback path)
- 1 workload where network metric returns null values (tests graceful degradation)
- 1 paginated entity response (nextPageKey present on first response, absent on second)

### Anti-Patterns to Avoid

- **Omitting `.js` extensions in imports:** TypeScript ESM requires `.js` extensions in import paths. TypeScript resolves them to `.ts` at compile time. Missing extensions cause runtime errors, not compile errors.
- **Using `"module": "commonjs"` in tsconfig:** This conflicts with `"type": "module"` in package.json and causes confusing dual-mode errors. The entire project is ESM — use `"module": "NodeNext"`.
- **Installing ora@5 or chalk@4:** These are the CommonJS versions. The project uses ESM. Install ora@9 and chalk@5.
- **Building fixture files from scratch at each test:** Fixtures in `tests/fixtures/` are static JSON files. Import them directly in tests — do not generate them at test time.
- **Writing `config.example.yaml` for only Phase 1 fields:** CFG-05 requires the file to document ALL config fields. Write the complete schema now or it must be rewritten in Phase 2.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript ESM bundling | Custom webpack/rollup config | tsup | tsup handles ESM shebang, dep inlining, clean output in 10 lines; custom configs introduce hours of module interop debugging |
| TypeScript test running | ts-jest + jest config | vitest | vitest natively understands TypeScript + ESM; no transform configuration needed |
| TypeScript dev execution | Compilation watch + node | tsx | tsx runs `.ts` directly; no separate compile step for development iteration |
| YAML parsing | Custom parser | js-yaml v4 | YAML has edge cases (null values, multiline strings, anchors) that break naive implementations |
| Runtime schema validation | Manual type guards | zod | zod generates both TypeScript types and runtime validators from one definition; hand-rolled guards always miss edge cases |

**Key insight:** The build toolchain for TypeScript ESM projects has exactly one blessed configuration in 2025 — tsup + vitest + tsx with NodeNext module resolution. Deviating from this combination introduces module interop problems that can take days to diagnose.

---

## Common Pitfalls

### Pitfall 1: ESM Import Extension Errors at Runtime

**What goes wrong:** TypeScript compiles successfully. Running `node dist/index.js` fails with `ERR_MODULE_NOT_FOUND` or `Cannot find module './config/loader'`. Tests fail with similar errors.

**Why it happens:** TypeScript with `"module": "NodeNext"` enforces explicit file extensions in imports. TypeScript resolves `.js` extensions to `.ts` during compilation. Developers write `import { foo } from './bar'` and TypeScript compiles it, but Node.js at runtime looks for `./bar` literally and fails.

**How to avoid:** All imports in `.ts` files must use `.js` extension. Add a linter rule or pre-commit check to enforce this.

**Warning signs:** `Cannot find module` errors that mention a path without an extension. TypeScript compilation succeeds but `npm run dev` fails.

### Pitfall 2: tsup Banner Not Marking Output as Executable

**What goes wrong:** `npm run build` succeeds. Running `./dist/index.js` directly fails with "permission denied" or "invalid command." Running `node ./dist/index.js` works but the binary is not self-executable.

**Why it happens:** tsup's `banner` option adds the shebang line, but the output file still needs `chmod +x` to be executable. The `npm link` or global install handles this automatically, but a raw `./dist/index.js` call needs the permission bit set.

**How to avoid:** Add `chmod +x dist/index.js` as a postbuild script in package.json. Or use `npm link` for local testing.

**Warning signs:** Build succeeds but `./dist/index.js` fails immediately with a shell permission error.

### Pitfall 3: vitest Cannot Find Test Files

**What goes wrong:** `npm test` reports "No test files found." Tests exist in `tests/` directory but vitest finds nothing.

**Why it happens:** vitest default include pattern looks for files matching `**/*.{test,spec}.{ts,js,tsx,jsx}`. If tests are in `tests/` with filenames like `smoke.test.ts`, they are found. If tests are in `__tests__/` or use different naming, the default pattern misses them.

**How to avoid:** Use standard vitest naming conventions — `*.test.ts` or `*.spec.ts`. Verify the `include` pattern in `vitest.config.ts` matches the actual file locations.

**Warning signs:** `npm test` exits with 0 but reports "0 test suites" or similar.

### Pitfall 4: config.example.yaml Missing Fields from Future Phases

**What goes wrong:** CFG-05 is marked complete after Phase 1. In Phase 2, the Config Loader schema defines fields that are absent from `config.example.yaml`. Developers using the tool miss undocumented fields. CFG-05 requires re-opening.

**Why it happens:** The instinct is to write the example config only for currently-implemented features. CFG-05's requirement is documentation of ALL fields.

**How to avoid:** Write `config.example.yaml` with the complete schema in Phase 1. Use forward comments like `# (Available in full pipeline — Phase 2+)` if needed, but include every field.

**Warning signs:** Phase 2 config loader defines a field not present in `config.example.yaml`.

### Pitfall 5: Fixture Data Too Minimal to Test Edge Cases

**What goes wrong:** DEV-01 is satisfied with a single-namespace, single-workload fixture. Downstream phases (4, 5, 6) encounter null values, paginated responses, and mixed workload types for the first time against a live instance — no fixture coverage exists for these paths.

**Why it happens:** Writing minimal fixtures is faster. The fixture structure is not thought through until the code that consumes them is written.

**How to avoid:** Design fixtures in Phase 1 to include: multiple namespaces, all three workload types (DEPLOYMENT, STATEFUL_SET, DAEMON_SET), at least one workload with null resource requests, at least one paginated response, at least one workload with null network metric values.

**Warning signs:** Later phases need to modify or extend fixture files to cover paths they discover.

---

## Code Examples

Verified patterns from official sources and established ecosystem practice:

### tsconfig.json for Node 20 ESM

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### package.json scripts and fields

```json
{
  "name": "ops-pod-opt",
  "version": "0.1.0",
  "description": "Kubernetes pod right-sizing analysis via Dynatrace v2 API",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "bin": {
    "ops-pod-opt": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup && chmod +x dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

### src/index.ts stub (Phase 1 minimal entry point)

```typescript
// src/index.ts
// Phase 1 stub: just prints version to confirm the binary works.
// Full CLI implementation in Phase 9.

const VERSION = '0.1.0';

console.log(`ops-pod-opt v${VERSION}`);
console.log('Run with --help for usage (available after Phase 9).');
```

### Minimal passing vitest test (smoke test for Phase 1)

```typescript
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('build smoke test', () => {
  it('can import from src without resolution errors', async () => {
    // This test verifies the ESM import chain works.
    // If any import fails with ERR_MODULE_NOT_FOUND, the ESM config is broken.
    const { default: main } = await import('../src/index.js');
    expect(true).toBe(true); // If import fails, test never reaches here
  });
});
```

### Verifying a fixture file loads correctly in a test

```typescript
// tests/fixtures/fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('fixture data', () => {
  it('entities fixture is valid JSON with expected structure', () => {
    const raw = readFileSync(join(__dirname, '../fixtures/entities-response.json'), 'utf8');
    const data = JSON.parse(raw);
    expect(data).toHaveProperty('entities');
    expect(Array.isArray(data.entities)).toBe(true);
    expect(data.entities.length).toBeGreaterThan(0);
  });
});
```

**Note on `__dirname` in ESM:** The `__dirname` global is not available in ESM modules. Use the `fileURLToPath` + `import.meta.url` pattern shown above. This is a common gotcha for developers coming from CommonJS.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ts-node for dev execution | tsx (esbuild-based) | 2022-2023 | tsx is significantly faster for dev iteration; ts-node still works but is slower and has more configuration edge cases with ESM |
| jest for TypeScript testing | vitest | 2022-2024 | vitest is ESM-native; jest requires `experimental-vm-modules` and babel/ts transforms for ESM; no reason to choose jest for a new TypeScript project |
| CommonJS (`require()`) | ESM (`import`/`export`) | Ongoing 2022-2025 | ESM is the stable direction; ora v9, chalk v5 are ESM-only; Node 22 defaults to ESM warnings for CJS usage |
| tsc + rollup for CLI bundling | tsup | 2021-2024 | tsup wraps esbuild with sensible CLI defaults; produces equivalent output to tsc+rollup in a fraction of the config |
| `"module": "commonjs"` tsconfig | `"module": "NodeNext"` | TypeScript 4.7+ (2022) | `NodeNext` is the only mode that correctly handles dual-CJS/ESM packages and `package.json` `exports` fields |
| `commander` v11 | `commander` v14 (current) | 2024-2025 | v14 adds TypeScript-native types without extra package; API is backward compatible |

**Deprecated/outdated:**
- `ts-jest`: Use vitest instead for new TypeScript projects.
- `babel-jest` with `@babel/preset-typescript`: Legacy path; vitest makes this unnecessary.
- `node-fetch`: Redundant since Node 18 ships native `fetch`. Do not install.
- `moment.js`: In maintenance mode; use `date-fns` v4 instead.

---

## Open Questions

1. **Does the `src/index.ts` stub need to be importable or just executable?**
   - What we know: The smoke test imports `src/index.ts` dynamically to verify ESM resolution works.
   - What's unclear: If `src/index.ts` has side effects on import (e.g., calls `process.exit()`), the import test will fail.
   - Recommendation: Keep `src/index.ts` as a pure module with an explicit `main()` function called at the bottom via a guard — do not auto-execute on import.

2. **Should fixture data be in `tests/fixtures/` or a top-level `fixtures/` directory?**
   - What we know: DEV-01 says "A `fixtures/` directory exists." Phase 9 ROADMAP notes a `--fixture` CLI flag that activates fixture mode — implying fixtures are accessible to the CLI binary at runtime, not just tests.
   - What's unclear: Whether the CLI's fixture mode reads from the project root `fixtures/` or from the package's bundled fixtures.
   - Recommendation: Put fixtures in a top-level `fixtures/` directory (not inside `tests/`) to satisfy the ROADMAP success criterion literally and to support the Phase 9 `--fixture` CLI mode where the binary reads them at runtime.

3. **Which specific workloads should be represented in fixture data?**
   - What we know: Fixtures need to represent a "realistic multi-namespace cluster response."
   - What's unclear: Exact entity property names on the real Dynatrace Managed instance (`cpuRequest` vs `cpu_request` vs `kubernetesContainerCpuRequest`). These are validated in Phase 3.
   - Recommendation: Use the property names from ARCHITECTURE.md and STACK.md (`cpuRequest`, `memoryRequest`, `desiredReplicas`, `workloadType`) as a working assumption. Phase 3 may require updating fixture data once actual property names are confirmed against the live instance. Document this assumption in a `fixtures/README.md`.

---

## Sources

### Primary (HIGH confidence)

- `/Users/shubh/Repos/Github_Shubham/ops-pod-optimization/.planning/STATE.md` — Locked architecture decisions (ESM, NodeNext, tsup, vitest, handlebars)
- `/Users/shubh/Repos/Github_Shubham/ops-pod-optimization/.planning/ROADMAP.md` — Phase 1 success criteria (exact deliverables)
- `/Users/shubh/Repos/Github_Shubham/ops-pod-optimization/.planning/REQUIREMENTS.md` — CFG-05 and DEV-01 requirement text
- `npm info typescript version` → 5.9.3 (verified 2026-02-23)
- `npm info tsup version` → 8.5.1 (verified 2026-02-23)
- `npm info vitest version` → 4.0.18 (verified 2026-02-23)
- `npm info tsx version` → 4.21.0 (verified 2026-02-23)
- `npm info commander version` → 14.0.3 (verified 2026-02-23)
- `npm info js-yaml version` → 4.1.1 (verified 2026-02-23)
- `npm info zod version` → 4.3.6 (verified 2026-02-23)
- `npm info handlebars version` → 4.7.8 (verified 2026-02-23)
- `npm info ora version` → 9.3.0 (verified 2026-02-23)
- `npm info chalk version` → 5.6.2 (verified 2026-02-23)
- `npm info date-fns version` → 4.1.0 (verified 2026-02-23)
- `npm info @types/node version` → 25.3.0 (verified 2026-02-23)

### Secondary (MEDIUM confidence)

- `/Users/shubh/Repos/Github_Shubham/ops-pod-optimization/.planning/research/STACK.md` — Full stack rationale and module system decision
- `/Users/shubh/Repos/Github_Shubham/ops-pod-optimization/.planning/research/ARCHITECTURE.md` — Dynatrace API response shapes used for fixture data design
- TypeScript NodeNext module resolution documentation (training knowledge, August 2025) — `.js` extension convention in ESM imports
- tsup documentation (training knowledge, August 2025) — `banner`, `bundle`, `format` options

### Tertiary (LOW confidence)

- The exact `cpuRequest`/`memoryRequest` property names in fixture data — these are documented in ARCHITECTURE.md as "MEDIUM confidence, verify against live instance." Fixtures created in Phase 1 may need property name updates after Phase 3 empirical validation.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all package versions verified against npm registry live (2026-02-23); architecture decisions locked in STATE.md
- Architecture: HIGH — project structure is a Node.js CLI standard pattern; no external integration risk in Phase 1
- Pitfalls: HIGH — ESM TypeScript pitfalls are well-documented and stable; these exact errors appear consistently across the ecosystem
- Fixture data shapes: MEDIUM — based on ARCHITECTURE.md which carries MEDIUM confidence on Dynatrace property names pending Phase 3 live validation

**Research date:** 2026-02-23
**Valid until:** 2026-05-23 (stable tooling; versions change slowly; recheck if > 90 days pass before Phase 1 execution)
