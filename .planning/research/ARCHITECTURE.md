# Architecture Patterns

**Domain:** Node.js CLI tool — Dynatrace-backed Kubernetes pod optimization reporter
**Researched:** 2026-02-23
**Confidence note:** External research tools were unavailable during this session. Findings below are based on training-data knowledge of the Dynatrace v2 API (confidence: MEDIUM — API shape is well-documented and stable, but verify specific entity type names and metric key spellings against your live Dynatrace Managed instance). Node.js CLI architecture patterns are HIGH confidence from well-established community practice.

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────┐
│                       CLI Entry Point                    │
│              (bin/ops-pod-optimizer.js)                  │
│   parse flags → load config → orchestrate pipeline       │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     Config Loader                        │
│              (src/config/loader.js)                      │
│  validate YAML/JSON → merge env vars → freeze config     │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   Dynatrace API Client                   │
│              (src/api/dynatrace-client.js)               │
│  auth header injection, retry logic, rate-limit          │
│  throttling, pagination cursor handling, timeout         │
└────────────┬─────────────────────────────┬──────────────┘
             │                             │
             ▼                             ▼
┌─────────────────────────┐  ┌────────────────────────────┐
│   Entities Collector    │  │    Metrics Collector        │
│  (src/collectors/       │  │   (src/collectors/          │
│   entities.js)          │  │    metrics.js)              │
│  GET /api/v2/entities   │  │  GET /api/v2/metrics/query  │
│  workload metadata,     │  │  CPU, memory, network p90,  │
│  replicas, resource     │  │  replica count timeseries   │
│  requests/limits        │  │                             │
└────────────┬────────────┘  └─────────────┬──────────────┘
             │                             │
             └──────────────┬──────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  Data Correlator                         │
│              (src/analysis/correlator.js)                │
│  join entity metadata ↔ metric timeseries by entityId   │
│  produces: enriched workload records per namespace       │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│             Recommendation Engine                        │
│           (src/analysis/recommender.js)                  │
│  replica reduction logic, CPU/memory right-sizing,       │
│  HPA gap detection, configurable thresholds              │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Report Renderer                         │
│             (src/report/renderer.js)                     │
│  template engine (Handlebars/EJS) → single HTML file    │
│  namespace summary tables, per-pod detail tables,        │
│  inline CSS + optional chart.js for visualizations      │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
                  report-YYYY-MM-DD.html
```

---

## Component Boundaries

| Component | Responsibility | Inputs | Outputs | Communicates With |
|-----------|---------------|--------|---------|-------------------|
| CLI Entry Point | Parse argv, load config, sequence pipeline, handle top-level errors, print progress | argv, env vars | exit code, stderr/stdout | Config Loader, orchestrates all others |
| Config Loader | Read + validate YAML/JSON config; merge `DYNATRACE_API_TOKEN` env var; freeze immutable config object | config file path | Config object | CLI Entry Point |
| Dynatrace API Client | HTTP client wrapper: auth headers, base URL, retry with backoff, rate-limit throttle, pagination cursor abstraction | Config (baseUrl, token, timeout) | Raw API response payloads | Entities Collector, Metrics Collector |
| Entities Collector | Query `/api/v2/entities` for Kubernetes workload entities by namespace; extract metadata (replicas, resource requests) | Config (namespaces, timeWindow), API Client | Array of WorkloadEntity records | Data Correlator |
| Metrics Collector | Query `/api/v2/metrics/query` for CPU/memory/network p90 and replica timeseries per entity; handle resolution | Config (timeWindow, resolution), API Client | Array of MetricResult records keyed by entityId | Data Correlator |
| Data Correlator | Join WorkloadEntity records with MetricResult records on `entityId`; flag missing metric data; produce enriched records | WorkloadEntity[], MetricResult[] | EnrichedWorkload[] per namespace | Recommendation Engine |
| Recommendation Engine | Apply right-sizing rules per EnrichedWorkload; compare p90 actual vs request; flag HPA absence; produce typed recommendations | EnrichedWorkload[], Config (thresholds) | RecommendationSet per namespace | Report Renderer |
| Report Renderer | Render RecommendationSet into a single static HTML file; embed all CSS/JS inline; write file to disk | RecommendationSet[], Config (outputPath) | report-YYYY-MM-DD.html on disk | (terminal output) |

---

## Data Flow

```
Config File (YAML/JSON)
        │
        ▼
