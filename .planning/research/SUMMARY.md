# Project Research Summary

**Project:** Ops Pod Optimization Tool
**Domain:** Node.js CLI — Dynatrace-backed Kubernetes pod right-sizing reporter
**Researched:** 2026-02-23
**Confidence:** MEDIUM (Dynatrace Managed integration specifics require live instance validation; Node.js CLI patterns are HIGH confidence)

## Executive Summary

This is a Kubernetes pod right-sizing CLI tool that occupies a clear gap in the existing ecosystem: it uses Dynatrace as its sole data source, eliminating the need for VPA installation, Prometheus, or direct Kubernetes API access. The closest analogue is Robusta KRR (Prometheus-based) and Goldilocks (VPA-based), but both require in-cluster tooling that many on-prem SRE teams cannot easily deploy. This tool's core value proposition is producing shareable, static HTML reports from Dynatrace metrics alone — a unique combination no existing tool offers.

The recommended approach is a clean pipeline architecture: Config Loader → Dynatrace API Client → Entities Collector + Metrics Collector → Data Correlator → Recommendation Engine → Report Renderer. This layered design is the standard Node.js CLI pattern for data-pipeline tools, and each component can be unit-tested independently using fixture data. The Dynatrace API integration is the highest-risk element and must be validated against the actual Managed instance in Phase 1 before any recommendation logic is built — API entity type availability, property names, and metric key support all vary by Managed version and are not fully verifiable from documentation alone.

The top risks are: (1) Dynatrace entity selector returning wrong or empty pods for namespace filters — must be validated empirically; (2) metric resolution being silently too coarse (1h rollup instead of 1m), making p90 calculations statistically meaningless for bursty workloads; (3) HPA detection being unreliable via Dynatrace alone, since HPAs are a Kubernetes control-plane concept with limited Dynatrace entity model coverage. All three must be treated as Phase 1 validation requirements, not Phase 2 assumptions.

---

## Key Findings

### Recommended Stack

The tool is a pure TypeScript Node.js CLI with zero heavyweight framework dependencies. The module system choice is ESM (`"type": "module"`, TypeScript `"module": "NodeNext"`) to align with the 2024-2025 ecosystem direction, with tsup bundling to a single distributable file so SREs on bastion hosts do not need to run `npm install`. Native `fetch` (Node 20 LTS built-in) handles all Dynatrace API calls — no HTTP client library needed.

See `.planning/research/STACK.md` for full rationale.

**Core technologies:**
- **Node.js 20 LTS + TypeScript 5.x**: Runtime and type safety — TypeScript interfaces on Dynatrace's deeply nested JSON prevent silent field-name bugs during integration
- **Native `fetch` (Node 20 built-in)**: Dynatrace API calls — zero dependency, sufficient for authenticated REST; escape hatch is `undici` with a custom Agent for self-signed cert environments
- **commander v12**: CLI argument parsing — simplest mature option for a single-command tool; yargs is overkill
- **js-yaml v4 + zod v3**: Config parsing and runtime validation — YAML allows SRE comments in config; zod validates both YAML config and Dynatrace API response shapes at runtime
- **handlebars v4**: HTML report templating — logic-less templates keep presentation separate from recommendation logic; prevents XSS via auto-escaping
- **Chart.js v4 (vendored)**: Bar charts in HTML report — vendored (not CDN-referenced) so the report works on offline/air-gapped bastion hosts
- **tsup + vitest**: Build and test — tsup produces a single-file bundled CLI; vitest is ESM-native and TypeScript-first

**Critical version note:** `ora` v8+ and `chalk` v5+ are ESM-only; with the chosen ESM module system this is fine, but the module system decision must be locked before installing these packages.

### Expected Features

The feature set is well-defined. All table stakes items align exactly with what SREs expect from comparisons against Goldilocks, KRR, and VPA tooling. The two high-value differentiators unique to this tool are replica reduction recommendations (no competing tool offers this) and Dynatrace-as-sole-data-source (enabling on-prem environments with no cluster API access).

See `.planning/research/FEATURES.md` for full comparison table against Goldilocks, VPA, KRR, and Kubecost.

**Must have (table stakes):**
- Per-pod CPU and memory: p90 actual vs requested, with over/under-provisioned flags
- Recommended request values (p90 * configurable headroom multiplier; separate multipliers for CPU vs memory)
- Current replica count per workload
- Namespace-level summary: pod count, over-provisioned %, aggregate resource waste in resource units
- Configurable time window and percentile strategy (p90 default, configurable)
- Run metadata header (generated-at, time window, namespaces scoped)
- Static, self-contained HTML report (no server required, shareable via Slack/email)

