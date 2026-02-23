#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";

// src/debug.ts
import { env } from "process";
var debug = (...args) => {
  if (env.DEBUG) {
    console.debug("[debug]", ...args);
  }
};

// src/config.ts
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { env as env2 } from "process";
import yaml from "js-yaml";
import { z } from "zod";
var metricsSchema = z.object({
  cpuUsage: z.string().min(1).default("builtin:kubernetes.workload.cpu_usage"),
  memoryUsage: z.string().min(1).default("builtin:kubernetes.workload.memory_working_set"),
  cpuRequest: z.string().min(1).default("builtin:kubernetes.workload.requests_cpu"),
  memoryRequest: z.string().min(1).default("builtin:kubernetes.workload.requests_memory"),
  podCount: z.string().min(1).default("builtin:kubernetes.workload.pods")
}).default({
  cpuUsage: "builtin:kubernetes.workload.cpu_usage",
  memoryUsage: "builtin:kubernetes.workload.memory_working_set",
  cpuRequest: "builtin:kubernetes.workload.requests_cpu",
  memoryRequest: "builtin:kubernetes.workload.requests_memory",
  podCount: "builtin:kubernetes.workload.pods"
});
var configSchema = z.object({
  endpoint: z.string().url(),
  apiToken: z.string().min(1),
  namespaces: z.array(z.string().min(1)).min(1),
  timeWindow: z.string().regex(/^\d+[dh]$/).default("7d"),
  percentile: z.number().int().min(50).max(99).default(90),
  cpuHeadroomMultiplier: z.number().min(1).default(1.1),
  memoryHeadroomMultiplier: z.number().min(1.3).default(1.3),
  cpuOverProvisionedThreshold: z.number().min(0.1).max(0.9).default(0.6),
  cpuUnderProvisionedThreshold: z.number().min(0.5).max(1).default(0.9),
  memoryOverProvisionedThreshold: z.number().min(0.1).max(0.9).default(0.6),
  memoryUnderProvisionedThreshold: z.number().min(0.5).max(1).default(0.9),
  minReplicaFloor: z.number().int().min(1).default(2),
  outputPath: z.string().min(1).default("./report.html"),
  metrics: metricsSchema
});
var loadConfig = (configPath, windowOverride) => {
  debug("loadConfig start", { configPath, windowOverride });
  const absPath = resolve(configPath);
  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }
  debug("reading config file", absPath);
  const raw = readFileSync(absPath, "utf8");
  debug("parsing yaml");
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid config YAML in ${absPath}`);
  }
  const input = parsed;
  if (windowOverride) {
    debug("applying --window override", windowOverride);
    input.timeWindow = windowOverride;
  }
  if (env2.DYNATRACE_API_TOKEN) {
    debug("DYNATRACE_API_TOKEN env override applied");
    input.apiToken = env2.DYNATRACE_API_TOKEN;
  }
  debug("validating config schema");
  const cfg = configSchema.parse(input);
  debug("loadConfig end", { endpoint: cfg.endpoint, namespaceCount: cfg.namespaces.length });
  return cfg;
};

// src/dynatrace.ts
var DynatraceClient = class {
  endpoint;
  token;
  constructor(endpoint, token) {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.token = token;
    debug("DynatraceClient initialized", { endpoint: this.endpoint });
  }
  async fetchMetricPage(params) {
    const url = `${this.endpoint}/api/v2/metrics/query?${params.toString()}`;
    debug("Dynatrace metrics query start", { url });
    const response = await fetch(url, {
      headers: {
        Authorization: `Api-Token ${this.token}`
      }
    });
    if (!response.ok) {
      const body = await response.text();
      debug("Dynatrace metrics query failed", { status: response.status, body });
      throw new Error(`Dynatrace API error ${response.status}: ${body}`);
    }
    const payload = await response.json();
    debug("Dynatrace metrics query end", {
      totalCount: payload.totalCount,
      nextPageKey: payload.nextPageKey ?? null,
      resultCount: payload.result?.length ?? 0
    });
    return payload;
  }
  async queryMetricSeries(metricSelector, from, namespaces) {
    debug("queryMetricSeries start", { metricSelector, from, namespaceCount: namespaces.length });
    const points = [];
    let nextPageKey;
    let page = 0;
    do {
      page += 1;
      const params = new URLSearchParams();
      params.set("metricSelector", metricSelector);
      params.set("from", `now-${from}`);
      params.set("resolution", "Inf");
      if (nextPageKey) {
        params.set("nextPageKey", nextPageKey);
      }
      const payload = await this.fetchMetricPage(params);
      const result = payload.result ?? [];
      for (const metric of result) {
        for (const series of metric.data ?? []) {
          const values = (series.values ?? []).filter((value) => typeof value === "number");
          if (values.length === 0) {
            continue;
          }
          const dimensionMap = series.dimensionMap ?? {};
          const namespace = dimensionMap["k8s.namespace.name"] ?? dimensionMap["dt.entity.cloud_application_namespace.name"] ?? this.pickByKeyContains(dimensionMap, "namespace") ?? "unknown";
          if (!namespaces.includes(namespace)) {
            continue;
          }
          const workload = dimensionMap["k8s.workload.name"] ?? dimensionMap["k8s.deployment.name"] ?? dimensionMap["k8s.statefulset.name"] ?? this.pickByKeyContains(dimensionMap, "workload") ?? this.pickByKeyContains(dimensionMap, "cloud_application") ?? series.dimensions?.find((d) => d && d !== namespace) ?? "unknown";
          const workloadKind = dimensionMap["k8s.workload.kind"] ?? (dimensionMap["k8s.deployment.name"] ? "deployment" : void 0) ?? this.inferKindFromMap(dimensionMap, workload);
          points.push({
            namespace,
            workload,
            workloadKind: workloadKind || "other",
            values
          });
        }
      }
      nextPageKey = payload.nextPageKey;
      debug("metrics pagination step", { page, nextPageKey: nextPageKey ?? null, accumulatedPoints: points.length });
    } while (nextPageKey);
    debug("queryMetricSeries end", { metricSelector, points: points.length });
    return points;
  }
  pickByKeyContains(map, needle) {
    const key = Object.keys(map).find((k) => k.toLowerCase().includes(needle.toLowerCase()));
    return key ? map[key] : void 0;
  }
  inferKindFromMap(map, workload) {
    const keyBlob = Object.keys(map).join(" ").toLowerCase();
    const valBlob = Object.values(map).join(" ").toLowerCase();
    const blob = `${keyBlob} ${valBlob} ${workload.toLowerCase()}`;
    if (blob.includes("deployment")) return "deployment";
    if (blob.includes("statefulset")) return "statefulset";
    if (blob.includes("daemonset")) return "daemonset";
    if (blob.includes("cronjob")) return "cronjob";
    return "other";
  }
};

// src/analysis.ts
var sortAsc = (arr) => [...arr].sort((a, b) => a - b);
var percentile = (values, p) => {
  if (values.length === 0) return 0;
  const sorted = sortAsc(values);
  const rank = p / 100 * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
};
var mean = (values) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};
var workloadKindFromString = (value) => {
  switch (value.toLowerCase()) {
    case "deployment":
      return "deployment";
    case "statefulset":
      return "statefulset";
    case "daemonset":
      return "daemonset";
    case "cronjob":
      return "cronjob";
    default:
      return "other";
  }
};
var keyFor = (namespace, workload) => `${namespace}::${workload}`;
var mergeMetricPoints = (cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount) => {
  debug("mergeMetricPoints start", {
    cpuUsage: cpuUsage.length,
    memoryUsage: memoryUsage.length,
    cpuRequest: cpuRequest.length,
    memoryRequest: memoryRequest.length,
    podCount: podCount.length
  });
  const all = [cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount].flat();
  const map = /* @__PURE__ */ new Map();
  for (const point of all) {
    const key = keyFor(point.namespace, point.workload);
    if (!map.has(key)) {
      map.set(key, {
        namespace: point.namespace,
        workload: point.workload,
        workloadKind: workloadKindFromString(point.workloadKind),
        cpuUsage: [],
        memoryUsage: [],
        cpuRequest: [],
        memoryRequest: [],
        podCount: []
      });
    }
  }
  const fill = (points, field) => {
    for (const point of points) {
      const key = keyFor(point.namespace, point.workload);
      const row = map.get(key);
      if (!row) continue;
      row[field].push(...point.values);
    }
  };
  fill(cpuUsage, "cpuUsage");
  fill(memoryUsage, "memoryUsage");
  fill(cpuRequest, "cpuRequest");
  fill(memoryRequest, "memoryRequest");
  fill(podCount, "podCount");
  const merged = [...map.values()];
  debug("mergeMetricPoints end", { merged: merged.length });
  return merged;
};
var classify = (utilization, overThreshold, underThreshold) => {
  if (!Number.isFinite(utilization) || utilization <= 0) return "unknown";
  if (utilization < overThreshold) return "over-provisioned";
  if (utilization > underThreshold) return "under-provisioned";
  return "balanced";
};
var recommend = (samples, config) => {
  debug("recommend start", { samples: samples.length, percentile: config.percentile });
  const results = samples.map((sample) => {
    const pCpuUsage = percentile(sample.cpuUsage, config.percentile);
    const pMemoryUsage = percentile(sample.memoryUsage, config.percentile);
    const currentCpuRequest = mean(sample.cpuRequest);
    const currentMemoryRequest = mean(sample.memoryRequest);
    const currentReplicas = Math.max(1, Math.round(mean(sample.podCount)));
    const recommendedCpuRequest = pCpuUsage * config.cpuHeadroomMultiplier;
    const recommendedMemoryRequest = pMemoryUsage * Math.max(1.3, config.memoryHeadroomMultiplier);
    const cpuUtilizationVsRequest = currentCpuRequest > 0 ? pCpuUsage / currentCpuRequest : 0;
    const memoryUtilizationVsRequest = currentMemoryRequest > 0 ? pMemoryUsage / currentMemoryRequest : 0;
    const cpuStatus = classify(
      cpuUtilizationVsRequest,
      config.cpuOverProvisionedThreshold,
      config.cpuUnderProvisionedThreshold
    );
    const memoryStatus = classify(
      memoryUtilizationVsRequest,
      config.memoryOverProvisionedThreshold,
      config.memoryUnderProvisionedThreshold
    );
    const perPodCapacity = Math.max(1e-9, Math.min(recommendedCpuRequest, currentCpuRequest || recommendedCpuRequest));
    const estimatedLoad = pCpuUsage * currentReplicas;
    const idealReplicas = Math.max(1, Math.ceil(estimatedLoad / perPodCapacity));
    let recommendedReplicas = currentReplicas;
    let replicaAction = "keep";
    if (sample.workloadKind === "deployment") {
      recommendedReplicas = Math.max(config.minReplicaFloor, idealReplicas);
      if (recommendedReplicas < currentReplicas) replicaAction = "scale-down";
      if (recommendedReplicas > currentReplicas) replicaAction = "scale-up";
    } else {
      replicaAction = "n/a";
    }
    return {
      namespace: sample.namespace,
      workload: sample.workload,
      workloadKind: sample.workloadKind,
      currentCpuRequest,
      currentMemoryRequest,
      currentReplicas,
      pCpuUsage,
      pMemoryUsage,
      recommendedCpuRequest,
      recommendedMemoryRequest,
      recommendedReplicas,
      cpuUtilizationVsRequest,
      memoryUtilizationVsRequest,
      cpuStatus,
      memoryStatus,
      replicaAction
    };
  }).sort(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.workload.localeCompare(b.workload)
  );
  debug("recommend end", { recommendations: results.length });
  return results;
};

// src/report.ts
import { writeFileSync } from "fs";
import { resolve as resolve2 } from "path";
var fmt = (n, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : "n/a";
var writeHtmlReport = (outputPath, rows) => {
  debug("writeHtmlReport start", { outputPath, rows: rows.length });
  const abs = resolve2(outputPath);
  const bodyRows = rows.map((r) => {
    return `<tr>