[Config Loader] ──────────────────────────► Config object (frozen)
        │
        ▼
[CLI Entry Point]
   ├──► [Entities Collector]
   │         │  GET /api/v2/entities
   │         │  entitySelector=type(CLOUD_APPLICATION_NAMESPACE)
   │         │  &entitySelector=namespaceName(...)
   │         │  fields=+properties.kubernetesLabels,+toRelationships.isClusterOf
   │         │  → cursor pagination until nextPageKey is null
   │         ▼
   │    WorkloadEntity[]  {entityId, displayName, namespace,
   │                       desiredReplicas, cpuRequest, memRequest}
   │
   ├──► [Metrics Collector]
   │         │  GET /api/v2/metrics/query
   │         │  metricSelector=builtin:containers.cpu.usagePercent:percentile(90)
   │         │  &entitySelector=type(CLOUD_APPLICATION_INSTANCE)...
   │         │  resolution=1h, from=now-Nd, to=now
   │         │  → nextPageKey pagination
   │         ▼
   │    MetricResult[]  {metricId, entityId, timestamps[], values[]}
   │
   ▼
[Data Correlator]
   join on entityId
   ▼
EnrichedWorkload[] {
  entityId, displayName, namespace,
  desiredReplicas, cpuRequest(millicores), memRequest(bytes),
  p90Cpu, p90Memory, p90NetRx, p90NetTx,
  dataQuality: FULL | PARTIAL | MISSING
}
   │
   ▼
[Recommendation Engine]
   per workload:
     cpuEfficiency = p90Cpu / cpuRequest
     memEfficiency = p90Memory / memRequest
     → if efficiency < threshold → RIGHTSIZE recommendation
     → if desiredReplicas > minReplicas AND no HPA entity found → FLAG_HPA
     → if desiredReplicas can be reduced by X% → REDUCE_REPLICAS recommendation
   ▼
RecommendationSet {
  namespace,
  summary: { totalWorkloads, rightsizeable, hpaGaps, replicaReducible },
  workloads: RecommendedWorkload[]
}
   │
   ▼
[Report Renderer]
   Handlebars template: report.hbs
   → namespace tabs or sections
   → summary table per namespace
   → per-pod detail table with recommendation badges
   → inline <style> block (no external CDN dependencies)
   → optional inline Chart.js for bar charts (bundle or omit for simplicity)
   ▼
report-2026-02-23.html  (self-contained, no server needed)
```

---

## Dynatrace v2 API Data Model for Kubernetes Entities

**Confidence: MEDIUM** — Dynatrace API shapes are well-documented and stable across v2, but entity type names and available properties should be verified against your Managed instance's API Explorer (`{baseUrl}/api/v2/metrics` and `/api/v2/entityTypes`).

### Entity Type Hierarchy for Kubernetes

```
KUBERNETES_CLUSTER
  └─ CLOUD_APPLICATION_NAMESPACE  (namespace-level entity)
       └─ CLOUD_APPLICATION        (workload/deployment-level entity)
            └─ CLOUD_APPLICATION_INSTANCE  (pod-level entity)
                  └─ CONTAINER_GROUP_INSTANCE (container within pod)