**Should have (differentiators this tool owns):**
- HPA gap flagging — with low-confidence caveat in UI (Dynatrace HPA detection is unreliable; see pitfalls)
- Replica reduction recommendation — unique vs all competing tools; must respect HA minimum floor of 2
- Network bandwidth reporting (bytesRx/Tx) — not standard in right-sizing tools; low marginal cost since Dynatrace metric keys are in scope
- Configurable recommendation thresholds in config file (not hardcoded)
- Per-namespace efficiency ranking (sort namespaces by waste to help SREs prioritize)

**Defer to v2+:**
- Container-level granularity (sidecar breakdown) — v2 after core report is trusted
- Exportable JSON/CSV alongside HTML
- YAML/Helm patch generation for recommendations
- Historical run comparison / trending (requires architecture change — persistent storage)
- Multi-cluster aggregation
- Dollar cost estimation

**Hard anti-features (never build):**
- Auto-applying recommendations (kubectl apply) — destroys SRE trust
- Live dashboard / server mode — operational overhead incompatible with CLI scope
- Direct kubectl / Kubernetes API access — defeats the Dynatrace-only data source constraint

### Architecture Approach

The architecture follows the "thin CLI, fat services" pipeline pattern. The CLI entry point does only three things: parse argv, load config, and call the pipeline orchestrator. All logic lives in domain modules that are Dynatrace-agnostic below the Collector layer. This is the critical boundary: API Collectors translate raw Dynatrace responses into typed domain objects immediately; everything downstream (Correlator, Recommendation Engine, Report Renderer) never touches Dynatrace API shapes. Each component can be unit-tested with fixture data without a live Dynatrace connection.

See `.planning/research/ARCHITECTURE.md` for full component diagrams and data flow.

**Major components:**
1. **Config Loader** — reads YAML, validates with zod, merges `DYNATRACE_API_TOKEN` env var, freezes immutable config object
2. **Dynatrace API Client** — native fetch wrapper with auth header injection, exponential backoff on 429/5xx, cursor-based pagination abstraction, startup preflight scope validation
3. **Entities Collector** — queries `/api/v2/entities` for `CLOUD_APPLICATION` workloads per namespace; extracts desiredReplicas, cpuRequest, memRequest; outputs typed `WorkloadEntity[]`
4. **Metrics Collector** — queries `/api/v2/metrics/query` for CPU/memory/network p90 and replica count timeseries; outputs `MetricResult[]` keyed by entityId
5. **Data Correlator** — joins WorkloadEntity and MetricResult on entityId; assigns `dataQuality: FULL | PARTIAL | MISSING` per workload; outputs `EnrichedWorkload[]`
6. **Recommendation Engine** — pure functions on `EnrichedWorkload[]`; applies configurable thresholds; separate CPU and memory headroom multipliers; workload type gating (no replica recommendations for StatefulSets/DaemonSets); outputs `RecommendationSet` per namespace
7. **Report Renderer** — Handlebars template → single self-contained HTML file with vendored Chart.js; no external CDN references; streaming write to disk

### Critical Pitfalls

The full pitfall list (18 pitfalls) is in `.planning/research/PITFALLS.md`. The top 5 that can require rewrites or destroy SRE trust:

1. **Metric resolution mismatch (p90 statistically meaningless)** — The Dynatrace API silently uses coarse resolution (1h rollup) if `resolution` is not explicitly set. For bursty workloads, this understates CPU p90 by 20-60%. Fix: always set `resolution=1m` for windows up to 48h, `resolution=5m` for 7-day windows. Validate against a known bursty pod in Phase 1 before building recommendation logic.

2. **Entity selector returning wrong or empty pods** — Namespace name filter in entity selectors (`namespaceName("my-ns")`) may return 0 results or unfiltered results on some Managed installations due to entity indexing differences. Fix: before any recommendation logic, run a raw entity discovery and manually verify entity count matches expected pod count. Add `--discover-namespaces` CLI flag.

3. **Container vs pod metric granularity** — `builtin:containers.cpu.usagePercent` is emitted per container, not per pod. A pod with 3 containers (app + 2 sidecars) returns 3 separate time series. Naive aggregation inflates or distorts recommendations. Fix: decide container vs pod aggregation strategy in Phase 1; split by `container.name` dimension; flag pods with >2 containers for manual review.

