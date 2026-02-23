# Domain Pitfalls

**Domain:** Dynatrace v2 API Integration + Kubernetes Right-Sizing Tool
**Researched:** 2026-02-23
**Confidence notes:** HIGH confidence on Dynatrace v2 API mechanics, Kubernetes scheduling, and HPA behavior from training data (knowledge cutoff August 2025). MEDIUM confidence on Dynatrace Managed vs SaaS API delta — verify version-specific behavior against your actual Managed instance version. LOW confidence claims are flagged inline.

---

## Critical Pitfalls

Mistakes that cause incorrect recommendations, broken queries, or require rewrites.

---

### Pitfall 1: Resolution Mismatch Makes p90 Statistically Meaningless

**What goes wrong:**
The Dynatrace v2 `GET /api/v2/metrics/query` API auto-selects a data point resolution based on the requested time window. For a 7-day window the default resolution is `1h`, meaning each data point already represents an hourly rollup. Applying `percentile(90)` to 168 hourly rollup values is not the same as taking the p90 of raw per-minute samples. The rollup has already smoothed spikes — short CPU bursts that last 3–5 minutes disappear entirely at 1h resolution, so your p90 reads artificially low and recommendations under-provision.

**Why it happens:**
The `resolution` parameter is optional and defaults silently. Developers assume the API returns raw samples. Dynatrace stores metrics at multiple resolutions and serves the coarsest one that fits response size limits.

**Consequences:**
- CPU p90 understated by 20–60% for bursty workloads
- Memory p90 understated because GC spikes are averaged out
- Recommendations cause OOM kills or CPU throttling in production after right-sizing

**Prevention:**
- Always specify `resolution=1m` (or `resolution=Inf` for aggregate-only queries where you want a single data point with the full-fidelity rollup). For time windows beyond 3 days, `1m` resolution may be rate-limited or paginated — test your actual instance's limits early.
- Use `resolution=1m` for windows up to 24–48 hours; use `resolution=5m` for 7-day windows and document the tradeoff explicitly in the report.
- Cross-check a known bursty pod: manually pull 1m vs 1h resolution and compare the resulting p90.

**Warning signs:**
- p90 CPU values are suspiciously round numbers or match average CPU closely
- All pods across a namespace show similarly "clean" utilization curves
- The report window uses more than 2 days but `resolution` is not set

**Phase address:** Phase 1 (API integration foundation) — validate resolution behavior on the actual Managed instance before building recommendation logic.

---

### Pitfall 2: Entity Selector Returns Wrong Pods — Namespace Filter Scoping

**What goes wrong:**
The entity selector syntax for Kubernetes pods uses `type(CLOUD_APPLICATION_INSTANCE)` for pods and `type(CLOUD_APPLICATION)` for workloads. Filtering by namespace requires `namespaceName("my-ns")` — but this property name is case-sensitive and the value must exactly match what OneAgent reports. On some Managed installations, the namespace name property is stored under a different relationship key (e.g., as part of the Kubernetes cluster entity relationship) and a flat `namespaceName` filter returns an empty result set silently, not an error.

**Why it happens:**
Dynatrace entity model normalizes Kubernetes concepts to its own entity types. The mapping is not 1:1 with kubectl concepts. Documentation examples are often written for SaaS where entity metadata indexing is more complete.

**Consequences:**
- Query returns 0 entities, tool reports "no pods found" — interpreted as clean namespace
- Query returns all pods across all namespaces (selector ignored) — data pollution, wrong recommendations
- Partial results without any indication that filtering failed

**Prevention:**
- Before implementing recommendation logic, run a raw entity list query for a known namespace and manually verify entity count matches `kubectl get pods -n <namespace> | wc -l`.
- Use the `GET /api/v2/entities` endpoint with `entitySelector=type(CLOUD_APPLICATION_INSTANCE)` and no namespace filter first; inspect the `properties` and `toRelationships` fields of returned entities to confirm the exact property key names used in your instance.
- Always log the count of entities returned per namespace at DEBUG level; alert/warn if 0.

**Warning signs:**
- Entity count for a namespace is 0 but you know pods are running
- Entity count is much higher than expected (no filter applied)
- Metric query returns data but entity query returns nothing

**Phase address:** Phase 1 — write an entity discovery validation step before any metric queries.