```

**Key entity types for this tool:**
- `CLOUD_APPLICATION` — maps to a Kubernetes Deployment, StatefulSet, or DaemonSet. Has `desiredReplicas`, `availableReplicas`, resource request properties.
- `CLOUD_APPLICATION_NAMESPACE` — namespace-level grouping. Use to scope entity queries.
- `CLOUD_APPLICATION_INSTANCE` — individual pod. Metrics are emitted at this granularity.

### Entity Selector Syntax

Query workloads in a namespace:
```
entitySelector=type("CLOUD_APPLICATION"),namespaceName("my-namespace")
```

Query pods in a namespace:
```
entitySelector=type("CLOUD_APPLICATION_INSTANCE"),namespaceName("my-namespace")
```

Query by cluster + namespace:
```
entitySelector=type("CLOUD_APPLICATION"),namespaceName("my-namespace"),kubernetesClusterId("cluster-id")
```

Multi-namespace (one call per namespace, or use `in` operator if supported by Managed version):
```
entitySelector=type("CLOUD_APPLICATION"),namespaceName("ns-a","ns-b","ns-c")
```

**Fields to request on entity query:**
```
fields=+properties,+toRelationships.isInstanceOf,+fromRelationships.contains
```

The `properties` object on `CLOUD_APPLICATION` includes:
- `kubernetesDeploymentName`
- `kubernetesNamespace`
- `desiredReplicas` (integer)
- `availableReplicas` (integer)
- `cpuRequest` (millicores, may be per-container aggregate)
- `memoryRequest` (bytes, may be per-container aggregate)

**Verify these exact property names** in your Managed instance — names vary slightly between Dynatrace versions. Use `/api/v2/entityTypes/CLOUD_APPLICATION` to inspect the live schema.

### Metrics Query

**Endpoint:** `GET /api/v2/metrics/query`

**Key metric selectors:**
```
builtin:containers.cpu.usagePercent:percentile(90)
builtin:containers.memory.residentMemoryBytes:percentile(90)
builtin:containers.net.bytesRx:percentile(90)
builtin:containers.net.bytesTx:percentile(90)
builtin:kubernetes.workload.pods        ← current replica count timeseries
```

**Parameters for scoped query:**
```
metricSelector=builtin:containers.cpu.usagePercent:percentile(90)
entitySelector=type("CLOUD_APPLICATION_INSTANCE"),namespaceName("my-namespace")
from=now-7d
to=now
resolution=1h
```

**Response shape:**
```json
{
  "resolution": "1h",
  "nextPageKey": "...",
  "result": [
    {
      "metricId": "builtin:containers.cpu.usagePercent:percentile(90)",
      "data": [
        {
          "dimensionMap": {"dt.entity.cloud_application_instance": "CLOUD_APPLICATION_INSTANCE-xxxxx"},
          "timestamps": [1700000000000, ...],
          "values": [12.5, 14.2, ...]
        }
      ]
    }
  ]
}
```

The `dimensionMap` key name for the entity dimension depends on the metric — it matches the entity type the metric is emitted against. For container metrics, it will be `dt.entity.cloud_application_instance` (pod-level). For workload replica metrics, it will be `dt.entity.cloud_application`.

### Entity-to-Metric Correlation

This is the core join problem:

1. **Entities query** returns `CLOUD_APPLICATION` entities with `entityId` like `CLOUD_APPLICATION-ABC123` and metadata (replicas, resource requests).
2. **Metrics query** returns timeseries with `dimensionMap` containing `CLOUD_APPLICATION_INSTANCE-XYZ789` (pod-level) — not workload-level.
3. **Correlation strategy:**
   - Option A (preferred): Query metrics with `entitySelector=type("CLOUD_APPLICATION_INSTANCE"),fromRelationships.isInstanceOf("CLOUD_APPLICATION-ABC123")` to scope per-workload, then aggregate pod-level p90 up to workload.
   - Option B: Query all pod metrics for a namespace, then use the entity relationship graph to map pod → workload. Requires a second entity query for relationship traversal.
   - Option C: Use the metric's `from` transformation with `splitBy("dt.entity.cloud_application")` if the metric supports rollup to workload level — reduces number of API calls significantly.

**Recommended approach:** Option C first (check if `splitBy` on `cloud_application` is available for container metrics); fall back to Option A if rollup is not supported.

### Pagination

Both `/api/v2/entities` and `/api/v2/metrics/query` use cursor-based pagination:
- First request returns `nextPageKey` in response body if more pages exist.
- Subsequent request: same parameters plus `nextPageKey=<token>` query param.
- Continue until `nextPageKey` is absent or null.

**Implementation pattern:**
```javascript
async function fetchAllPages(apiClient, endpoint, params) {
  const results = [];
  let nextPageKey = null;
  do {
    const queryParams = nextPageKey
      ? { ...params, nextPageKey }
      : params;
    const response = await apiClient.get(endpoint, queryParams);
    results.push(...response.data);         // adjust for actual response shape
    nextPageKey = response.nextPageKey ?? null;
  } while (nextPageKey);
  return results;
}
```

### Rate Limits

Dynatrace Managed v2 API rate limits (MEDIUM confidence — limits vary by Managed version and license):
- Metrics query: typically 50–100 requests/minute per token.
- Entities query: similar order of magnitude.
- **Mitigation:** implement exponential backoff on HTTP 429 responses; add configurable delay between namespace iterations (e.g., 200ms); batch entity fetches where possible.

---

## Patterns to Follow

### Pattern 1: Pipeline Orchestrator (thin CLI, fat services)
**What:** CLI entry point does only three things: parse args, build dependency graph, call orchestrator. All logic lives in domain modules.
**When:** Any CLI tool with more than 2-3 data processing steps.
**Why:** Enables unit testing each component in isolation; CLI layer becomes trivially thin.

```javascript
// bin/ops-pod-optimizer.js — should be < 30 lines
import { loadConfig } from '../src/config/loader.js';
import { runPipeline } from '../src/pipeline.js';

