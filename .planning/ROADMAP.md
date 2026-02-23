# Roadmap: Ops Pod Optimization Tool

**Milestone:** v1
**Depth:** Comprehensive
**Created:** 2026-02-23
**Phases:** 9
**Coverage:** 27/27 v1 requirements

## Overview

A Node.js CLI tool that queries a Dynatrace Managed v2 API to analyze Kubernetes pod efficiency across specified namespaces and produces a shareable, self-contained static HTML report with right-sizing recommendations. The build follows a strict pipeline dependency order: API behavior must be empirically validated before collection logic is built, collection must be typed before recommendation logic is built, and recommendation output must be stable before the report renderer is wired. Phase 1 is the critical risk gate — the entire project's viability depends on empirical Dynatrace API validation before any feature logic is written.

---

## Phases

---

### Phase 1: Project Foundation

**Goal:** The development environment is fully operational and every future phase can be built, run, and tested without environment setup friction.

**Dependencies:** None — this is the starting point.

**Requirements:** CFG-05, DEV-01

**Plans:** 3 plans

Plans:
- [ ] 01-01-PLAN.md — ESM TypeScript toolchain setup (package.json, tsconfig, tsup, vitest, src/index.ts, smoke test)
- [ ] 01-02-PLAN.md — config.example.yaml with full annotated schema (CFG-05)
- [ ] 01-03-PLAN.md — fixtures/ directory with realistic Dynatrace API JSON responses (DEV-01)

**Success Criteria:**

1. Developer can run `npm run build` from a fresh clone and produce a runnable CLI binary with zero manual steps.
2. Developer can run `npm test` and all tests execute in a TypeScript-native ESM environment using vitest.
3. A `config.example.yaml` file exists in the repository with inline comments documenting every config field and valid values.
4. A `fixtures/` directory exists with sample Dynatrace API JSON responses (entities and metrics) that represent a realistic multi-namespace cluster response.
5. Developer can import any module from the project in a test file without import resolution errors.

---

### Phase 2: Config Loader and Auth

**Goal:** The tool can load, validate, and merge all configuration from file and environment before making any API call.

**Dependencies:** Phase 1 (project must compile).

**Requirements:** CFG-01, CFG-02, CFG-03, CFG-04

**Success Criteria:**

1. Running the CLI with a valid `config.yaml` loads the config without errors and prints the resolved values in debug mode.
2. Setting `DYNATRACE_API_TOKEN` env var overrides the token field in the config file — the env var value is used.
3. Passing `--window 7d` at runtime overrides the config file's default time window — the flag value is used.
4. Config validation fails with a clear error message (listing the invalid field and expected type) when required fields are missing or have wrong types.
5. CPU headroom multiplier and memory headroom multiplier can be set independently in the config file; both default to defined values when absent.

---

### Phase 3: API Client and Empirical Validation

**Goal:** The Dynatrace API client is proven to work against the actual Managed instance — entity selectors return correct pods, metric keys are available, resolution behavior is understood, and container-level metric aggregation strategy is decided.

**Dependencies:** Phase 2 (config must be loadable to get endpoint and token).

**Requirements:** (No direct v1 requirement owns this phase — it is the risk-burn phase that de-risks all downstream phases. The risk gate is implicit in all data-dependent requirements.)

**Note:** This phase has no v1 requirement IDs because the risk-burn validation work is foundational infrastructure. The requirements it protects are CPU-01 through NET-03, ANAL-01 through ANAL-04 — all of which are built on top of the assumptions validated here. Skipping this phase means building recommendation logic on top of unverified assumptions about entity selector syntax, metric key availability, resolution behavior, and container vs pod granularity on this specific Managed version.

**Success Criteria:**

1. Running `--discover-namespaces` against the live Dynatrace instance returns a list of known namespace names — the developer can verify the count matches what is visible in the Dynatrace UI.
2. A raw entity query for a known namespace returns workloads whose count matches the developer's expectation; the `workloadType` property is present and contains DEPLOYMENT / STATEFUL_SET / DAEMON_SET values.
3. A raw metrics query with `resolution=1m` returns per-minute data points (not 1h rollups); the developer can confirm this by comparing the number of returned data points to the expected window size.
4. The container-to-workload aggregation strategy is confirmed: whether `splitBy("dt.entity.cloud_application")` collapses container time series to workload level, or whether manual per-container series aggregation is required — this is documented in a `MANAGED_COMPATIBILITY.md` file.
5. The `cpuRequest` and `memoryRequest` entity properties are present (or absent) on the Managed instance, with a documented fallback strategy if absent.