---

### Pitfall 3: Metric Keys for Containers vs. Pods — Wrong Granularity

**What goes wrong:**
`builtin:containers.cpu.usagePercent` reports CPU at the container level, not the pod level. A pod with 3 containers (e.g., app + sidecar + init) returns 3 separate time series. Summing or averaging naively gives wrong results: sidecars (e.g., Envoy, Linkerd proxy, log shippers) consume real CPU that inflates app container recommendations, or gets dropped if you only take the "first" series.

**Why it happens:**
The natural mental model is "pod metrics," but Dynatrace (following Kubernetes design) exposes metrics per container. The distinction is invisible in the API response unless you inspect the dimension key.

**Consequences:**
- CPU recommendations for sidecar-heavy workloads (service mesh, Istio, Linkerd) are inflated
- Memory recommendations miss sidecar footprint, leading to OOM kills on the pod
- Per-container breakdown accidentally included in "pod" recommendations confuses SREs

**Prevention:**
- When querying `builtin:containers.*` metrics, always split by `dt.entity.container_group_instance` and `container.name` dimension.
- Decide explicitly: recommend per-container (correct but complex) or per-pod (simple but imprecise). Document the choice in the report header.
- For v1, filter to main application container only using `container.name` dimension value matching the workload name — document this assumption prominently.
- Log the distinct container names discovered per pod; flag pods with >2 containers for manual review.

**Warning signs:**
- Time series count per entity is 2x–3x the pod count
- Namespace CPU totals far exceed what Kubernetes `kubectl top pods` shows
- A single "pod" entity has multiple dimension values for container name

**Phase address:** Phase 1 (metric query design) and Phase 2 (recommendation logic).

---

### Pitfall 4: p90 Baseline Distorted by Batch Jobs and CronJobs

**What goes wrong:**
CronJobs create pods that run at scheduled intervals (nightly ETL, hourly reports, weekly batch). These pods spike CPU and memory to near-limit during their run window and then terminate. If CronJob pods are included in namespace analysis, their high-percentile usage drives the p90 up for what appears to be the entire namespace — or worse, their terminated state means Dynatrace has incomplete time series (many zero-value data points) which pulls p90 down to near-zero, generating an aggressive scale-down recommendation for a pod that actually needs its current limits.

**Why it happens:**
CronJob pods have a different lifecycle than Deployment pods but use the same Kubernetes namespace. Dynatrace entity selectors don't differentiate by workload type (CronJob vs Deployment vs StatefulSet) without explicit filtering.

**Consequences:**
- Right-sizing recommendations for CronJob pods are meaningless (recommend scaling to 0 replicas, or over-provision based on peak-of-peak)
- Batch pods distort namespace-level summary percentages
- Report is confusing to SREs who recognize the pod names as batch jobs

**Prevention:**
- Query `GET /api/v2/entities` for `type(CLOUD_APPLICATION)` and inspect the `properties.workloadType` field — Dynatrace exposes `CRON_JOB`, `DEPLOYMENT`, `STATEFUL_SET`, `DAEMON_SET`, `REPLICA_SET`, `JOB` as workload types.
- Exclude CronJob and Job workload types from recommendation logic by default; add a config flag `includeBatchWorkloads: false` (default).
- When time series have >30% zero-value data points, flag the pod as "intermittent workload — baseline unreliable" rather than generating a recommendation.

**Warning signs:**
- Pods with names matching patterns like `-batch-`, `-etl-`, `-job-`, timestamp suffixes
- Metric time series with large gaps or mostly-zero values
- p90 memory for a "pod" is 0 bytes (terminated pod with no active window)

**Phase address:** Phase 2 (recommendation logic) — add workload type classification before computing baselines.

---

### Pitfall 5: Memory vs. CPU Have Fundamentally Different Right-Sizing Semantics

**What goes wrong:**
CPU is compressible — a pod that exceeds its CPU request is throttled, not killed. Memory is not compressible — a pod that exceeds its memory limit is OOM killed immediately. Applying the same p90-based right-sizing logic to both treats them as equivalent. Setting memory request = p90 memory usage leaves no headroom for GC pauses, JVM heap expansion, or in-memory caches warming up after a pod restart — the pod OOM kills within minutes of deployment.