const config = await loadConfig(argv.config);
const results = await runPipeline(config);
await writeReport(results, config.outputDir);
```

### Pattern 2: Typed Domain Objects (JSDoc or TypeScript interfaces)
**What:** Define explicit data shapes for WorkloadEntity, MetricResult, EnrichedWorkload, Recommendation at the module boundary. Pass typed objects between components.
**When:** Any project with 3+ data transformation steps.
**Why:** Prevents silent field-name drift between components; makes the correlator join logic unambiguous.

```javascript
/**
 * @typedef {Object} WorkloadEntity
 * @property {string} entityId
 * @property {string} displayName
 * @property {string} namespace
 * @property {number} desiredReplicas
 * @property {number|null} cpuRequestMillicores
 * @property {number|null} memRequestBytes
 */
```

### Pattern 3: Collector Contracts with DataQuality enum
**What:** Every collector returns a result with an explicit `dataQuality` field: `FULL`, `PARTIAL`, or `MISSING`. Downstream components check quality before applying recommendations.
**When:** When data source may return incomplete results for some entities.
**Why:** Prevents false recommendations when metric data is absent (e.g., pod too new, metric gap).

```javascript
const QUALITY = Object.freeze({ FULL: 'FULL', PARTIAL: 'PARTIAL', MISSING: 'MISSING' });

function correlate(entity, metrics) {
  const hasCpu = metrics.cpu !== null;
  const hasMem = metrics.memory !== null;
  return {
    ...entity,
    ...metrics,
    dataQuality: hasCpu && hasMem ? QUALITY.FULL
               : hasCpu || hasMem ? QUALITY.PARTIAL
               : QUALITY.MISSING
  };
}
```

### Pattern 4: Self-Contained HTML Report (no external CDN)
**What:** The generated HTML embeds all CSS, fonts, and JavaScript inline in a single `<script>` / `<style>` block. No `<link>` to external CDNs.
**When:** Always, for offline-usable SRE tooling.
**Why:** Report is shareable via Slack/email and viewable without network access; no CSP issues on internal tooling.

**Template engine choice:** Use **EJS** (Embedded JavaScript Templates) — no build step, ships as a plain npm dependency, familiar HTML syntax, sufficient for table-heavy reports. Handlebars is an alternative but adds unnecessary abstraction for this use case.

### Pattern 5: Per-Namespace Iteration with Fail-Partial
**What:** Collect data and generate recommendations namespace by namespace. If one namespace fails, log the error, mark namespace as `ERROR` in the report, and continue with remaining namespaces.
**When:** Multi-namespace operations with independent failure modes.
**Why:** A single Dynatrace API error for one namespace should not abort the entire run.

```javascript
const results = await Promise.allSettled(
  config.namespaces.map(ns => collectNamespace(ns, apiClient))
);
// Handle fulfilled/rejected individually
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Mixing Dynatrace API Logic into Business Logic
**What:** Putting API call construction (entity selectors, metric selectors, cursor handling) directly in the recommendation engine or report renderer.
**Why bad:** Makes the tool impossible to test without live Dynatrace; couples recommendation thresholds to API pagination logic.
**Instead:** API Client and Collectors are the only modules that know about Dynatrace. They produce typed domain objects. Everything downstream is Dynatrace-agnostic.

### Anti-Pattern 2: Querying All Metrics in One Call
**What:** Requesting all 5+ metric keys in a single `metricSelector` string for all namespaces at once.
**Why bad:** Response payload becomes enormous; partial failures require full retry; pagination across multiple metrics is harder to debug.
**Instead:** One metric key per call, or batch 2-3 related metrics (CPU + memory together is reasonable). Iterate namespaces sequentially with small delays.