4. **HPA detection via Dynatrace is unreliable** — HPAs are Kubernetes control-plane objects with limited Dynatrace entity model coverage. Confident "missing HPA" flags are likely to produce embarrassing false positives. Fix: report replica count stability metrics instead of asserting HPA absence; add `[CONFIDENCE: LOW — verify with kubectl]` caveat in report UI; support manual HPA list in config.

5. **Memory vs CPU have different right-sizing semantics** — Memory is non-compressible; setting memory request = p90 leaves no headroom for GC, JVM heap expansion, or in-memory cache warming, causing OOM kills. Fix: separate CPU (1.1x headroom) and memory (1.3x headroom minimum) multipliers; surface p99 memory alongside p90; detect JVM-based workloads and flag for manual review.

---

## Implications for Roadmap

The research strongly indicates a 5-phase build order driven by the API integration dependency chain. Phase 1 is the critical risk gate — the entire project's viability depends on validating Dynatrace API connectivity and data shape before building anything else. Do not skip or compress Phase 1.

### Phase 1: API Foundation and Validation

**Rationale:** API connectivity is the critical path gate for all other features (FEATURES.md explicitly calls this out). All 5 critical pitfalls and 6 of the moderate pitfalls are rooted in assumptions about how the Dynatrace API behaves on the actual Managed instance. These must be proven empirically before building recommendation logic on top of potentially-wrong assumptions.

**Delivers:**
- Config Loader with zod validation and `DYNATRACE_API_TOKEN` env var support
- Dynatrace API Client with auth, retry/backoff, pagination, and preflight scope validation
- Entity discovery validation: confirm namespace filter returns correct pod count
- Metric key availability probe: confirm all `builtin:containers.*` keys are available on the Managed instance
- Resolution validation: compare `resolution=1m` vs `resolution=1h` p90 values for a known bursty pod
- `--discover-namespaces` CLI flag for namespace name discovery
- Managed version logging at startup

**Addresses:** Config, auth, namespace filter, network metric availability probe
**Avoids Pitfalls:** Pitfalls 1, 2, 8, 9, 10, 11, 17, 18 (all Phase 1 risks)

**Research flag: NEEDS VALIDATION** — live Dynatrace Managed instance required; patterns from docs cannot be trusted without empirical verification.

---

### Phase 2: Data Collection Layer

**Rationale:** With API behavior validated, build the typed collection layer. Pagination must be implemented here as a first-class concern, not retrofitted later.

**Delivers:**
- Entities Collector: queries `CLOUD_APPLICATION` workloads per namespace with full pagination; outputs `WorkloadEntity[]`
- Metrics Collector: queries CPU/memory/network p90 and replica count timeseries with full pagination; outputs `MetricResult[]`
- Data Correlator: joins entity metadata with metric results on entityId; assigns `dataQuality` enum
- Workload type classification (DEPLOYMENT, STATEFUL_SET, DAEMON_SET, CRON_JOB, JOB) using Dynatrace `workloadType` property
- Batch/CronJob exclusion by default (`includeBatchWorkloads: false`)
- All data represented as Dynatrace-agnostic typed domain objects below the Collector boundary

**Addresses:** Per-pod CPU/memory actual data, replica count, network bandwidth data (if available)
**Avoids Pitfalls:** Pitfalls 3, 4, 11 (container granularity, batch job distortion, pagination)

**Research flag: STANDARD PATTERNS** — cursor-based pagination and typed domain objects are well-documented Node.js patterns.

---

### Phase 3: Recommendation Engine

**Rationale:** Pure computation layer on typed data — fully unit-testable with fixture data from Phase 2. No live API calls needed. The separate CPU vs memory headroom semantics and workload type gating logic must be built here before any output is generated.

**Delivers:**
- CPU right-sizing: p90 actual vs request, configurable headroom multiplier (default 1.1x), over/under-provisioned flags
- Memory right-sizing: p90 actual vs request, separate higher headroom multiplier (default 1.3x), p99 also surfaced
- Replica reduction recommendations: efficiency model, minimum floor of 2, StatefulSet/DaemonSet blocked
- HPA gap detection: replica stability analysis with LOW confidence caveat; support manual HPA list in config
- Namespace-level summary aggregation: waste in resource units (CPU cores, GB memory), efficiency %
- Configurable thresholds from config file (not hardcoded)
- `dataQuality: MISSING/PARTIAL` workloads skip recommendations, shown as "no metric data" in report