**Why it happens:**
The abstraction "resource request = baseline usage" applies cleanly to CPU but breaks for memory. JVM and other managed runtimes are particularly dangerous: they report low RSS during startup then expand to configured heap maximum, regardless of p90 of historical RSS.

**Consequences:**
- Memory right-sizing triggers OOM cascades across a namespace
- JVM-based workloads (Java, Kotlin, Scala) are systematically mis-sized
- Report recommendations cause production incidents, destroying SRE trust in the tool

**Prevention:**
- Apply separate headroom multipliers: CPU request = p90 * 1.1 (10% headroom); Memory request = p90 * 1.3 (30% headroom minimum).
- Add a JVM/runtime detection heuristic: if the pod name matches known patterns OR if memory usage shows a stepped increase pattern after pod start, flag for manual review rather than auto-recommending.
- Report memory and CPU recommendations on separate cards in the HTML output with different visual treatment and explanatory footnotes.
- For memory, also surface p99 alongside p90 — the delta reveals burstiness risk.

**Warning signs:**
- p90 memory is suspiciously low compared to configured memory request
- Namespace contains Java/Kotlin/Scala services (look for `java`, `spring`, `quarkus` in image names or labels)
- p90 memory is stable but p99 is 2x–3x higher

**Phase address:** Phase 2 (recommendation logic) — separate CPU and memory recommendation engines.

---

### Pitfall 6: Recommending Replica Reduction Below HA Minimum

**What goes wrong:**
A deployment with 5 replicas running at 20% CPU average becomes a candidate for replica reduction to 1–2 replicas based on pure utilization math. However, the deployment may have PodDisruptionBudgets (PDB) requiring minimum 2 available replicas, or be a critical service where single-replica operation violates HA policy. The tool recommends scaling to 1, SRE applies it, a rolling update triggers, and the service has 0 available replicas during the rollout.

**Why it happens:**
Utilization-only analysis has no awareness of availability contracts. PDB configuration is a Kubernetes API concept not exposed through Dynatrace v2 API (Dynatrace does not index PDB objects).

**Consequences:**
- SRE applies recommended replica count; rolling deployment causes brief outage
- SRE loses trust in the tool after first bad recommendation

**Prevention:**
- Enforce a minimum replica recommendation floor of 2 for all workload types (Deployment/ReplicaSet). Document this as a design decision.
- For StatefulSets, never recommend replica count reduction — StatefulSets have ordered, stateful semantics where replica count changes require manual verification. Flag StatefulSets in the report as "StatefulSet — replica recommendation suppressed, manual review required."
- DaemonSets: never recommend replica changes — replica count for DaemonSets is determined by node count, not user configuration. Flag and exclude from replica recommendations.
- Add config option `minReplicaFloor: 2` (default 2, SRE can override to 1 explicitly).

**Warning signs:**
- Any deployment with current replicas = 1 that gets a recommendation to stay at 1 (no-op but should be flagged as "already at minimum")
- StatefulSet names in the entity list (Dynatrace exposes `workloadType` = `STATEFUL_SET`)
- DaemonSet names in the entity list (`workloadType` = `DAEMON_SET`)

**Phase address:** Phase 2 (recommendation logic) — workload type gating before replica recommendations.

---

### Pitfall 7: HPA Detection via Dynatrace is Unreliable

**What goes wrong:**
The plan is to detect existing HPAs via Dynatrace rather than kubectl. Dynatrace does not reliably expose HPA existence as a first-class entity or property in the v2 API. HPA configuration (minReplicas, maxReplicas, target metrics) lives entirely in the Kubernetes control plane and is not consistently indexed by OneAgent in Dynatrace entity metadata. Attempting to infer HPA presence from replica count variance (if replicas fluctuate over time, assume HPA exists) produces false positives (manual replica changes) and false negatives (HPA with stable load, never triggered).

**Why it happens:**
The project constraint "Dynatrace is the sole data source" was set to avoid kubectl access, but HPAs are a control-plane concept, not a workload metric. Dynatrace v2 entity model has limited coverage of control-plane objects (HPA, PDB, NetworkPolicy).

**Consequences:**
- Tool flags deployments as "missing HPA" when HPA already exists — embarrassing false positive
- SRE applies HPA based on tool recommendation to a deployment that already has one, causing conflict