### Anti-Pattern 3: Storing Raw API Responses as Intermediate Format
**What:** Writing raw Dynatrace JSON to disk and reading it back in the next step.
**Why bad:** Tightly couples all downstream code to Dynatrace API response shape; any API change breaks report generation.
**Instead:** Collectors translate raw API responses into domain types immediately. Disk I/O is only for the final HTML report (and optionally a JSON debug dump).

### Anti-Pattern 4: Hardcoding Thresholds in the Recommendation Engine
**What:** Embedding efficiency thresholds (e.g., "flag if CPU utilization < 40%") as constants in code.
**Why bad:** SREs will want to tune thresholds per namespace or workload type; hardcoded values require code changes.
**Instead:** Thresholds live in config file with documented defaults. Recommendation engine reads from config.

### Anti-Pattern 5: Generating HTML by String Concatenation
**What:** Building the report via `html += '<tr><td>' + value + '</td></tr>'` in application code.
**Why bad:** XSS risk if entity names contain HTML characters; unreadable code; impossible to maintain layout changes.
**Instead:** Use EJS or Handlebars. All dynamic values are escaped by default.

### Anti-Pattern 6: Failing the Entire Run on Missing HPA Data
**What:** Throwing an error when the Dynatrace API returns no HPA entities (e.g., HPA monitoring not enabled).
**Why bad:** HPA gap detection is a secondary feature; missing HPA data should degrade gracefully, not crash.
**Instead:** HPA detection is best-effort. If no HPA entities found for a workload, record `hpaStatus: UNKNOWN` rather than failing.

---

## Build Order (Component Dependencies)

Components have hard dependencies that dictate build sequence:

```
1. Config Loader          ← no dependencies; must exist before anything else
2. Dynatrace API Client   ← depends on Config (base URL, token, timeout)
3. Entities Collector     ← depends on API Client
4. Metrics Collector      ← depends on API Client
5. Data Correlator        ← depends on Entities + Metrics Collector output shapes
6. Recommendation Engine  ← depends on Correlator output shape + Config (thresholds)
7. Report Renderer        ← depends on Recommendation Engine output shape
8. CLI Entry Point        ← wires all of the above; add last when pipeline is proven
```

**Practical build phases:**

- **Phase 1 (Foundation):** Config Loader + Dynatrace API Client. Get auth working against your Managed instance. Run a raw entity query and a raw metric query. Verify entity selector syntax and confirm metric keys return data. This is the highest-risk step — validate early.
- **Phase 2 (Collection):** Entities Collector + Metrics Collector. Produce typed domain objects. Implement pagination. Add retry logic.
- **Phase 3 (Analysis):** Data Correlator + Recommendation Engine. Pure functions, no API calls. Fully unit-testable with fixture data.
- **Phase 4 (Output):** Report Renderer. Build template with hardcoded fixture data first, then wire to real recommendation output.
- **Phase 5 (Integration):** CLI Entry Point. Wire the full pipeline. Add progress output, error handling, and flag parsing.

---

## Scalability Considerations

| Concern | At 5 namespaces | At 50 namespaces | At 500 namespaces |
|---------|----------------|------------------|-------------------|
| API call volume | Trivial | Sequential with throttle | Parallel batches, respect rate limits aggressively |
| Memory | All results in-memory, fine | Still fine for metric timeseries | Stream results to disk between phases |
| Report size | Single HTML, fast to render | May need namespace navigation tabs | Consider splitting report per namespace |
| Run time | Seconds | 1-5 minutes | May exceed token timeout; consider incremental runs |

**For v1:** sequential namespace iteration with 200ms inter-request delay is sufficient and simplest. Avoid premature parallelism.

---

## Directory Structure