---

### Phase 4: Entities Collector

**Goal:** The tool can retrieve all workload entities for every configured namespace, paginate through results, classify workload types, and output a typed `WorkloadEntity[]` with no raw Dynatrace shapes leaking downstream.

**Dependencies:** Phase 3 (entity selector syntax and property names validated).

**Requirements:** ANAL-01

**Success Criteria:**

1. Running the collector against a namespace with more than 50 workloads returns all workloads — pagination is verified by comparing total count to Dynatrace UI.
2. Each returned `WorkloadEntity` contains: entity ID, workload name, namespace, workload type (DEPLOYMENT / STATEFUL_SET / DAEMON_SET / CRON_JOB / JOB), desired replica count, CPU request, and memory request.
3. Workload type is classified as one of the five defined types with no "unknown" values for standard Kubernetes workloads visible in Dynatrace UI.
4. A namespace that returns zero entities does not crash the collector — it returns an empty array with a log warning.

---

### Phase 5: Metrics Collector

**Goal:** The tool can retrieve p90 CPU usage, p90 memory usage, inbound network bandwidth, outbound network bandwidth, and replica count timeseries for all collected workloads — with full pagination and correct aggregation from container-level to workload-level.

**Dependencies:** Phase 4 (workload entity IDs needed to scope metric queries; Phase 3 aggregation strategy confirmed).

**Requirements:** CPU-01, MEM-01, NET-01, NET-02

**Success Criteria:**

1. For a known workload, the returned p90 CPU usage (in millicores or usage percent) matches the value visible in the Dynatrace UI for the same entity and time window — within expected rounding tolerance.
2. For a known workload with multiple containers, the returned metric value is a single aggregated number per time window, not a per-container array.
3. Network Rx and Tx bytes per workload are returned when OneAgent network monitoring is available; when unavailable, the collector returns `null` for those fields rather than throwing.
4. Pagination for metrics queries handles windows that produce more than 1000 data points — all pages are fetched and merged before p90 is calculated.
5. All metric results are keyed by entity ID and use domain types — no raw Dynatrace JSON shapes appear outside the Metrics Collector module.

---

### Phase 6: Data Correlator

**Goal:** Entity metadata and metric results are joined on entity ID into a single `EnrichedWorkload[]` structure, with each workload assigned a `dataQuality` classification that gates downstream recommendation logic.

**Dependencies:** Phase 4 (entities), Phase 5 (metrics).

**Requirements:** (No unique requirement ID — this is the join layer between collection and recommendation. It is required infrastructure for ANAL-02, ANAL-03, ANAL-04, and all metric comparison requirements.)

**Note:** Like Phase 3, the Data Correlator is foundational infrastructure. The requirements it enables are: CPU-01/02/03/04, MEM-01/02/03/04, NET-01/02, ANAL-02, ANAL-03, ANAL-04. These requirements are assigned to the phases where their outputs are first observable to the user — the Correlator's join logic is a prerequisite, not a user-visible feature in its own right.

**Success Criteria:**

1. Every workload returned by the Entities Collector appears in the `EnrichedWorkload[]` output — no silently dropped workloads.
2. A workload with full metric data (CPU, memory, network) is assigned `dataQuality: FULL`.
3. A workload with partial metric data (e.g., network unavailable) is assigned `dataQuality: PARTIAL` — it still appears in the output with available metric fields populated and unavailable fields null.
4. A workload with no metric data at all is assigned `dataQuality: MISSING` — it appears in the output with a flag indicating no recommendations can be generated.
5. The join operation produces the same result whether run against fixture data or live API data — verifiable by running both modes against the same workload set.

---

### Phase 7: Recommendation Engine

**Goal:** The tool can compute concrete CPU and memory right-sizing recommendations, replica reduction recommendations, and namespace-level waste aggregations — with workload type gating, separate headroom multipliers, and configurable thresholds.

**Dependencies:** Phase 6 (enriched workloads with data quality).

**Requirements:** CPU-02, CPU-03, CPU-04, MEM-02, MEM-03, MEM-04, ANAL-02, ANAL-03, ANAL-04

**Success Criteria:**