**Prevention:**
- Do not assert HPA existence or absence with confidence via Dynatrace alone. Instead, report replica count stability metrics: "replica count was constant over the analysis window at N — HPA presence unknown, verify manually."
- If Dynatrace entity properties include any HPA-related metadata (inspect raw entity JSON for `horizontalPodAutoscaler` relationship or property), use it. Otherwise, caveat the HPA section clearly in the report UI.
- Add a config option for SREs to provide a manual HPA list or prefix patterns for known autoscaled workloads (`knownHpaWorkloads: ["frontend-*", "api-gateway"]`) to suppress false "missing HPA" flags.
- Mark HPA gap detection as `[CONFIDENCE: LOW — verify with kubectl get hpa -n <namespace>]` in the HTML report.

**Warning signs:**
- Entity JSON for a known HPA-controlled deployment shows no HPA relationship fields
- Replica count is constant for a deployment you know is HPA-controlled (HPA not being triggered by current load — normal behavior)

**Phase address:** Phase 2 (recommendation logic) and Phase 3 (report generation) — caveat UI design for HPA section.

---

### Pitfall 8: Network Bandwidth Metrics Are Node-Level, Not Pod-Level

**What goes wrong:**
`builtin:containers.net.bytesRx` and `builtin:containers.net.bytesTx` report network I/O at the container group (pod) level, but the underlying data collection in Kubernetes network plugins (CNI) typically operates at the network namespace level which maps to the pod, not individual containers. The critical limitation is that on some Dynatrace Managed versions with older OneAgent releases, network metrics may only be available at the node level (`builtin:host.net.bytesReceived`, `builtin:host.net.bytesSent`) — not disaggregated to the pod. If pod-level network metrics return empty or zero for all pods, the tool will silently show 0 network usage.

**Why it happens:**
Network metric collection requires specific OneAgent capabilities (network monitoring must be enabled in the host monitoring settings). On-prem Managed installations often have conservative monitoring policies that disable network deep monitoring to reduce agent overhead.

**Consequences:**
- All pods show 0 bytes network I/O — report looks obviously broken
- Network bandwidth recommendations are useless, reducing tool credibility
- Fallback to node-level metrics produces wrong per-pod attribution

**Prevention:**
- Probe for network metric availability early in execution: query `builtin:containers.net.bytesRx` for a single known-active pod over 1 hour. If result is empty or all zeros, log a warning and omit network recommendations from the report — do not show zero-bandwidth pods.
- Add a report banner: "Network bandwidth data unavailable — OneAgent network monitoring may not be enabled on your Managed instance. Contact your Dynatrace admin to enable host network monitoring."
- Document in README: network metrics require OneAgent network monitoring to be enabled in the Dynatrace Managed host monitoring policy.

**Warning signs:**
- API returns `[]` or all-zero values for `builtin:containers.net.*`
- Metric key availability endpoint (`GET /api/v2/metrics/{metricKey}`) returns 404 for container network metrics
- Network metrics work in Dynatrace UI but not via API (different permission scope — check API token has `metrics.read` scope)

**Phase address:** Phase 1 (metric discovery validation) — probe all metric keys before building the full query pipeline.

---

### Pitfall 9: Dynatrace Managed Version Lag — Feature Availability

**What goes wrong:**
Dynatrace Managed (on-prem) is typically 1–4 versions behind SaaS because customers control upgrade schedules. API documentation on the Dynatrace website reflects the SaaS (latest) version. Features introduced in Dynatrace 1.280+ (e.g., improved entity selector operators, new metric dimensions, pagination cursor changes) may not be available on an older Managed instance. Querying an endpoint or using a selector syntax that exists in docs but not in your instance returns a cryptic 400 or 404 error.

**Why it happens:**
The documentation doesn't always clearly version-gate features. "This feature requires Dynatrace 1.270" notices are present but easy to miss.

**Consequences:**
- Entity selectors with newer operators fail silently or with unhelpful errors
- Pagination behavior differs — you get partial results and think you have all data
- New metric keys added in newer Dynatrace versions are unavailable

**Prevention:**
- At startup, call `GET /api/v2/config/clusterversion` (or equivalent version endpoint) and log the Managed version. Compare against docs for any features used.
- Maintain a `MANAGED_COMPATIBILITY.md` noting which API features were verified against which Dynatrace Managed version during development.
- Test all entity selector patterns and metric key queries against the actual target Managed instance during Phase 1 — do not rely on docs alone.
- Use the most conservative/oldest syntax for entity selectors; avoid new operators unless tested.

