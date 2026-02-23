# Feature Landscape

**Domain:** Kubernetes pod resource optimization / right-sizing reporting tool (SRE-focused)
**Researched:** 2026-02-23
**Confidence note:** Web research tools unavailable in this session. Findings draw from training knowledge of Goldilocks, Kubernetes VPA, Robusta KRR, and Kubecost (all well-established tools, stable since 2022-2024). Marked LOW confidence where post-2025 changes could affect conclusions.

---

## Existing Tool Comparison

Understanding what incumbents offer clarifies what SREs already know to expect.

### Goldilocks (Fairwinds)
**What it does:** Deploys VPA in recommendation mode per namespace. Provides a web dashboard showing current requests vs VPA-recommended requests.
**Key features:**
- Per-namespace dashboard with workload list
- Shows VPA `lowerBound`, `target`, `upperBound` for CPU and memory
- QoS class display (Guaranteed/Burstable/BestEffort)
- Namespace-level filtering and toggle
- Does NOT analyze replicas or HPA gaps
- Requires VPA CRDs installed in cluster

**Gap relevant to this project:** Goldilocks requires in-cluster VPA installation. It also requires direct cluster access. This project uses Dynatrace as the data source, which is a key differentiator for on-prem environments where SREs may not have easy in-cluster tooling access.

### Kubernetes VPA (Vertical Pod Autoscaler)
**What it does:** Native Kubernetes controller that continuously observes pod resource usage and can auto-apply or recommend CPU/memory adjustments.
**Key features:**
- `UpdateMode: Off` (recommendation only), `Initial`, `Auto`
- Provides `lowerBound`, `target`, `upperBound` based on historical usage
- Integrates with Kubernetes admission controllers
- Does NOT handle HPA compatibility warnings well (VPA + HPA on CPU is problematic)

**Gap relevant to this project:** VPA requires cluster-level installation and direct API access. It also mutates pods on restart, which many SRE teams on on-prem clusters are hesitant to enable in Auto mode.

### Robusta KRR (Kubernetes Resource Recommender)
**What it does:** CLI tool that queries Prometheus for historical metrics and generates right-sizing recommendations.
**Key features:**
- Queries Prometheus/VictoriaMetrics for real usage data (configurable time range)
- Supports multiple strategies: `simple` (p99), `percentile`
- Outputs: table (terminal), JSON, CSV, Slack/PagerDuty alerts
- Shows current vs recommended CPU/memory requests and limits
- Calculates "waste" (how much is over-provisioned)
- HPA-aware: detects if HPA exists and adjusts recommendations
- Namespace filtering
- Workload-level and container-level granularity
- Does NOT generate HTML reports
- Requires Prometheus in-cluster

**Gap relevant to this project:** KRR requires Prometheus. This project uses Dynatrace, which is the equivalent for on-prem OneAgent environments. KRR's feature set is the closest analogue and its output structure is what SREs on modern k8s teams have come to expect.

### Kubecost
**What it does:** Full cost allocation and optimization platform for Kubernetes.
**Key features:**
- Cost breakdown by namespace, workload, label
- Right-sizing recommendations with dollar-cost savings estimates
- Efficiency scores
- Savings opportunities dashboard
- Multi-cluster support
- Requires its own Prometheus stack or integration

**Gap relevant to this project:** Kubecost is a heavyweight platform requiring persistent infrastructure. This project's constraint is a CLI that runs on-demand. Kubecost's cost modeling features are explicitly out of scope for v1.

---

## Table Stakes

Features users expect. Missing = SREs won't trust the tool or will feel it's incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-pod CPU actual vs requested | Core metric in every right-sizing tool; SREs open expecting this | Low | p90 from Dynatrace `builtin:containers.cpu.usagePercent` |
| Per-pod memory actual vs requested | Same as CPU — equally expected | Low | p90 from Dynatrace `builtin:containers.memory.residentMemoryBytes` |
| Over-provisioned flag | Without a clear signal (red/yellow/green), the report is just raw data | Low | Ratio: actual/requested < threshold (e.g. <50% = over-provisioned) |
| Under-provisioned flag | Risk signal — pods near or exceeding requests risk OOMKill or throttling | Low | Ratio: actual/requested > threshold (e.g. >85% = under-provisioned) |
| Recommended request value | KRR, Goldilocks, VPA all provide this; SREs expect a concrete "set it to X" | Medium | Calculate from p90 + headroom buffer (e.g. p90 * 1.2) |
| Namespace-level summary | SREs manage teams/namespaces, need roll-up before drilling down | Low | Aggregate counts: pods analyzed, over-provisioned %, under-provisioned % |
| Per-namespace filtering | Config-driven namespace scope; not all namespaces are relevant | Low | Already in PROJECT.md requirements |
| Configurable time window | p90 over 1 day vs 30 days yields very different results; SRE must control this | Low | Already in PROJECT.md requirements |
| Current replica count | Can't reason about right-sizing without knowing how many replicas are running | Low | From Dynatrace `builtin:kubernetes.workload.pods` |
| Report is shareable | SREs share findings with dev teams; a self-contained HTML file is the right artifact | Low | Static HTML, no server required |
| Run timestamp / metadata | SRE needs to know when data was collected and for what time window | Low | Header section in report: generated-at, time-window, namespaces scoped |