```
ops-pod-optimization/
├── bin/
│   └── ops-pod-optimizer.js          # CLI entry point (thin)
├── src/
│   ├── config/
│   │   ├── loader.js                 # YAML/JSON parser, validation, env var merge
│   │   └── schema.js                 # Config schema (ajv or joi)
│   ├── api/
│   │   └── dynatrace-client.js       # HTTP client, auth, retry, pagination abstraction
│   ├── collectors/
│   │   ├── entities.js               # /api/v2/entities queries
│   │   └── metrics.js                # /api/v2/metrics/query queries
│   ├── analysis/
│   │   ├── correlator.js             # Join entities + metrics
│   │   └── recommender.js            # Right-sizing + HPA gap logic
│   ├── report/
│   │   ├── renderer.js               # Orchestrates template rendering
│   │   └── templates/
│   │       └── report.ejs            # Main HTML template
│   └── pipeline.js                   # Orchestrates collection → analysis → output
├── config.example.yaml               # Example config with documentation
├── package.json
└── tests/
    ├── fixtures/                      # Captured API response samples
    ├── collectors/
    ├── analysis/
    └── report/
```

---

## Error Handling Patterns

### API Failures

```javascript
// Classify errors at the API client level
class DynatraceApiError extends Error {
  constructor(statusCode, message, retryable) {
    super(message);
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

// 429 → retryable (respect Retry-After header)
// 401 → fatal (bad token, abort immediately with clear message)
// 403 → fatal (insufficient API token scopes — list required scopes in message)
// 404 → warn + continue (entity not found, mark MISSING)
// 500/503 → retryable with exponential backoff
```

### Missing Data Policy

| Scenario | Behavior |
|----------|----------|
| Entity has no metric data | `dataQuality: MISSING`, skip recommendations, show in report as "No metric data" |
| Entity has partial metric data (CPU but not memory) | `dataQuality: PARTIAL`, generate available recommendations, flag missing metrics |
| API returns 0 entities for a namespace | Warn in CLI output, show namespace in report as "No workloads found" |
| API token lacks required scope | Fatal error with explicit scope list in error message |
| Namespace in config not found in Dynatrace | Warn + skip, continue with other namespaces |

### Required API Token Scopes

Verify these in your Dynatrace Managed API token settings (MEDIUM confidence):
- `metrics.read` — for `/api/v2/metrics/query`
- `entities.read` — for `/api/v2/entities`

Both scopes are needed. Validate at startup with a test request and emit a clear error if either fails.

---

## Technology Choices for Implementation

| Need | Choice | Rationale |
|------|--------|-----------|
| HTTP client | `axios` or native `fetch` (Node 18+) | `fetch` preferred for zero-dependency; `axios` if retry interceptors are needed |
| Config parsing | `js-yaml` + `ajv` | YAML parse + JSON Schema validation; lightweight |
| HTML templating | `ejs` | Minimal setup, HTML-native syntax, auto-escaping |
| CLI arg parsing | `yargs` or `commander` | Both mature; `commander` has simpler API for this use case |
| Retry logic | `p-retry` or custom | `p-retry` is small and composable; custom is fine given simple retry needs |
| Testing | `jest` or `vitest` | `vitest` is faster and ESM-native if using ESM modules |

---

## Sources

**Confidence levels for key claims:**

- Dynatrace v2 API entity type names (`CLOUD_APPLICATION`, `CLOUD_APPLICATION_NAMESPACE`, `CLOUD_APPLICATION_INSTANCE`): MEDIUM — from training data on Dynatrace documentation. Verify against your Managed instance at `{baseUrl}/api/v2/entityTypes`.
- Metric keys (`builtin:containers.cpu.usagePercent`, etc.): MEDIUM — listed directly in PROJECT.md as validated by the team; cross-check against `/api/v2/metrics` in your instance.
- `nextPageKey` pagination pattern: HIGH — documented consistently across Dynatrace v2 API surface.
- Rate limit specifics (50-100 req/min): LOW — varies by Managed version and license; test empirically.
- EJS for templating: HIGH — well-established Node.js ecosystem choice.
- Node.js CLI architecture (thin CLI + service pipeline): HIGH — standard community pattern.

**Reference URLs to verify (requires your Managed instance access):**
- `{your-dynatrace-base-url}/api/v2/entityTypes` — inspect live entity type schemas
- `{your-dynatrace-base-url}/api/v2/metrics` — list available metric keys with units
- `{your-dynatrace-base-url}/swagger-ui/` — interactive API docs for your Managed version
- Dynatrace public docs: https://www.dynatrace.com/support/help/dynatrace-api/environment-api/metric-v2
- Dynatrace entity selector docs: https://www.dynatrace.com/support/help/dynatrace-api/environment-api/entity-v2/entity-selector