**Warning signs:**
- API returns 400 with vague message on entity selector
- Metric key returns 404 despite being in Dynatrace docs
- Different behavior between dev testing (SaaS trial) and production Managed instance

**Phase address:** Phase 1 — version probe as first step in integration testing.

---

### Pitfall 10: API Token Scope Gaps Cause Silent Partial Data

**What goes wrong:**
The Dynatrace v2 API uses fine-grained token scopes. A token with `metrics.read` but not `entities.read` will successfully return metric data but return 403 on entity queries — meaning pod names/workload metadata is missing while utilization data exists. If the tool doesn't validate token scopes at startup, it proceeds with partial data, generates recommendations with entity IDs instead of human-readable names, or silently skips namespaces where entity queries fail.

Scopes needed for this tool:
- `metrics.read` — metric query API
- `entities.read` — entity API for workloads, pods, namespaces
- `DataExport` or `ReadConfig` may be needed for some Managed versions

**Why it happens:**
Token creation by Dynatrace admins often provides the minimum scope requested by the developer who set it up initially, and scope requirements grow as features are added.

**Consequences:**
- Entity names missing from report — shows entity IDs like `CLOUD_APPLICATION-ABC1234`
- 403 errors on entity API calls silently drop namespaces from report
- Tool appears to work but produces incomplete output

**Prevention:**
- At startup, run a preflight check: attempt a minimal read from each required API endpoint (metrics, entities) and report which scopes are missing before proceeding.
- Document required token scopes explicitly in README and config file comments.
- Exit with a clear error message listing missing scopes rather than proceeding with degraded data.

**Warning signs:**
- Entity query returns 403 while metric query returns 200
- Report contains entity IDs instead of names
- Namespaces in config are not in the report output

**Phase address:** Phase 1 — preflight validation as first integration concern.

---

### Pitfall 11: Metric Query Pagination — Missing Data for Large Namespaces

**What goes wrong:**
`GET /api/v2/metrics/query` returns a maximum of 1,000 data points per response by default. For a namespace with 200 pods queried at 1-minute resolution over 24 hours (200 pods * 1,440 minutes = 288,000 data points), the response is paginated. The `nextPageKey` in the response must be used to fetch subsequent pages. If pagination is not implemented, the tool silently analyzes only the first 1,000 data points — often representing only the first few pods — and generates recommendations for a subset of the namespace.

Similarly, `GET /api/v2/entities` is paginated at 50 entities per page by default (configurable up to 500). A namespace with 300 pods requires 6–7 pages.

**Why it happens:**
Pagination is not always obvious from quick API testing with small namespaces during development. The API doesn't return an error — it returns a subset with a `nextPageKey` that's easy to ignore.

**Consequences:**
- Recommendations cover only a fraction of pods in large namespaces
- Report appears complete but is missing pods
- Missing pods are those that appear last in API ordering (often alphabetically last — could be your most important services)

**Prevention:**
- Implement pagination as a first-class concern from Phase 1: all entity and metric fetches must follow `nextPageKey` until exhausted.
- After fetching entities for a namespace, log "Found N entities" and compare against expected count from a config-provided hint or prior run.
- Write a unit test that mocks paginated responses and verifies all pages are consumed.

**Warning signs:**
- Entity count for a large namespace seems low
- The same pods always appear in report regardless of namespace content
- Log shows only one API call per namespace instead of N calls

**Phase address:** Phase 1 (API client implementation) — pagination must be in the first API client, not added later.

---

## Moderate Pitfalls

---

### Pitfall 12: Time Window Selection Bias

**What goes wrong:**
If the SRE selects a time window that covers an unusual period (production incident with high CPU, post-deployment warmup, holiday low-traffic), the p90 baseline is unrepresentative. A 7-day window including a major incident inflates CPU p90 and generates conservative (do-not-shrink) recommendations. A window covering a holiday produces aggressive scale-down recommendations that fail when normal traffic resumes.