**Confidence:** HIGH for all table stakes items — these appear universally across all comparable tools and match the PROJECT.md requirements.

---

## Differentiators

Features that go beyond the baseline. Not universally expected, but create genuine value for SRE teams.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| HPA gap flagging | KRR does this; Goldilocks does not. SREs managing bursty services care deeply. A workload with >3 replicas and no HPA is a likely candidate. | Medium | Requires checking HPA existence via Dynatrace entity data — may need `GET /api/v2/entities` with `type=KUBERNETES_SERVICE` or equivalent |
| Replica reduction recommendation | Specific to this project (PROJECT.md lists it). KRR doesn't do this directly. Flagging "you have 10 replicas but p90 load only needs 4" is high-value. | Medium | Needs replica efficiency model: (p90 load across all replicas) / (request per replica * replica count) |
| Savings estimate (resource units, not dollars) | "This namespace wastes ~40 CPU cores and 80GB memory" is actionable even without dollar costs. Avoids Kubecost dependency. | Low | Sum of (request - p90_actual) across all pods per namespace |
| Network bandwidth visibility | Most right-sizing tools focus on CPU/memory only. Network-aware reporting is a differentiator for network-heavy workloads. | Low | Dynatrace has `builtin:containers.net.bytesRx` / `bytesTx` — already in scope per PROJECT.md |
| Container-level granularity | Pods can have multiple containers (sidecars). Per-container breakdown exposes sidecar waste. | Medium | Dynatrace metrics support container-level filtering; adds API complexity |
| Efficiency score per workload | A normalized 0-100 score ("this deployment is 34% efficient") is easier to communicate to devs than raw ratios | Low | Derived metric: weighted average of CPU and memory utilization ratios |
| Exportable summary table | Machine-readable output (JSON/CSV) alongside HTML enables SREs to pipe into dashboards or tickets | Medium | Parallel output mode; low conceptual complexity but adds surface area |
| Historical comparison | "Last month: 40% efficient. This month: 55% efficient." Trend visibility motivates teams. | High | Requires storing previous runs — likely out of scope for v1 |
| Configurable recommendation strategy | p90 vs p95 vs p99; headroom multiplier. KRR supports this. Gives SRE teams tuning control. | Low | Config-file parameters: `percentile: 90`, `headroomMultiplier: 1.2` |
| Per-namespace efficiency ranking | Sort namespaces by waste to help SREs prioritize where to focus first | Low | Derived from aggregate metrics; display-only feature |

**Confidence:** HIGH for HPA flagging and replica recommendations (explicit in PROJECT.md and standard SRE concern). MEDIUM for container-level granularity and exportable summary (common in KRR but verify Dynatrace metric key support). LOW for historical comparison (significant architecture change — out of v1 scope per PROJECT.md).

---

## Anti-Features

Features to explicitly NOT build in v1. Each has a reason.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-applying recommendations (kubectl apply) | Out of scope per PROJECT.md. SRE trust requires human review. Risk of automated changes breaking production. | Generate YAML patches SREs can review and apply manually |
| Live dashboard / server mode | Out of scope per PROJECT.md. Adds operational overhead for on-prem deployment. | Static HTML per run; SREs schedule or run ad-hoc |
| Dollar cost calculations | No billing API access; on-prem clusters don't have cloud cost data. Kubecost solves this for those who need it. | Provide resource-unit waste (CPU cores, GB memory) — equally actionable |
| Direct kubectl / k8s API access | Out of scope per PROJECT.md. Adds RBAC setup complexity. Dynatrace already has this data. | Dynatrace-only data source |
| Multi-cluster aggregation | Scope explosion. Each cluster has its own Dynatrace endpoint. | Scope to one Dynatrace endpoint per run; SREs can run separately per cluster |
| Alert / notification system | Not a monitoring tool; a reporting tool. Alerting requires persistent infrastructure. | Static report is the artifact; SREs decide on action |
| User accounts / RBAC in tool | CLI tool run by SREs; no need for access control within the tool itself | Auth is API token to Dynatrace (already handled) |
| Slack/PagerDuty integration | Adds complexity; report sharing is out-of-band | SRE copies report or URL to Slack manually |
| Cross-namespace comparison (v1) | "Namespace X wastes more than namespace Y" — interesting but out of scope per PROJECT.md | Per-namespace is the unit of analysis |
| Custom metric support (non-k8s) | Application-level metrics (request rate, latency) require domain knowledge per service | Stick to infrastructure metrics: CPU, memory, network |
| YAML/Helm patch generation | Useful but adds implementation surface in v1 | Add in v2 after validating core report is trusted |

---

## Feature Dependencies

Features that require others to be in place first.