<td>${r.namespace}</td>
<td>${r.workload}</td>
<td>${r.workloadKind}</td>
<td>${fmt(r.currentCpuRequest)}</td>
<td>${fmt(r.recommendedCpuRequest)}</td>
<td>${r.cpuStatus}</td>
<td>${fmt(r.currentMemoryRequest)}</td>
<td>${fmt(r.recommendedMemoryRequest)}</td>
<td>${r.memoryStatus}</td>
<td>${r.currentReplicas}</td>
<td>${r.recommendedReplicas}</td>
<td>${r.replicaAction}</td>
</tr>`;
  }).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Ops Pod Optimization Report</title>
<style>
:root { --bg:#f6f8fb; --fg:#142033; --accent:#1b6ef3; --line:#d9e1ee; --card:#ffffff; }
*{box-sizing:border-box} body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:1200px;margin:24px auto;padding:0 16px}
header{background:linear-gradient(135deg,#e9f1ff,#fefefe);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:16px}
h1{margin:0;font-size:1.4rem}
p{margin:8px 0 0;color:#3f526f}
.table-wrap{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{position:sticky;top:0;background:#f0f5ff}
tr:hover td{background:#f9fbff}
.badge{font-weight:600;color:var(--accent)}
</style>
</head>
<body>
<main>
<header>
<h1>CPU, Memory and Pod Sizing Recommendations</h1>
<p>Generated from live Dynatrace API metric queries. Rows: <span class="badge">${rows.length}</span></p>
</header>
<div class="table-wrap">
<table>
<thead>
<tr>
<th>Namespace</th><th>Workload</th><th>Kind</th>
<th>CPU Req (curr)</th><th>CPU Req (reco)</th><th>CPU Status</th>
<th>Mem Req (curr)</th><th>Mem Req (reco)</th><th>Mem Status</th>
<th>Replicas (curr)</th><th>Replicas (reco)</th><th>Action</th>
</tr>
</thead>
<tbody>
${bodyRows}
</tbody>
</table>
</div>
</main>
</body>
</html>`;
  writeFileSync(abs, html, "utf8");
  debug("writeHtmlReport end", { abs });
  return abs;
};