1. A Deployment with p90 CPU usage below the over-provisioning threshold is flagged as over-provisioned, and the recommended CPU request equals `p90_cpu * cpu_headroom_multiplier` rounded to the nearest 10m.
2. A StatefulSet and a DaemonSet do not receive replica reduction recommendations — their replica count field shows "not applicable" rather than a number.
3. A Deployment with p90 load supporting fewer than current replicas receives a replica reduction recommendation showing "current: N replicas, p90 load supports: M replicas" — where M is never less than 2 (HA floor).
4. The recommended memory request equals `p90_memory * memory_headroom_multiplier` with the multiplier floored at 1.30 — even if the user sets a lower value in config, the 30% minimum is enforced.
5. Namespace-level CPU waste is reported as the sum of (requested CPU - p90 CPU) across all FULL-quality workloads in that namespace, expressed in CPU cores.
6. Namespace-level memory waste is reported in GB.
7. A workload with `dataQuality: MISSING` produces no recommendation — it is present in the output as "no metric data" rather than absent.

---

### Phase 8: Report Renderer

**Goal:** The tool generates a self-contained, offline-capable static HTML report that presents all recommendations, namespace summaries, run metadata, and network bandwidth data — with graceful degradation when metrics are unavailable.

**Dependencies:** Phase 7 (recommendation set), Phase 5 (network data available), Phase 2 (time window and config metadata).

**Requirements:** RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06, NET-03, CPU-01, MEM-01

**Success Criteria:**

1. Opening the generated `.html` file on an air-gapped machine with no internet access renders correctly — all styles load, bar charts render, no CDN errors in browser console.
2. The report's namespace summary section shows pod count, percentage over-provisioned, percentage under-provisioned, and total CPU/memory waste for each namespace.
3. Namespaces are ranked by total resource waste — the namespace with the highest aggregate waste appears first.
4. The report header displays: generated-at timestamp (UTC), analysis time window, namespaces scoped, percentile used, and headroom multiplier values.
5. Clicking the "Show only low-utilization pods" toggle button in the report hides all non-over-provisioned rows — the filter is reversible without reloading the page.
6. A pod with unavailable network data shows "N/A" in the network column instead of an error or blank cell; a banner explains which namespaces have partial network data.
7. Service-level throughput data (requests per second/minute) is shown per workload where Dynatrace service monitoring data is available, with "N/A" for workloads without service entity linkage.

---

### Phase 9: CLI Integration and Distribution

**Goal:** The full pipeline is wired under a single CLI entry point, errors are handled gracefully per namespace, progress is visible during long API calls, and the tool is distributable as a single bundled file that needs no `npm install` on the target machine.

**Dependencies:** Phase 8 (full pipeline complete).

**Requirements:** CFG-03 (runtime window override wired to CLI flag), RPT-05 (CLI filter flag wired to report), NET-01, NET-02 (network CLI behavior), DEV-01 (fixture mode)

**Note:** CFG-03 is first exercisable in Phase 2 (config loading), but its full observable behavior — passing `--window` to an actual analysis run and seeing the correct time window used — is only verifiable once the pipeline is wired in Phase 9. RPT-05's `--filter low-utilization` CLI flag similarly requires a running pipeline to observe. DEV-01 fixture data was created in Phase 1 but the `--fixture` CLI flag that activates fixture mode is wired here.

**Success Criteria:**

1. Running `npx ops-pod-opt --config config.yaml` on a machine where Node.js is installed but `npm install` has not been run completes successfully — the single bundled file includes all dependencies.
2. When one namespace returns an API error during a multi-namespace run, the other namespaces complete successfully and the failed namespace appears in the report with an "ERROR" badge — the run exit code is non-zero.
3. Running with `--filter low-utilization` generates a report where only over-provisioned pods are shown by default; the in-HTML toggle works independently of the CLI flag.
4. Progress output shows a spinner with the current operation (e.g., "Fetching entities for namespace: production") during API calls — the terminal is not silent during a long run.
5. An invalid API token produces an error message listing the required Dynatrace token scopes, not a raw HTTP 401 response.

---

## Progress