**Prevention:**
- In the report, prominently display the analysis window (start/end timestamps, duration) on every page and in the summary.
- Recommend in README: use 2–4 weeks of data for stable workloads, exclude known incident periods.
- Consider adding a warning in the report if the window is less than 7 days ("Baseline may not represent full weekly traffic patterns").

**Phase address:** Phase 3 (report generation) — time window display and caveats.

---

### Pitfall 13: HTML Report Memory Exhaustion for Large Datasets

**What goes wrong:**
Building an HTML report by concatenating strings in memory for 500+ pods with per-pod time series data (metric arrays) causes Node.js heap exhaustion. JSON.stringify of the full dataset inline in the HTML file creates a single file that's 50–200MB — unusable in a browser.

**Prevention:**
- Do not embed raw time series data in the HTML report. Embed only summary statistics (p90, p99, current request, recommendation delta).
- If time series charts are desired, generate them as SVG/PNG at report-build time using a library like `chart.js` with node-canvas, then embed as base64 — keeping data out of the live DOM.
- Use streaming HTML generation (write HTML line by line to a file stream) rather than building a full string in memory.
- Set a pod count threshold (e.g., >200 pods) that triggers a "paginated report" or per-namespace separate HTML files instead of one monolithic file.

**Phase address:** Phase 3 (report generation).

---

### Pitfall 14: Rate Limiting on Dynatrace Managed API

**What goes wrong:**
On-prem Dynatrace Managed applies rate limiting at the environment level (default: 50 requests per minute for the metrics API on some versions). A tool that launches concurrent metric queries for 20 namespaces with 100 pods each will hit rate limits within seconds, receiving 429 responses. Without retry logic, the tool fails mid-run with partial results.

**Prevention:**
- Implement exponential backoff with jitter for all API calls. On 429, wait `min(baseDelay * 2^attempt, maxDelay)` with random jitter.
- Serialize metric queries at the namespace level (one namespace at a time) rather than fully concurrent, to reduce burst.
- Use Dynatrace metric query batching: request multiple metric keys in a single query (`metricSelector=builtin:containers.cpu.usagePercent,builtin:containers.memory.residentMemoryBytes`) rather than separate calls per metric.
- Log rate limit hits with retry count so SREs can tune concurrency.

**Phase address:** Phase 1 (API client) — retry/backoff is a day-1 implementation requirement, not an optimization.

---

### Pitfall 15: Entity Selector Syntax is Not SQL — Operator Semantics Differ

**What goes wrong:**
Dynatrace entity selector uses a custom DSL. Common mistakes:
- String values require quotes: `namespaceName("production")` not `namespaceName(production)`
- `AND` between conditions uses comma, not `AND` keyword: `type(CLOUD_APPLICATION),namespaceName("production")`
- Wildcard matching uses `~` prefix: `entityName.startsWith("api-")` — not `entityName LIKE "api-*"`
- Relationship traversal (`from(type(X),toRelationships.isNamespaceOf(type(Y)))`) syntax varies by Managed version

A single syntax error returns 400 with a message that may not identify the offending clause.

**Prevention:**
- Validate entity selector strings against the Dynatrace entity selector documentation for the exact Managed version in use.
- Write unit tests for entity selector string construction with known-good examples.
- Log the full entity selector string at DEBUG level before each API call to make debugging straightforward.

**Phase address:** Phase 1 (API client) — selector builder with tests.

---

## Minor Pitfalls

---

### Pitfall 16: Pod Names Are Ephemeral — Entities Change Between Runs

**What goes wrong:**
Kubernetes pod names include a random suffix (e.g., `api-deployment-7d9f8b-xkz4p`). Between tool runs (even minutes apart), pods may be rescheduled with new names. Dynatrace entity IDs for pods are stable within a pod's lifetime but change when the pod is recreated. Comparing pod-level entity IDs between runs is meaningless; workload-level entity IDs (Deployment, StatefulSet) are stable.

**Prevention:**
- Aggregate and report at the workload level (Deployment/StatefulSet name), not the individual pod level, as the primary unit of analysis.
- Use `type(CLOUD_APPLICATION)` for workload entities (stable) rather than `type(CLOUD_APPLICATION_INSTANCE)` for pod entities (ephemeral) as the anchor for cross-run comparison.

**Phase address:** Phase 2 (data model design).

---

### Pitfall 17: Timezone and DST in Time Window Calculation

