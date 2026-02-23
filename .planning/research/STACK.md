# Technology Stack

**Project:** Ops Pod Optimization Tool
**Researched:** 2026-02-23
**Research mode:** Ecosystem — Node.js CLI, Dynatrace v2 API, static HTML report generation

---

## Note on Tool Availability

Web search and URL fetch were unavailable during this research session. All findings are drawn from training knowledge (cutoff: August 2025). Confidence levels reflect this constraint — HIGH confidence is assigned only where the ecosystem has been stable and well-documented for multiple years, or where the choice is low-stakes/easily reversible. All version numbers should be verified against `npm info <package> version` before committing to package.json.

---

## Recommended Stack

### Core Framework / Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 20 LTS (minimum) | Runtime | LTS with stable native `fetch` support (v18+); avoid v22 until more LTS-stable. Node 20 ships with `fetch` globally available, eliminating the main reason to reach for external HTTP clients. |
| TypeScript | 5.x | Type safety | The Dynatrace API returns deeply nested JSON; TypeScript interfaces make the API surface self-documenting and prevent silent field-name bugs. Worth the setup overhead for any tool that will be handed off to SRE teammates. |

**Confidence:** HIGH — Node 20 LTS status and TypeScript v5 stability are well-established facts.

---

### HTTP Client

**Recommendation: Use Node.js native `fetch` (built-in, no dependency).**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js native `fetch` | built-in (Node 18+) | Dynatrace v2 API calls | Zero dependency, ships with Node 20 LTS, sufficient for authenticated REST API calls with custom headers. |

**Rationale:**

This tool makes synchronous sequential API calls to Dynatrace — query metrics for each namespace, then query entities. There is no need for streaming, connection pooling, retry middleware, or advanced intercept hooks. Native `fetch` handles:
- `Authorization: Api-Token <token>` headers
- JSON request/response bodies
- HTTPS (required for on-prem Dynatrace Managed, which may use self-signed certs)
- Basic error handling on non-2xx responses