```
API connectivity + auth
  └── Namespace query (entity list)
        ├── Per-pod metric queries (CPU, memory, network)
        │     ├── Actual vs requested comparison
        │     │     ├── Over/under-provisioned flag
        │     │     ├── Recommended request value
        │     │     └── Savings estimate (resource units)
        │     └── Replica-efficiency model
        │           └── Replica reduction recommendation
        └── HPA entity detection
              └── HPA gap flagging

All of the above
  └── Namespace-level summary roll-up
        └── Per-namespace efficiency ranking
              └── HTML report generation
                    └── Run metadata header (timestamp, window, scope)
```

Key dependency insight: **API connectivity is the critical path gate.** Everything else is derived computation or display. The Dynatrace v2 Metrics API and Entities API must both be proven out before any feature work has confidence.

---

## MVP Recommendation

Prioritize table stakes first, then the two highest-value differentiators.

**Must ship in v1:**
1. Per-pod CPU + memory: actual vs requested (p90), with over/under flags
2. Recommended request values (p90 * configurable headroom multiplier)
3. Current replica count per workload
4. Namespace-level summary (pod count, over-provisioned %, aggregate resource waste)
5. HPA gap flagging (high SRE value, moderate complexity)
6. Replica reduction recommendation (unique to this tool vs. Goldilocks/VPA)
7. Network bandwidth reporting (already in scope, low marginal cost)
8. Configurable time window and percentile strategy
9. Run metadata header in report
10. Static HTML report (shareable, self-contained)

**Ship in v2 (after v1 validates SRE trust):**
- Container-level granularity (sidecar breakdown)
- Exportable JSON/CSV alongside HTML
- Configurable efficiency thresholds in config file
- Per-namespace efficiency ranking / sorted waste summary
- YAML patch generation for recommendations

**Defer indefinitely (requires architecture change):**
- Historical run comparison / trending
- Multi-cluster aggregation
- Cost estimation in dollars

---

## Comparison to Existing Tools: Feature Gap Map

| Feature | Goldilocks | VPA | KRR | Kubecost | This Tool (v1) |
|---------|------------|-----|-----|----------|----------------|
| CPU actual vs requested | Yes | Yes | Yes | Yes | Yes |
| Memory actual vs requested | Yes | Yes | Yes | Yes | Yes |
| Network bandwidth | No | No | No | Partial | Yes |
| Recommended CPU/mem values | Yes (VPA target) | Yes | Yes | Yes | Yes |
| Over/under-provisioned flag | Visual | No | Yes | Yes | Yes |
| HPA gap detection | No | No | Yes | Partial | Yes |
| Replica reduction recommendation | No | No | No | Partial | Yes |
| Container-level granularity | No | Yes | Yes | Yes | v2 |
| Namespace summary roll-up | Yes | No | Yes | Yes | Yes |
| Dollar cost estimates | No | No | No | Yes | No (by design) |
| Static HTML output | No (live UI) | No | No | No (live UI) | Yes |
| Dynatrace as data source | No | No | No | No | Yes (unique) |
| No cluster API access needed | No | No | No | No | Yes (unique) |
| Configurable time window | No | No | Yes | Yes | Yes |
| Configurable percentile strategy | No | No | Yes | No | Yes |

**Key differentiators of this tool vs. the field:**
1. Dynatrace as sole data source — no VPA, no Prometheus, no in-cluster tooling required
2. No direct Kubernetes API access — works from SRE's machine via Dynatrace API token
3. Replica reduction recommendations — not offered by Goldilocks or VPA
4. Network bandwidth in the same report — not standard in right-sizing tools
5. Static HTML artifact — all competitors use live dashboards or terminal output

---

## Sources

**Confidence assessment by source type:**

| Finding | Confidence | Basis |
|---------|------------|-------|
| Goldilocks features (VPA-based dashboard, no replica analysis, no HPA flagging) | HIGH | Training data consistent with stable tool (last major update 2022-2023); no web verification possible in this session |
| KRR features (Prometheus-based, HPA-aware, CSV/JSON/Slack output, percentile strategies) | HIGH | Well-documented open-source tool; training knowledge extensively covers it |
| VPA recommendation modes and VPA+HPA incompatibility | HIGH | Core Kubernetes documentation; highly stable behavior |
| Kubecost feature set | MEDIUM | Large platform; specific features may have changed post-August 2025 |
| SRE expectations around p90, headroom multipliers, HPA flagging | HIGH | Standard SRE practice; not tool-specific |
| Dynatrace metric key availability (`builtin:containers.*`) | MEDIUM | Based on PROJECT.md and training knowledge of Dynatrace v2 API; should be verified against actual Dynatrace Managed instance during implementation |

**Note:** WebSearch and WebFetch were unavailable in this session. All findings are from training data (cutoff August 2025). Recommend verifying Dynatrace entity model for HPA detection specifically — the entity type and relationship structure in Dynatrace Managed may differ from SaaS and should be confirmed against actual API responses before committing to HPA gap feature scope.