**What goes wrong:**
Dynatrace API accepts UTC timestamps. When the tool computes "last 7 days" from the SRE's local machine time without explicit UTC conversion, requests made from a machine in UTC+5:30 produce a window offset by 5.5 hours from the intended window. DST transitions cause 1-hour gaps or overlaps in time series.

**Prevention:**
- Always compute time windows in UTC explicitly (`new Date().toISOString()` in Node.js produces UTC).
- Display the analysis window in both UTC and local time in the report.
- Never compute time windows as "now - N hours in local time."

**Phase address:** Phase 1 (API client) — UTC-only time handling from the start.

---

### Pitfall 18: Config File Namespace Names Must Match Dynatrace Entity Names Exactly

**What goes wrong:**
If the config file specifies namespace `production` but Dynatrace indexes it as `prod` (because the Kubernetes cluster admin named it `prod`), the entity selector finds no entities and the namespace is silently skipped. No error — just empty results.

**Prevention:**
- After loading config, run an entity discovery query and list all found namespace names in a "discovered namespaces" log line. If configured namespaces have no match, warn explicitly: "Namespace 'production' not found in Dynatrace — available namespaces: prod, staging, qa."
- Add a `--discover-namespaces` CLI flag that lists all Kubernetes namespaces visible in Dynatrace, to help SREs populate their config file correctly.

**Phase address:** Phase 1 (CLI/config layer).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| API client foundation | Pagination not implemented | Paginate all entity + metric fetches from day 1; write pagination unit tests |
| API client foundation | Rate limiting without backoff | Implement exponential backoff before any load testing |
| API client foundation | Token scope gaps | Preflight scope validation at startup |
| Metric query design | Resolution mismatch → low p90 | Explicit `resolution` parameter on all metric queries; cross-check vs expected values |
| Metric query design | Container vs pod granularity | Decide container vs pod aggregation strategy; document in report |
| Metric query design | Network metrics unavailable | Probe metric key availability; graceful degradation with clear report banner |
| Recommendation logic | Batch/CronJob distortion | Classify workload types before computing baselines; exclude Jobs/CronJobs by default |
| Recommendation logic | Memory OOM from headroom gap | Separate CPU/memory multipliers; 30% headroom minimum for memory |
| Recommendation logic | StatefulSet/DaemonSet replica change | Hard-block replica recommendations for StatefulSet + DaemonSet; flag for manual review |
| Recommendation logic | HA minimum violation | Floor all replica recommendations at 2; document as design decision |
| Recommendation logic | HPA false positives | Caveat HPA detection confidence; add manual override config |
| Report generation | Monolithic HTML memory exhaustion | No raw time series in HTML; streaming write; per-namespace files for >200 pods |
| Report generation | Time window ambiguity | Display UTC + local time window on every page |
| Report generation | Missing pods go unnoticed | Log entity count per namespace; surface in report header |

---

## Sources

**Confidence notes on sources:**
- Dynatrace v2 API mechanics (resolution, entity selectors, metric keys, pagination, token scopes): HIGH confidence — based on Dynatrace v2 API documentation and hands-on experience reflected in training data through August 2025. Verify against your specific Managed version.
- Kubernetes right-sizing semantics (compressible/non-compressible resources, PDB, HPA, workload types): HIGH confidence — Kubernetes API specifications are stable and well-documented.
- Dynatrace Managed vs SaaS version lag: MEDIUM confidence — general pattern is well-established, but specific version numbers and feature availability cutoffs should be verified against your instance version.
- Network metric granularity on Managed: MEDIUM confidence — depends on OneAgent version and host monitoring policy, which varies by installation.
- HPA exposure via Dynatrace v2 API: MEDIUM confidence — HPA as a control-plane object has historically had limited Dynatrace entity model coverage; verify against current Managed instance by inspecting raw entity JSON.

**Recommended verification steps before Phase 1:**
1. `GET /api/v2/metrics/{metricKey}` for each `builtin:containers.*` key used — confirm they exist on your Managed version
2. `GET /api/v2/entities` with `type(CLOUD_APPLICATION_INSTANCE)` — inspect raw JSON to confirm available properties and relationship keys
3. `GET /api/v2/metrics/query` with `resolution=1m` for a 24h window — confirm response size and pagination behavior
4. Check Dynatrace Managed version at startup and document it