| Phase | Goal | Requirements | Status |
|-------|------|--------------|--------|
| 1 - Project Foundation | Dev environment operational, toolchain compiles, fixtures exist | CFG-05, DEV-01 | Pending |
| 2 - Config Loader and Auth | Config loads and validates, token precedence correct, CLI overrides work | CFG-01, CFG-02, CFG-03, CFG-04 | Pending |
| 3 - API Client and Empirical Validation | Dynatrace API behavior proven on actual Managed instance | (risk-burn — no req IDs) | Pending |
| 4 - Entities Collector | All workloads retrieved, typed, paginated, workload type classified | ANAL-01 | Pending |
| 5 - Metrics Collector | p90 CPU/memory/network collected, container-aggregated, paginated | CPU-01, MEM-01, NET-01, NET-02 | Pending |
| 6 - Data Correlator | Entity-metric join complete, dataQuality assigned to every workload | (join layer — no req IDs) | Pending |
| 7 - Recommendation Engine | Right-sizing and replica recommendations computed with correct gating | CPU-02, CPU-03, CPU-04, MEM-02, MEM-03, MEM-04, ANAL-02, ANAL-03, ANAL-04 | Pending |
| 8 - Report Renderer | Self-contained offline HTML with all sections, ranking, filter, graceful degradation | RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06, NET-03, CPU-01, MEM-01 | Pending |
| 9 - CLI Integration and Distribution | Full pipeline wired, per-namespace error handling, single-file bundle | CFG-03, RPT-05, DEV-01 | Pending |

---

## Requirement Coverage

| Requirement ID | Phase | Category |
|----------------|-------|----------|
| CFG-01 | Phase 2 | Config |
| CFG-02 | Phase 2 | Config |
| CFG-03 | Phase 2 / Phase 9 | Config |
| CFG-04 | Phase 2 | Config |
| CFG-05 | Phase 1 | Config |
| DEV-01 | Phase 1 / Phase 9 | Developer Experience |
| CPU-01 | Phase 5 / Phase 8 | Metrics |
| CPU-02 | Phase 7 | Metrics |
| CPU-03 | Phase 7 | Metrics |
| CPU-04 | Phase 7 | Metrics |
| MEM-01 | Phase 5 / Phase 8 | Metrics |
| MEM-02 | Phase 7 | Metrics |
| MEM-03 | Phase 7 | Metrics |
| MEM-04 | Phase 7 | Metrics |
| NET-01 | Phase 5 | Metrics |
| NET-02 | Phase 5 | Metrics |
| NET-03 | Phase 8 | Metrics |
| ANAL-01 | Phase 4 | Analysis |
| ANAL-02 | Phase 7 | Analysis |
| ANAL-03 | Phase 7 | Analysis |
| ANAL-04 | Phase 7 | Analysis |
| RPT-01 | Phase 8 | Report |
| RPT-02 | Phase 8 | Report |
| RPT-03 | Phase 8 | Report |
| RPT-04 | Phase 8 | Report |
| RPT-05 | Phase 8 / Phase 9 | Report |
| RPT-06 | Phase 8 | Report |

**Coverage: 27/27 v1 requirements mapped.**

Note on shared requirements: CPU-01 and MEM-01 are first collected in Phase 5 (user can observe raw metric values) and first compared against requests in Phase 8 (user sees the comparison in the report). The requirement is assigned to Phase 8 where its user-visible behavior is delivered. CFG-03 and RPT-05 have partial behavior in earlier phases but full observable behavior only in Phase 9 — they are assigned to both phases in the table for traceability but owned by Phase 9 for coverage counting.

---

## Phase Dependencies

```
Phase 1 (Foundation)
  └── Phase 2 (Config + Auth)
        └── Phase 3 (API Validation) [risk gate]
              └── Phase 4 (Entities Collector)
              └── Phase 5 (Metrics Collector)
                    └── Phase 6 (Data Correlator) [requires Phase 4 + Phase 5]
                          └── Phase 7 (Recommendation Engine)
                                └── Phase 8 (Report Renderer)
                                      └── Phase 9 (CLI Integration)
```

---

## Research Flags

| Phase | Flag | Reason |
|-------|------|--------|
| Phase 3 | NEEDS LIVE VALIDATION | Entity selector syntax, metric key availability, resolution behavior, workloadType property names cannot be verified without the actual Managed instance. Do not skip `/gsd:research-phase` for Phase 3. |
| Phase 4 | VALIDATE DURING PHASE 3 | Entity-to-metric correlation strategy (splitBy option) must be decided during Phase 3 empirical work before Phase 4 collection logic is built. |
| All others | STANDARD PATTERNS | Node.js, TypeScript, Handlebars, commander, vitest patterns are well-established. |

---
*Roadmap created: 2026-02-23*
*Next: `/gsd:plan-phase 1`*
