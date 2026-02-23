# Requirements: Ops Pod Optimization Tool

**Defined:** 2026-02-23
**Core Value:** Give SREs instant visibility into pod efficiency across all namespaces so they can confidently right-size deployments — without manually digging through Dynatrace.

## v1 Requirements

### Metrics — CPU

- [ ] **CPU-01**: User can view p90 CPU usage per pod compared against the pod's CPU request
- [ ] **CPU-02**: User can see each pod flagged as over-provisioned (p90 usage < threshold) or under-provisioned (p90 usage > threshold)
- [ ] **CPU-03**: User can see a concrete recommended CPU request value per pod (p90 * configurable headroom multiplier)
- [ ] **CPU-04**: User can view aggregate CPU waste per namespace (sum of request minus p90 actual across all pods, in CPU cores)

### Metrics — Memory

- [ ] **MEM-01**: User can view p90 memory usage per pod compared against the pod's memory request
- [ ] **MEM-02**: User can see each pod flagged as over-provisioned or under-provisioned for memory
- [ ] **MEM-03**: User can see a concrete recommended memory request value per pod (p90 * configurable headroom multiplier, minimum 30% headroom)
- [ ] **MEM-04**: User can view aggregate memory waste per namespace (in GB)

### Metrics — Network

- [ ] **NET-01**: User can view inbound network bandwidth (Rx bytes) per pod
- [ ] **NET-02**: User can view outbound network bandwidth (Tx bytes) per pod
- [ ] **NET-03**: User can view application-level throughput (requests per second/minute) per workload via Dynatrace service monitoring

### Analysis

- [ ] **ANAL-01**: Tool classifies each workload by type (Deployment, StatefulSet, DaemonSet, CronJob/Job) and gates replica reduction recommendations appropriately
- [ ] **ANAL-02**: User can see a replica reduction recommendation per workload — "current: 10 replicas, p90 load supports: 4 replicas" (Deployments only; StatefulSets, DaemonSets, CronJobs excluded)
- [ ] **ANAL-03**: User can see concrete resource right-sizing targets per workload (recommended CPU request, recommended memory request)
- [ ] **ANAL-04**: User can see total resource waste estimate per namespace in resource units (CPU cores wasted, GB memory wasted)

### Report

- [ ] **RPT-01**: Tool generates a self-contained static HTML report file — embeds all CSS and JS inline, works offline with no CDN dependencies
- [ ] **RPT-02**: Report includes a namespace-level summary section: pod count, % over-provisioned, % under-provisioned, total CPU/memory waste
- [ ] **RPT-03**: Report ranks namespaces by total resource waste so SREs can prioritize which namespace to address first
- [ ] **RPT-04**: Report includes a run metadata header: generated-at timestamp (UTC), time window analyzed, namespaces scoped, percentile and headroom settings used
- [ ] **RPT-05**: User can filter the report to show only over-provisioned / low-utilization pods via a CLI flag (`--filter low-utilization`) and an in-HTML toggle button
- [ ] **RPT-06**: Report degrades gracefully when a metric is unavailable (e.g. network data not available for a pod) — shows "N/A" rather than failing the run

### Configuration & Auth

- [ ] **CFG-01**: User configures the tool via a YAML or JSON config file specifying: Dynatrace API endpoint, namespace list, default time window, percentile, and headroom multiplier
- [ ] **CFG-02**: User can override the API token via `DYNATRACE_API_TOKEN` environment variable (takes precedence over config file token field)
- [ ] **CFG-03**: User can override the analysis time window at run time via `--window` CLI flag (e.g. `--window 7d`, `--window 30d`)
- [ ] **CFG-04**: User can configure the baseline percentile (default: 90) and CPU/memory headroom multipliers independently in the config file
- [ ] **CFG-05**: Repository includes a sample annotated config file (`config.example.yaml`) documenting all fields with defaults and valid values

### Developer Experience

- [ ] **DEV-01**: Repository includes sample fixture data representing a realistic Dynatrace API response for local development and testing without a live Dynatrace connection

## v2 Requirements

### Reliability Signals

- **REL-01**: User can see how many times each pod has been restarted due to OOMKill over the analysis window
- **REL-02**: Pods with OOMKill restarts are flagged as under-provisioned regardless of p90 memory utilization

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dollar cost calculations | No billing API on on-prem; resource-unit waste is equally actionable |
| Auto-applying recommendations | SRE trust requires human review; changes to production must be deliberate |
| Direct kubectl / Kubernetes API access | Dynatrace is sole data source; avoids additional RBAC setup |
| HPA gap flagging | LOW confidence — Dynatrace Managed entity model for HPAs is unverified; SREs verify manually with kubectl |
| Multi-cluster aggregation | One Dynatrace endpoint per run; SREs run separately per cluster |
| Live dashboard / server mode | Static HTML per run; no persistent infrastructure on on-prem |
| Slack / PagerDuty / email integration | Reporting tool, not alerting tool; SRE shares report out-of-band |
| Container-level granularity (sidecar breakdown) | Deferred to v2 after core report is validated |
| Historical run comparison / trending | Requires persistent storage — architecture change |
| YAML/Helm patch generation | Useful but out of v1 scope |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CPU-01 | Phase 8 | Pending |
| CPU-02 | Phase 7 | Pending |
| CPU-03 | Phase 7 | Pending |
| CPU-04 | Phase 7 | Pending |
| MEM-01 | Phase 8 | Pending |
| MEM-02 | Phase 7 | Pending |
| MEM-03 | Phase 7 | Pending |
| MEM-04 | Phase 7 | Pending |
| NET-01 | Phase 5 | Pending |
| NET-02 | Phase 5 | Pending |
| NET-03 | Phase 8 | Pending |
| ANAL-01 | Phase 4 | Pending |
| ANAL-02 | Phase 7 | Pending |
| ANAL-03 | Phase 7 | Pending |
| ANAL-04 | Phase 7 | Pending |
| RPT-01 | Phase 8 | Pending |
| RPT-02 | Phase 8 | Pending |
| RPT-03 | Phase 8 | Pending |
| RPT-04 | Phase 8 | Pending |
| RPT-05 | Phase 9 | Pending |
| RPT-06 | Phase 8 | Pending |
| CFG-01 | Phase 2 | Pending |
| CFG-02 | Phase 2 | Pending |
| CFG-03 | Phase 9 | Pending |
| CFG-04 | Phase 2 | Pending |
| CFG-05 | Phase 1 | Pending |
| DEV-01 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-02-23*
*Last updated: 2026-02-23 after roadmap creation — traceability complete*