**Self-signed certificate caveat:** Dynatrace Managed on-prem often uses internal CA certificates. Native `fetch` respects `NODE_EXTRA_CA_CERTS` env var. If the environment uses self-signed certs that cannot be injected this way, switch to `undici` (Node's underlying fetch implementation, also part of core) with a custom `Agent` — this avoids the `NODE_TLS_REJECT_UNAUTHORIZED=0` anti-pattern.

**Why not axios:**
- axios adds ~100KB dependency with no benefit for this use case
- axios v1.x had several CVEs in 2023-2024 related to CSRF/SSRF
- axios interceptor system is valuable for app servers, overkill for a CLI

**Why not got:**
- got v14+ is ESM-only, which creates module system friction in Node.js projects that mix CommonJS tooling
- adds 200KB+ of dependencies for retry/stream features not needed here

**Why not node-fetch:**
- node-fetch is a polyfill that became redundant when Node 18+ shipped native fetch
- its package was effectively deprecated for new projects post-Node 18

**Why not undici (directly):**
- undici IS the right escape hatch for self-signed cert scenarios
- but for standard cases, native `fetch` (which wraps undici) is cleaner

**Confidence:** HIGH for native fetch recommendation. MEDIUM for undici as fallback (depends on the specific on-prem TLS configuration, which is environment-specific).

---

### YAML/JSON Config Parsing

**Recommendation: `js-yaml` for YAML parsing.**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| js-yaml | ^4.1.0 | Parse YAML config file | De facto standard YAML parser for Node.js; v4.x removed the unsafe `safeLoad` API confusion of v3; pure JS, no native bindings needed |

```typescript
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';

const config = load(readFileSync('./config.yaml', 'utf8')) as ToolConfig;
```

**Why not yaml (by eemeli):**
- `yaml` package is more correct for full YAML spec compliance, but that is overkill for a config file that humans write
- `js-yaml` is more widely known in SRE tooling contexts

**Why not JSON-only:**
- YAML config files allow comments, which matters for infrastructure configuration that will be version-controlled
- SREs expect to annotate config files with `# this namespace is prod, don't change thresholds`

**Why not cosmiconfig:**
- cosmiconfig is for libraries that need to discover config from multiple locations (package.json, .rc files, etc.)
- a CLI tool with an explicit `--config` flag does not need this complexity

**Confidence:** HIGH — js-yaml v4 has been stable and dominant for years.

---

### CLI Argument Parsing

**Recommendation: `commander` v12.**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| commander | ^12.0.0 | CLI argument parsing | Most downloaded Node.js CLI library; simple, synchronous, well-typed TypeScript support via `@commander-js/extra-typings`; no magic |

```typescript
import { Command } from 'commander';

const program = new Command();
program
  .name('ops-pod-optimizer')
  .description('Analyze Kubernetes pod efficiency via Dynatrace v2 API')
  .version('0.1.0')
  .requiredOption('-c, --config <path>', 'Path to config YAML file')
  .option('--start <datetime>', 'Start of analysis window (ISO 8601)', '72h')
  .option('--end <datetime>', 'End of analysis window (ISO 8601)', 'now')
  .option('-o, --output <path>', 'Output HTML report path', './report.html')
  .option('--namespace <name>', 'Analyze single namespace only')
  .parse(process.argv);
```

**Why not yargs:**
- yargs has excellent features (middleware, async command handlers, automatic help) that are valuable for multi-command CLIs
- this tool is a single-command tool; yargs' surface area is overkill
- yargs adds more bundle weight than commander

**Why not meow:**
- meow is ESM-only as of v13+, creating CommonJS friction
- meow is better suited for simple single-flag scripts; its type support is weaker

**Why not minimist/nopt:**
- low-level parsers with no built-in help generation, validation, or type coercion
- SRE tooling should have `--help` that actually documents flags

**Confidence:** HIGH — commander v12 is the established choice for TypeScript CLI tools in 2025.

---

### HTML Report Generation

**Recommendation: `handlebars` for templating + inline Chart.js (CDN or vendored) for charts.**

#### Templating Engine

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| handlebars | ^4.7.8 | HTML report template rendering | Logic-less templates enforce separation of data (TypeScript) and presentation (HTML); familiar to SRE audiences who may need to modify templates; excellent TypeScript support |

**Why not EJS:**
- EJS allows arbitrary JavaScript in templates, which makes templates harder to maintain safely and pushes logic into the wrong layer
- handlebars' explicit helpers pattern keeps template logic in TypeScript where it can be tested

**Why not Nunjucks:**
- Nunjucks is excellent (Jinja2-compatible, async support) but designed for server-side rendering at scale
- handlebars is simpler for the use case of a single-shot static report generation

**Why not Mustache:**
- Mustache is a subset of Handlebars; Handlebars adds helpers which are needed for conditional rendering of recommendations (if-else per pod status)

#### Chart Library (for static HTML embedding)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Chart.js | ^4.x (CDN reference) | Bar/radar charts in HTML report | Chart.js renders in the browser via `<canvas>`; embed the chart config as a JSON data island in the HTML, reference Chart.js from CDN or vendor the minified file |

**Approach — embed Chart.js as data islands:**

```html
<!-- In the Handlebars template -->
<script src="./vendor/chart.umd.min.js"></script>
<script>
  const podData = {{{json chartData}}};
  new Chart(document.getElementById('cpu-chart'), {
    type: 'bar',
    data: podData.cpu
  });
</script>
```

Vendor the chart.umd.min.js file into the output directory so the report works offline (SRE bastion hosts may not have internet access).

**Why not server-side chart rendering (node-canvas + Chart.js SSR):**
- node-canvas requires native bindings (Cairo library); fails on minimal Linux environments
- the report is HTML, not PDF; browser-side rendering is the right model

**Why not D3.js:**
- D3 requires significant JavaScript authoring inside the HTML template
- Chart.js produces production-quality bar charts with 10 lines of config; D3 requires 100+
- D3 is the right choice when you need custom visualizations; bar charts showing CPU/memory utilization are not custom

**Why not Recharts:**
- Recharts is a React component library; embedding it in a static HTML file requires either a React runtime or a build step
- adds unnecessary complexity for a static report generation tool

**Confidence:** MEDIUM — the handlebars recommendation is HIGH confidence. The Chart.js-in-static-HTML approach is MEDIUM confidence; the exact implementation (vendor vs CDN, data island pattern) should be prototyped in Phase 1 to validate it works correctly on offline/restricted bastion environments.

---

### Dynatrace v2 API — Critical Implementation Details

**Confidence:** MEDIUM-HIGH — based on Dynatrace official documentation patterns known through training cutoff. Verify against live Dynatrace Managed instance before implementing, as on-prem versions may lag behind SaaS documentation.

#### Authentication

All requests require:
```
Authorization: Api-Token <token>
Content-Type: application/json
```

API Token must have scopes:
- `metrics.read` — for `/api/v2/metrics/query`
- `entities.read` — for `/api/v2/entities`
- `DataExport` — may be required depending on Dynatrace Managed version

#### Metrics Query API — `GET /api/v2/metrics/query`

**Endpoint:**
```
GET https://{managed-host}/e/{environment-id}/api/v2/metrics/query
```

**Key parameters:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `metricSelector` | Metric key with optional aggregation | `builtin:containers.cpu.usagePercent:percentile(90)` |
| `resolution` | Time bucket size | `1h`, `30m`, `1d` |
| `from` | Start time (ISO 8601 or relative) | `now-72h`, `2026-01-01T00:00:00Z` |
| `to` | End time | `now` |
| `entitySelector` | Filter to specific entity types | See below |
| `mzSelector` | Management zone filter | `mzName("production")` |

**Metric selector syntax with percentile:**
```
builtin:containers.cpu.usagePercent:percentile(90)
builtin:containers.memory.residentMemoryBytes:percentile(90)
builtin:containers.net.bytesRx:percentile(90)
builtin:containers.net.bytesTx:percentile(90)
```

**Entity selector syntax for Kubernetes:**
```
# All pods in a specific namespace
entitySelector=type(CLOUD_APPLICATION_NAMESPACE),nameEquals("production")

# Kubernetes workloads (deployments/statefulsets)
entitySelector=type(CLOUD_APPLICATION),namespaceName("production")

# Containers in a namespace (for CPU/memory metrics)
entitySelector=type(CONTAINER_GROUP_INSTANCE),namespaceName("production")
```

**Important:** Dynatrace entity selectors use Dynatrace entity types, NOT Kubernetes resource types directly. The mapping is:
- Kubernetes Namespace → `CLOUD_APPLICATION_NAMESPACE`
- Kubernetes Deployment/StatefulSet → `CLOUD_APPLICATION`
- Kubernetes Pod → `CLOUD_APPLICATION_INSTANCE`
- Container (within pod) → `CONTAINER_GROUP_INSTANCE`

CPU and memory metrics are collected at the **container** level (`CONTAINER_GROUP_INSTANCE`), not the pod level. You will need to aggregate container metrics up to the pod/workload level in your analysis code.

**Replica count metric:**
```
builtin:kubernetes.workload.pods
```
Entity type: `CLOUD_APPLICATION` (workload)

**Response shape (simplified):**
```json
{
  "resolution": "1h",
  "result": [
    {
      "metricId": "builtin:containers.cpu.usagePercent:percentile(90)",
      "data": [
        {
          "dimensionMap": {
            "dt.entity.container_group_instance": "CONTAINER_GROUP_INSTANCE-abc123"
          },
          "timestamps": [1700000000000, 1700003600000],
          "values": [12.4, 15.1]
        }
      ]
    }
  ]
}
```

**Pagination:** The metrics API returns up to 1000 data points per request. Use `nextPageKey` if present in the response for pagination.

#### Entities API — `GET /api/v2/entities`

**Purpose:** Get Kubernetes workload metadata (resource requests, limits, replica spec) that metrics API does not return.

**Endpoint:**
```
GET https://{managed-host}/e/{environment-id}/api/v2/entities
```

**Key parameters:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `entitySelector` | Filter entities | `type(CLOUD_APPLICATION),namespaceName("production")` |
| `fields` | Additional fields to return | `+properties,+toRelationships` |
| `from` | Time window for entity existence | `now-72h` |

**CRITICAL: Resource requests/limits availability:** Dynatrace stores Kubernetes resource requests and limits as entity properties. However, availability depends on:
1. OneAgent version (must be recent enough to collect this data)
2. Dynatrace Managed version
3. Whether the Kubernetes integration is fully configured

**Do not assume resource requests/limits are available without validating against the actual Dynatrace instance.** This is the highest-risk assumption in the project. If resource request data is not available via the entities API, you will need an alternative strategy (e.g., the SRE provides request values in the config file as a fallback).

**Confidence:** MEDIUM — entity property availability is version-dependent and environment-specific.

#### Existing Dynatrace Node.js SDKs

**Official Dynatrace Node.js SDK:** As of training cutoff (August 2025), Dynatrace does not publish an officially supported Node.js SDK for the v2 API. The official SDKs are for Java, Go, and Python (via `dynatrace-sdk` Python package). There is a `@dynatrace-sdk/client-classic-environment-v1` and related packages in the `@dynatrace-sdk` npm scope, but these are primarily for Dynatrace App Framework (browser-based apps within the Dynatrace platform) — not for external CLI tools calling the API.

**Recommendation: Do NOT use `@dynatrace-sdk/*` packages.** They target a different use case (in-platform apps) and add significant complexity. Build direct REST calls with native fetch.

**Community libraries:** No dominant community library exists for Dynatrace v2 API access in Node.js. This is expected — the v2 API is straightforward enough that direct REST calls are the standard approach.

**Confidence:** MEDIUM — verified through training knowledge but should be confirmed by checking npm.js for `@dynatrace-sdk` scope before implementation.

---

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `js-yaml` | ^4.1.0 | YAML config parsing | Always — config file is YAML |
| `zod` | ^3.22.0 | Config and API response validation | Validate loaded YAML config against schema; validate Dynatrace API responses before processing |
| `date-fns` | ^3.x | Date/time manipulation for time windows | Parse user-provided time strings, format timestamps in report |
| `ora` | ^8.0.0 | Terminal spinner | Show progress during API calls (multiple namespaces × multiple metrics = many requests) |
| `chalk` | ^5.x | Terminal color output | Error/warning/success messages in CLI output |
| `handlebars` | ^4.7.8 | HTML template rendering | Generate the static HTML report |

**Why zod:**
The Dynatrace API response schema is not typed at compile time. Zod validates the runtime response shape and provides TypeScript types from the schema definition — one source of truth. This prevents silent bugs when Dynatrace Managed returns an unexpected structure (e.g., missing field when no data exists for a metric).

**Why date-fns over moment/luxon:**
- moment.js is in maintenance mode (deprecated)
- date-fns v3 is tree-shakeable, ESM-compatible, and covers all needed date arithmetic
- luxon is good but date-fns has wider adoption in the tooling ecosystem

**Why ora ^8 and chalk ^5:**
Both are ESM-only in their latest major versions. If using TypeScript with `"module": "ESNext"` this is fine. If using CommonJS output, pin to ora@5 and chalk@4 (last CommonJS-compatible versions). **This is a critical setup decision** — choose module system before installing these packages.

**Confidence:** HIGH for zod. MEDIUM for ora/chalk version choice (depends on TypeScript module system decision).

---

### Build and Development Tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TypeScript | ^5.4 | Type safety + compilation | See rationale above |
| tsx | ^4.x | Run TypeScript directly in dev | Faster iteration than ts-node; uses esbuild under the hood |
| tsup | ^8.x | Bundle for distribution | Produces single-file CLI binary; handles ESM/CJS output; simple config |
| vitest | ^1.x | Testing | ESM-native, TypeScript-first, Jest-compatible API |

**Why tsup over tsc directly:**
- tsup bundles all dependencies into a single output file
- SREs running this tool from a bastion don't want to run `npm install` — a bundled output eliminates that step
- tsup configuration is 10 lines vs complex tsc+rollup setups

**Why vitest over jest:**
- vitest is ESM-native; jest requires additional transforms for ESM modules
- vitest configuration is simpler for TypeScript projects
- API is Jest-compatible so prior Jest knowledge transfers

**Confidence:** MEDIUM — tsx and tsup are well-established in 2024-2025 tooling but are newer than commander/handlebars. Both are backed by active maintainers.

---

## Module System Decision (Critical)

**Recommendation: Use ESM (`"type": "module"` in package.json) with TypeScript `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`.**

**Why:**
- The ecosystem has largely moved to ESM as of 2024-2025
- ora v8+, chalk v5+, got v14+, and others are ESM-only
- `"NodeNext"` module resolution correctly handles dual-CJS/ESM packages

**What this means in practice:**
- All imports use `.js` extensions in TypeScript source (TypeScript convention for ESM): `import { load } from './config.js'`
- `require()` is not available
- Dynamic imports (`await import()`) are used for lazy loading if needed

**Confidence:** MEDIUM — ESM is the right direction but has rough edges in 2025, particularly with older tooling. If the team uses a bundler (tsup), the ESM friction is greatly reduced because tsup handles module interop.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HTTP client | native fetch | axios | Zero deps win; axios is overkill for REST CLI |
| HTTP client | native fetch | got | ESM-only friction; unneeded features |
| HTTP client | native fetch | undici (direct) | Use as escape hatch for TLS only |
| CLI parsing | commander | yargs | Overkill for single-command CLI |
| CLI parsing | commander | meow | ESM-only; weaker types |
| YAML parsing | js-yaml | yaml (eemeli) | Overkill YAML spec compliance for config files |
| Config discovery | explicit `--config` flag | cosmiconfig | Overkill; explicit is better for SRE tooling |
| Templating | handlebars | EJS | Avoids logic-in-template anti-pattern |
| Templating | handlebars | Nunjucks | Server-rendering complexity not needed |
| Charts | Chart.js (browser-side) | D3.js | 10x more code for equivalent bar charts |
| Charts | Chart.js (browser-side) | node-canvas SSR | Native bindings; fails on minimal Linux |
| Charts | Chart.js (browser-side) | Recharts | React runtime overhead |
| Build | tsup | tsc + rollup | Simple config vs complex pipeline |
| Test | vitest | jest | ESM-native; simpler TS config |
| Runtime types | zod | io-ts | zod has better DX and wider adoption |

---

## Installation

```bash
# Initialize project
npm init -y
npm pkg set type=module

# Core runtime dependencies
npm install js-yaml handlebars zod date-fns ora chalk commander

# TypeScript and build
npm install -D typescript tsx tsup vitest @types/node @types/js-yaml @types/handlebars

# TypeScript config
npx tsc --init --module NodeNext --moduleResolution NodeNext --target ES2022 --outDir dist --rootDir src --strict true
```

**Note:** Verify all package versions at install time with `npm info <package> version`. The versions listed in this document reflect knowledge through August 2025 and should be treated as minimum bounds.

---

## Project Structure (Recommended)

```
ops-pod-optimization/
├── src/
│   ├── index.ts           # CLI entry point (commander setup)
│   ├── config/
│   │   ├── loader.ts      # YAML config loading + zod validation
│   │   └── schema.ts      # Zod schema for config file
│   ├── api/
│   │   ├── client.ts      # Dynatrace API client (native fetch wrapper)
│   │   ├── metrics.ts     # Metrics API queries
│   │   ├── entities.ts    # Entities API queries
│   │   └── types.ts       # Zod schemas + TS types for API responses
│   ├── analysis/
│   │   ├── percentile.ts  # p90 calculation from time-series data
│   │   ├── recommendations.ts  # Right-sizing logic
│   │   └── hpa.ts         # HPA gap detection
│   ├── report/
│   │   ├── generator.ts   # Handlebars rendering + file write
│   │   ├── template.hbs   # Main HTML template
│   │   └── helpers.ts     # Handlebars helpers (formatBytes, formatCPU, etc.)
│   └── vendor/
│       └── chart.umd.min.js  # Vendored Chart.js for offline use
├── config.example.yaml    # Example config with comments
├── tsconfig.json
├── tsup.config.ts
└── package.json
```

---

## Sources

- Project context: `.planning/PROJECT.md`
- Dynatrace v2 API documentation patterns: training knowledge (August 2025 cutoff) — MEDIUM confidence, verify against live Dynatrace Managed instance
- Node.js native fetch availability: Node.js 18+ official release notes — HIGH confidence
- npm package ecosystem: training knowledge — MEDIUM confidence, verify versions at install time
- commander, js-yaml, handlebars: long-established packages with stable APIs — HIGH confidence
- Chart.js static embedding pattern: well-documented community pattern — MEDIUM confidence
- Dynatrace entity type mapping (CLOUD_APPLICATION_NAMESPACE etc.): training knowledge — MEDIUM confidence, verify against Dynatrace Managed v2 API entity documentation
- @dynatrace-sdk scope assessment: training knowledge — MEDIUM confidence, check npm.js before implementation
- ESM module system recommendation: community consensus through 2025 — MEDIUM confidence (ecosystem still in transition)