// src/index.ts
var VERSION = "0.2.0";
var run = async (argv) => {
  debug("run start", { argv });
  const program = new Command();
  program.name("ops-pod-opt").description("CPU, memory and pod sizing optimization based on Dynatrace APIs").version(VERSION).option("-c, --config <path>", "Path to YAML config file", "config.yaml").option("-w, --window <window>", "Override config timeWindow (e.g. 7d, 24h)");
  program.parse(argv);
  const opts = program.opts();
  debug("cli options parsed", opts);
  const config = loadConfig(opts.config, opts.window);
  const client = new DynatraceClient(config.endpoint, config.apiToken);
  debug("querying Dynatrace metrics for optimization");
  const [cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount] = await Promise.all([
    client.queryMetricSeries(config.metrics.cpuUsage, config.timeWindow, config.namespaces),
    client.queryMetricSeries(config.metrics.memoryUsage, config.timeWindow, config.namespaces),
    client.queryMetricSeries(config.metrics.cpuRequest, config.timeWindow, config.namespaces),
    client.queryMetricSeries(config.metrics.memoryRequest, config.timeWindow, config.namespaces),
    client.queryMetricSeries(config.metrics.podCount, config.timeWindow, config.namespaces)
  ]);
  const samples = mergeMetricPoints(cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount);
  const recommendations = recommend(samples, config);
  const reportPath = writeHtmlReport(config.outputPath, recommendations);
  console.log(`Recommendations generated: ${recommendations.length}`);
  console.log(`Report written to: ${reportPath}`);
  debug("run end", { recommendations: recommendations.length, reportPath });
};
var main = async () => {
  try {
    await run(process.argv);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${msg}`);
    process.exitCode = 1;
  }
};
var isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  void main();
}
export {
  main,
  run
};
