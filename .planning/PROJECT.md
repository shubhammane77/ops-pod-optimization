# Ops Pod Optimization Tool

## What This Is

A Node.js CLI tool for SRE teams that queries a Dynatrace Managed instance (v2 API) to analyze Kubernetes pod efficiency across specified namespaces. It compares p90 actual resource usage (CPU, memory, network bandwidth) against current resource requests and replica counts — then generates a shareable static HTML report with right-sizing recommendations.

## Core Value

Give SREs instant visibility into pod efficiency across all namespaces so they can confidently right-size deployments and flag autoscaling gaps — without manually digging through Dynatrace.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Connect to Dynatrace Managed v2 API using API token (config file or env var)
- [ ] Load namespace list and run configuration from YAML/JSON config file
- [ ] Query p90 CPU, memory, and network bandwidth metrics per pod per namespace via Dynatrace v2 Metrics API
- [ ] Query current replica counts and deployment state via Dynatrace Kubernetes monitoring
- [ ] Compare p90 actual usage vs configured resource requests/limits
- [ ] Generate static HTML report per run with namespace-level summaries and per-pod detail
- [ ] Recommend replica count reduction for over-provisioned deployments
- [ ] Recommend CPU/memory resource request right-sizing per workload
- [ ] Flag deployments missing HPA configuration that would benefit from autoscaling
- [ ] Support configurable time window per run (SRE selects at analysis time)
- [ ] CLI entry point — SRE runs the tool, specifies config and optional flags

### Out of Scope

- Auto-applying changes — recommendations only, SRE acts manually
- Real-time dashboard — static HTML per run, not a live server
- Direct kubectl / Kubernetes API integration — Dynatrace is the sole data source
- Dollar cost calculations — no billing API integration in v1
- Cross-namespace comparison views — per-namespace analysis is the unit

## Context

- **Dynatrace Managed (on-prem):** v2 API, accessible via API endpoint. OneAgent is deployed in Kubernetes clusters so Dynatrace has full pod, deployment, and resource metric visibility.
- **Kubernetes data via Dynatrace:** Replica counts, deployment state, resource requests/limits, and metrics are all sourced from Dynatrace Kubernetes monitoring — no direct cluster API access needed.
- **Key Dynatrace v2 APIs:**
  - `GET /api/v2/metrics/query` — CPU, memory, network bandwidth at p90
  - `GET /api/v2/entities` — Kubernetes workload metadata (replicas, resource requests)
  - Relevant metric keys: `builtin:containers.cpu.usagePercent`, `builtin:containers.memory.residentMemoryBytes`, `builtin:containers.net.bytesRx`, `builtin:containers.net.bytesTx`, `builtin:kubernetes.workload.pods`
- **Pain being solved:** SREs currently have no consolidated view of pod efficiency across namespaces — discovery requires manually navigating Dynatrace UI per namespace.

## Constraints

- **Tech stack:** Node.js — chosen for HTML report generation and alignment with existing tooling
- **Data source:** Dynatrace Managed v2 API only — avoids needing additional cluster RBAC/credentials
- **On-prem deployment:** Tool runs locally on SRE machine or bastion; no cloud dependencies
- **Auth:** API token via `DYNATRACE_API_TOKEN` env var or config file field — no OAuth complexity for v1

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dynatrace v2 API only (not kubectl) | Avoids additional cluster access setup; OneAgent already provides full k8s state | — Pending |
| p90 as baseline percentile | Tolerates occasional spikes without over-provisioning; standard SRE practice | — Pending |
| Static HTML output | Shareable and archivable without running a server; appropriate for on-demand SRE use | — Pending |
| Config file (YAML/JSON) for namespace list | Reusable across runs; version-controllable alongside infrastructure config | — Pending |

---
*Last updated: 2026-02-23 after initialization*
