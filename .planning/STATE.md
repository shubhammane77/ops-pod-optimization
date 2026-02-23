# Project State: Ops Pod Optimization Tool

**Last updated:** 2026-02-23
**Updated by:** execute-phase (01-02 complete)

---

## Project Reference

**Core value:** Give SREs instant visibility into pod efficiency across all namespaces so they can confidently right-size deployments — without manually digging through Dynatrace.

**What this is:** A Node.js CLI tool that queries Dynatrace Managed v2 API to analyze Kubernetes pod efficiency and generates a shareable self-contained static HTML report with right-sizing recommendations.

**Current focus:** Phase 1 — Project Foundation

---

## Current Position

| Field | Value |
|-------|-------|
| Milestone | v1 |
| Current Phase | 1 — Project Foundation |
| Current Plan | Plan 02 complete — 01-02 config.example.yaml |
| Phase Status | In progress (2/2 plans complete) |
| Overall Progress | 0/9 phases complete |

```
Progress: [=         ] 5%
Phase:    1 of 9 (Phase 1 plans done — phase complete pending verification)
```

---

## Phase Checklist

| Phase | Name | Status |
|-------|------|--------|
| 1 | Project Foundation | In progress (01-01 + 01-02 complete) |
| 2 | Config Loader and Auth | Not started |
| 3 | API Client and Empirical Validation | Not started |
| 4 | Entities Collector | Not started |
| 5 | Metrics Collector | Not started |
| 6 | Data Correlator | Not started |
| 7 | Recommendation Engine | Not started |
| 8 | Report Renderer | Not started |
| 9 | CLI Integration and Distribution | Not started |

---

## Accumulated Context

### Key Decisions

| Decision | Rationale | Phase |
|----------|-----------|-------|
| Full config schema written in Phase 1 (all 13 fields) | Avoids CFG-05 rework in Phase 2+; config.example.yaml documents all fields from CFG-01 through CFG-04 including memoryHeadroomMultiplier minimum 1.30 invariant | 01-02 |
| Phase 3 is a risk-burn phase with no requirement IDs | API validation must precede all feature logic; entity selector syntax, metric key names, and resolution behavior are unverified on this Managed instance | Project init |
| Phases 3 and 6 are infrastructure phases | Data Correlator (Phase 6) and API validation (Phase 3) are prerequisites for downstream features but have no user-visible output of their own | Project init |
| CPU-01 and MEM-01 assigned to Phase 8 | First user-observable behavior (comparison against requests in the report) is in Phase 8; collection in Phase 5 is infrastructure | Project init |
| CFG-03 and RPT-05 assigned to Phase 9 | Full observable behavior (--window and --filter flags on a real pipeline run) only verifiable once CLI is wired | Project init |
| Comprehensive depth — 9 phases | 27 requirements with complex API integration dependency chain; natural delivery boundaries produce 9 phases at comprehensive depth | Project init |

### Architecture Decisions

| Component | Decision | Rationale |
|-----------|----------|-----------|
| Module system | ESM (type: module, NodeNext) | 2024-2025 ecosystem direction; required for ora v8, chalk v5 |
| HTTP client | Native fetch (Node 20 built-in) | Zero dependency; escape hatch to undici for self-signed certs |
| Config parsing | js-yaml + zod | YAML for SRE comments; zod for runtime shape validation |
| Report templating | Handlebars | Logic-less templates, auto-escaping, decoupled from domain logic |
| Charts | Chart.js v4 (vendored inline) | Offline/air-gapped bastion — no CDN references |
| CLI parsing | commander v12 | Simplest mature option for single-command tool |
| Build | tsup | Single-file distributable; no npm install on target host |
| Testing | vitest | ESM-native, TypeScript-first |

### Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Entity selector returning wrong/empty pods on this Managed version | HIGH | Phase 3 empirical validation is mandatory; build --discover-namespaces flag |
| Metric resolution defaulting to 1h rollup (silent) | HIGH | Always set resolution=1m explicitly; validate against known bursty pod in Phase 3 |
| cpuRequest/memoryRequest not available as entity properties | HIGH | Phase 3 validation; fallback strategy: SRE-provided request values in config |
| splitBy aggregation for container metrics not supported | MEDIUM | Phase 3 test; fallback: manual per-container series aggregation |
| Network metric keys unavailable on this Managed installation | MEDIUM | Phase 5 graceful degradation; Phase 8 N/A display |
| HPA detection unreliable via Dynatrace entity model | LOW (out of scope) | HPA flagging removed from v1 scope; show replica stability instead |

### Todos

- Run `/gsd:plan-phase 1` to generate the Phase 1 execution plan
- Phase 3 requires `/gsd:research-phase 3` before planning — live Dynatrace Managed instance required
- Create `MANAGED_COMPATIBILITY.md` during Phase 3 to track which API behaviors were validated on which Managed version

### Blockers

None currently.

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Requirements defined | 27 |
| Requirements mapped | 27 |
| Requirements completed | 1 (CFG-05) |
| Phases defined | 9 |
| Phases started | 1 |
| Phases completed | 0 |

---

## Session Continuity

**How to resume:** Read this file, then read `.planning/ROADMAP.md` for phase structure. Phase 1 plans 01 and 02 are complete. Phase 1 is now done (both plans finished). Run `/gsd:plan-phase 2` to begin Phase 2: Config Loader and Auth.

**Last session:** 2026-02-23T19:46:47Z
**Stopped at:** Completed 01-02-PLAN.md (config.example.yaml)

**Context a new session needs:**
- This is a Dynatrace-backed Kubernetes right-sizing CLI tool
- Phase 3 (API validation) is the critical risk gate — must not be skipped or compressed
- Two infrastructure phases (3 and 6) have no v1 requirement IDs but are required for all downstream work
- The tool targets on-prem Dynatrace Managed (not SaaS) — version lag is a real concern
- All reports must embed CSS/JS inline (offline air-gapped bastion use case)
- Memory headroom minimum is 30% (MEM-03 constraint); CPU default is 10%
- StatefulSets and DaemonSets must be excluded from replica reduction recommendations (ANAL-02 constraint)
- Container metrics (`builtin:containers.*`) are per-container, not per-pod — must aggregate to workload level

---
*State initialized: 2026-02-23*