**Addresses:** All "must have" features from FEATURES.md and both high-value differentiators (replica reduction, HPA gap flagging)
**Avoids Pitfalls:** Pitfalls 5, 6, 7 (memory semantics, HA minimum, HPA reliability)

**Research flag: STANDARD PATTERNS** — recommendation logic is pure TypeScript computation; no external integration risk.

---

### Phase 4: Report Renderer

**Rationale:** Build the Handlebars template with hardcoded fixture data first, then wire to live Recommendation Engine output. Keeping report rendering decoupled from data collection allows parallel work and independent testing.

**Delivers:**
- Self-contained static HTML report: all CSS inline, Chart.js vendored (no CDN), no server required
- Namespace summary section: aggregate waste, efficiency ranking, pod counts, over/under-provisioned %
- Per-workload detail tables: CPU and memory cards with recommendation badges (separate visual treatment)
- HPA gap section with explicit LOW-confidence caveat and kubectl verification prompt
- Replica reduction section with HA floor disclaimer
- Network bandwidth section with graceful degradation banner if metric unavailable
- Report metadata header: generated-at (UTC), time window (UTC + local), namespaces scoped, Managed version
- Time window caveats for windows under 7 days
- Streaming write to disk (no full-string-in-memory for large datasets)

**Addresses:** Static HTML artifact, run metadata, shareable report, all display features
**Avoids Pitfalls:** Pitfalls 12, 13 (time window display, HTML memory exhaustion)

**Research flag: STANDARD PATTERNS** — Handlebars templating and static HTML generation are well-established; vendored Chart.js embedding should be prototyped early to validate offline functionality on bastion environments.

---

### Phase 5: CLI Integration and Polish

**Rationale:** Wire the full pipeline, add progress output (ora spinner), error handling for per-namespace fail-partial behavior, and final CLI flags. CLI entry point is built last when the pipeline is fully proven.

**Delivers:**
- Full CLI with commander: `--config`, `--start`, `--end`, `--output`, `--namespace`, `--discover-namespaces` flags
- Per-namespace fail-partial: one namespace error does not abort the run; namespace marked `ERROR` in report
- Progress output with ora spinner during API calls
- Clear error messages for token scope failures (list required scopes), namespace not found, config validation failures
- `config.example.yaml` with inline comments documenting all options
- Bundled single-file distributable via tsup (no `npm install` needed on target host)

**Addresses:** CLI usability, SRE-friendly error messages, distribution
**Avoids Pitfalls:** Pitfall 10, 18 (scope gap errors, namespace name mismatch)

**Research flag: STANDARD PATTERNS** — commander CLI patterns and tsup bundling are well-documented.

---

### Phase Ordering Rationale

- **API validation before data logic:** Pitfalls 1, 2, and 3 would corrupt all downstream recommendation logic if discovered late. Phase 1 is a deliberate risk-burn exercise before any feature work begins.
- **Collection before recommendation:** The Data Correlator's `dataQuality` enum and workload type classification are required inputs to the Recommendation Engine's gating logic.
- **Recommendation before rendering:** The Report Renderer is Dynatrace-agnostic; it consumes only the typed `RecommendationSet` output. Building the template against fixture data in Phase 4 while Phase 3 is in progress is feasible.
- **CLI last:** The thin CLI entry point is trivial to wire once the pipeline is proven. Building it first creates an integration testing burden before the core logic is stable.

---

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 1 (API Foundation):** Live Dynatrace Managed instance validation required for entity selector syntax, metric key availability, `resolution` behavior, and `workloadType` property names. Do not skip `/gsd:research-phase` for this phase — these are not guessable from documentation.
- **Phase 2 (Data Collection):** Entity-to-metric correlation strategy (Option A, B, or C per ARCHITECTURE.md) needs empirical testing; the `splitBy("dt.entity.cloud_application")` Option C reduces API call volume significantly if supported by the Managed version.

**Phases with standard patterns (skip research-phase):**
- **Phase 3 (Recommendation Engine):** Pure TypeScript computation, no external integration risk; standard testing patterns apply.
- **Phase 4 (Report Renderer):** Handlebars + Chart.js patterns are well-documented; prototype Chart.js vendoring early but no research phase needed.
- **Phase 5 (CLI):** commander + tsup patterns are definitively established; no research needed.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Commander, js-yaml, handlebars, vitest choices are HIGH confidence (established, stable). ESM module system, tsup bundling are MEDIUM (newer but well-adopted). Dynatrace SDK non-recommendation is MEDIUM (verify `@dynatrace-sdk` scope on npm before implementation). |
| Features | HIGH | Table stakes features are verified against 4 incumbent tools (Goldilocks, VPA, KRR, Kubecost). HPA gap and replica reduction as differentiators align directly with PROJECT.md requirements. |
| Architecture | HIGH (patterns) / MEDIUM (Dynatrace specifics) | Pipeline orchestrator pattern and component boundaries are HIGH confidence. Dynatrace entity type names (`CLOUD_APPLICATION`, `CLOUD_APPLICATION_NAMESPACE`, etc.), property names (`cpuRequest`, `desiredReplicas`), and relationship structure are MEDIUM — must be verified against live instance. |
| Pitfalls | HIGH (Kubernetes semantics) / MEDIUM (Dynatrace Managed) | Kubernetes right-sizing semantics (compressible/non-compressible, PDB, HPA, workload types) are HIGH confidence from stable Kubernetes API documentation. Dynatrace Managed-specific behaviors (resolution defaults, network metric availability, version lag) are MEDIUM — depend on specific installed version. |

**Overall confidence:** MEDIUM — the Node.js architecture and feature design are on solid ground; the project's primary risk is the Dynatrace Managed integration, which requires empirical validation and cannot be fully de-risked from documentation alone.

### Gaps to Address

- **Resource requests/limits availability via Entities API:** STACK.md flags this as the highest-risk assumption. If `cpuRequest`/`memoryRequest` are not available as entity properties on the Managed instance, the fallback strategy is SRE-provided request values in the config file. Validate in Phase 1 before designing the Recommendation Engine inputs.

- **HPA entity model in Dynatrace Managed:** PITFALLS.md and FEATURES.md both flag that HPA detection confidence is LOW. Inspect raw entity JSON for a known HPA-controlled deployment in Phase 1. If no HPA relationship fields exist, the feature must be scoped as "replica stability reporting" rather than "HPA detection."

- **Network metric granularity on Managed:** `builtin:containers.net.*` may not be available at pod level on all Managed installations (OneAgent network monitoring may be disabled). Probe in Phase 1; design graceful degradation path before Phase 2.

- **Dynatrace Managed version at target environment:** All research notes a 1-4 version lag between SaaS docs and on-prem Managed. The startup version log (Phase 1) should be compared against the API features used. Maintain a `MANAGED_COMPATIBILITY.md` tracking which features were tested on which version.

- **`splitBy` rollup on container metrics:** ARCHITECTURE.md recommends testing whether `builtin:containers.cpu.usagePercent` supports `splitBy("dt.entity.cloud_application")` for workload-level rollup. If supported, this eliminates the entity-to-metric join complexity and reduces API call volume by ~10x. Test in Phase 1.

---

## Sources

### Primary (HIGH confidence)
- `.planning/PROJECT.md` — project requirements, metric keys, Dynatrace environment context
- Kubernetes API documentation (training knowledge, stable) — workload types, PDB, HPA semantics, resource compressibility
- Node.js 20 LTS release notes (training knowledge) — native `fetch` availability, LTS status
- commander, js-yaml, handlebars, vitest documentation (training knowledge, long-established packages) — API patterns and version recommendations

### Secondary (MEDIUM confidence)
- Dynatrace v2 API documentation (training knowledge, August 2025 cutoff) — entity type names, metric keys, entity selector syntax, pagination pattern, token scopes
- Robusta KRR, Goldilocks feature comparison (training knowledge, tools stable since 2022-2024) — table stakes feature expectations
- Node.js ESM ecosystem community consensus (training knowledge, 2024-2025) — module system recommendation, tsup/tsx tooling

### Tertiary (LOW confidence — validate before use)
- Dynatrace Managed-specific behaviors: version lag, network metric availability, HPA entity model, `workloadType` property availability — all require verification against actual target Managed instance
- Rate limit specifics (50-100 req/min): LOW — varies by Managed version and license; test empirically
- `splitBy` rollup availability for container metrics: LOW — requires empirical testing against the target Managed instance

---
*Research completed: 2026-02-23*
*Ready for roadmap: yes*
