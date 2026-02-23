#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";

// src/config/loader.ts
import { readFile } from "fs/promises";
import { resolve } from "path";
import { env as env2 } from "process";
import yaml from "js-yaml";

// src/debug.ts
import { env } from "process";
var debug = (...args) => {
  if (env.DEBUG) {
    console.debug("[debug]", ...args);
  }
};

// src/config/types.ts
import { z } from "zod";
var AppConfigSchema = z.object({
  endpoint: z.string().url(),
  apiToken: z.string().optional().default(""),
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
  outputPath: z.string().min(1).default("./report.html")
});

// src/config/loader.ts
var parseByExtension = (raw, path) => {
  if (path.endsWith(".json")) {
    return JSON.parse(raw);
  }
  return yaml.load(raw);
};
var loadConfig = async (configPath, overrides) => {
  debug("loadConfig start", { configPath, overrides });
  const absPath = resolve(configPath);
  let raw;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (error) {
    debug("loadConfig readFile failed", { absPath, error });
    throw new Error(`Config file not found: ${absPath}`);
  }
  let parsed;
  try {
    parsed = parseByExtension(raw, absPath);
  } catch (error) {
    debug("loadConfig parse failed", { absPath, error });
    throw new Error(`Invalid config format in ${absPath}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid config format in ${absPath}`);
  }
  const configInput = { ...parsed };
  if (overrides?.window) {
    configInput.timeWindow = overrides.window;
  }
  if (overrides?.outputPath) {
    configInput.outputPath = overrides.outputPath;
  }
  if (typeof env2.DYNATRACE_API_TOKEN === "string" && env2.DYNATRACE_API_TOKEN.trim().length > 0) {
    configInput.apiToken = env2.DYNATRACE_API_TOKEN.trim();
    debug("DYNATRACE_API_TOKEN env override applied");
  }
  let config;
  try {
    config = AppConfigSchema.parse(configInput);
  } catch (error) {
    debug("loadConfig schema validation failed", { error });
    throw error;
  }
  if (!config.apiToken) {
    throw new Error("apiToken is required in config file unless DYNATRACE_API_TOKEN is set");
  }
  debug("loadConfig end", {
    endpoint: config.endpoint,
    namespaces: config.namespaces.length,
    timeWindow: config.timeWindow
  });
  return config;
};

// src/dynatrace/client.ts
var DynatraceClient = class {
  endpoint;
  token;
  constructor(endpoint, token) {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.token = token;
  }
  async requestMetrics(params) {
    const url = `${this.endpoint}/api/v2/metrics/query?${params.toString()}`;
    debug("dynatrace request start", { url });
    const response = await fetch(url, {
      headers: {
        Authorization: `Api-Token ${this.token}`
      }
    });
    if (!response.ok) {
      const body = await response.text();
      debug("dynatrace request failed", { status: response.status, body });
      throw new Error(`Dynatrace API error ${response.status}: ${body}`);
    }
    const payload = await response.json();
    debug("dynatrace request end", {
      resultCount: payload.result?.length ?? 0,
      nextPageKey: payload.nextPageKey ?? null
    });
    return payload;
  }
  parseMetricSeries(payload, namespaces) {
    const out = [];
    for (const metric of payload.result ?? []) {
      for (const series of metric.data ?? []) {
        const values = (series.values ?? []).filter((v) => typeof v === "number");
        if (values.length === 0) continue;
        const map = series.dimensionMap ?? {};
        const namespace = map["k8s.namespace.name"] ?? map["dt.entity.cloud_application_namespace.name"] ?? this.findDimensionByNeedle(map, "namespace") ?? "unknown";
        if (!namespaces.includes(namespace)) continue;
        const workload = map["k8s.workload.name"] ?? map["dt.entity.cloud_application.name"] ?? this.findDimensionByNeedle(map, "workload") ?? this.findDimensionByNeedle(map, "cloud_application") ?? series.dimensions.find((value) => value && value !== namespace) ?? "unknown";
        const workloadKind = map["k8s.workload.kind"] ?? this.findDimensionByNeedle(map, "kind") ?? this.inferKind(workload, map);
        out.push({ namespace, workload, workloadKind, values });
      }
    }
    return out;
  }
  findDimensionByNeedle(map, needle) {
    const match = Object.entries(map).find(([key]) => key.toLowerCase().includes(needle));
    return match?.[1];
  }
  inferKind(workload, map) {
    const blob = `${workload} ${Object.keys(map).join(" ")} ${Object.values(map).join(" ")}`.toLowerCase();
    if (blob.includes("deployment")) return "deployment";
    if (blob.includes("stateful")) return "statefulset";
    if (blob.includes("daemon")) return "daemonset";
    if (blob.includes("cron")) return "cronjob";
    if (blob.includes("job")) return "job";
    return "other";
  }
  async queryWithSelector(selector, fromWindow, namespaces) {
    debug("queryWithSelector start", { selector, fromWindow });
    const rows = [];
    let page = 0;
    let nextPageKey;
    do {
      page += 1;
      const params = new URLSearchParams();
      if (nextPageKey) {
        params.set("nextPageKey", nextPageKey);
      } else {
        params.set("metricSelector", selector);
        params.set("from", `now-${fromWindow}`);
        params.set("resolution", fromWindow.endsWith("h") ? "1m" : "5m");
      }
      const payload = await this.requestMetrics(params);
      rows.push(...this.parseMetricSeries(payload, namespaces));
      nextPageKey = payload.nextPageKey;
      debug("queryWithSelector page", { selector, page, nextPageKey: nextPageKey ?? null, rows: rows.length });
    } while (nextPageKey);
    debug("queryWithSelector end", { selector, rows: rows.length });
    return rows;
  }
  async queryMetric(metricType, fromWindow, namespaces) {
    const selectorsByType = {
      cpuUsage: [
        'builtin:kubernetes.workload.cpu_usage:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
        'builtin:containers.cpu.usagePercent:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg'
      ],
      memoryUsage: [
        'builtin:kubernetes.workload.memory_working_set:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
        'builtin:containers.memory.residentMemoryBytes:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg'
      ],
      cpuRequest: [
        'builtin:kubernetes.workload.requests_cpu:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg'
      ],
      memoryRequest: [
        'builtin:kubernetes.workload.requests_memory:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg'
      ],
      podCount: [
        'builtin:kubernetes.workload.pods:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg'
      ]
    };
    const selectors = selectorsByType[metricType];
    const failures = [];
    for (const selector of selectors) {
      try {
        const rows = await this.queryWithSelector(selector, fromWindow, namespaces);
        if (rows.length > 0) {
          return rows;
        }
        failures.push(`${selector} (no matching data)`);
      } catch (error) {
        failures.push(`${selector} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    throw new Error(`No usable Dynatrace selector for ${metricType}. Attempts: ${failures.join(" | ")}`);
  }
  async discoverNamespaces(fromWindow) {
    const selector = 'builtin:kubernetes.workload.pods:splitBy("k8s.namespace.name"):avg';
    const params = new URLSearchParams({
      metricSelector: selector,
      from: `now-${fromWindow}`,
      resolution: "Inf"
    });
    const payload = await this.requestMetrics(params);
    const namespaces = /* @__PURE__ */ new Set();
    for (const result of payload.result ?? []) {
      for (const series of result.data ?? []) {
        const map = series.dimensionMap ?? {};
        const namespace = map["k8s.namespace.name"] ?? this.findDimensionByNeedle(map, "namespace") ?? series.dimensions[0];
        if (namespace) {
          namespaces.add(namespace);
        }
      }
    }
    return [...namespaces].sort();
  }
};

// src/domain/recommendations.ts
var toKey = (namespace, workload) => `${namespace}::${workload}`;
var mean = (values) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};
var percentile = (values, p) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p / 100 * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
};
var classifyUtilization = (ratio, overThreshold, underThreshold) => {
  if (!Number.isFinite(ratio) || ratio <= 0) return "unknown";
  if (ratio < overThreshold) return "over-provisioned";
  if (ratio > underThreshold) return "under-provisioned";
  return "balanced";
};
var inferKind = (kind) => {
  const normalized = kind.trim().toLowerCase();
  if (normalized.includes("deployment")) return "deployment";
  if (normalized.includes("stateful")) return "statefulset";
  if (normalized.includes("daemon")) return "daemonset";
  if (normalized.includes("cron")) return "cronjob";
  if (normalized === "job") return "job";
  return "other";
};
var mergeMetrics = (datasets) => {
  debug("mergeMetrics start", {
    cpuUsage: datasets.cpuUsage.length,
    memoryUsage: datasets.memoryUsage.length,
    cpuRequest: datasets.cpuRequest.length,
    memoryRequest: datasets.memoryRequest.length,
    podCount: datasets.podCount.length
  });
  const map = /* @__PURE__ */ new Map();
  const all = [datasets.cpuUsage, datasets.memoryUsage, datasets.cpuRequest, datasets.memoryRequest, datasets.podCount].flat();
  for (const item of all) {
    const key = toKey(item.namespace, item.workload);
    if (!map.has(key)) {
      map.set(key, {
        namespace: item.namespace,
        workload: item.workload,
        workloadKind: inferKind(item.workloadKind),
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
      const key = toKey(point.namespace, point.workload);
      const row = map.get(key);
      if (!row) continue;
      row[field].push(...point.values);
    }
  };
  fill(datasets.cpuUsage, "cpuUsage");
  fill(datasets.memoryUsage, "memoryUsage");
  fill(datasets.cpuRequest, "cpuRequest");
  fill(datasets.memoryRequest, "memoryRequest");
  fill(datasets.podCount, "podCount");
  const merged = [...map.values()];
  debug("mergeMetrics end", { workloads: merged.length });
  return merged;
};
var generateRecommendations = (workloads, config) => {
  debug("generateRecommendations start", { workloads: workloads.length });
  const results = workloads.map((workload) => {
    const pCpuUsage = percentile(workload.cpuUsage, config.percentile);
    const pMemoryUsage = percentile(workload.memoryUsage, config.percentile);
    const currentCpuRequest = mean(workload.cpuRequest);
    const currentMemoryRequest = mean(workload.memoryRequest);
    const currentReplicas = Math.max(1, Math.round(mean(workload.podCount)));
    const recommendedCpuRequest = pCpuUsage * config.cpuHeadroomMultiplier;
    const recommendedMemoryRequest = pMemoryUsage * Math.max(1.3, config.memoryHeadroomMultiplier);
    const cpuRatio = currentCpuRequest > 0 ? pCpuUsage / currentCpuRequest : 0;
    const memoryRatio = currentMemoryRequest > 0 ? pMemoryUsage / currentMemoryRequest : 0;
    const cpuStatus = classifyUtilization(
      cpuRatio,
      config.cpuOverProvisionedThreshold,
      config.cpuUnderProvisionedThreshold
    );
    const memoryStatus = classifyUtilization(
      memoryRatio,
      config.memoryOverProvisionedThreshold,
      config.memoryUnderProvisionedThreshold
    );
    let recommendedReplicas = currentReplicas;
    let replicaAction = "keep";
    if (workload.workloadKind === "deployment") {
      const targetCpuPerPod = Math.max(1e-9, recommendedCpuRequest);
      const totalLoad = pCpuUsage * currentReplicas;
      const supported = Math.max(1, Math.ceil(totalLoad / targetCpuPerPod));
      recommendedReplicas = Math.max(config.minReplicaFloor, supported);
      if (recommendedReplicas < currentReplicas) replicaAction = "scale-down";
      if (recommendedReplicas > currentReplicas) replicaAction = "scale-up";
    } else {
      replicaAction = "n/a";
    }
    return {
      namespace: workload.namespace,
      workload: workload.workload,
      workloadKind: workload.workloadKind,
      pCpuUsage,
      pMemoryUsage,
      currentCpuRequest,
      currentMemoryRequest,
      currentReplicas,
      recommendedCpuRequest,
      recommendedMemoryRequest,
      recommendedReplicas,
      cpuStatus,
      memoryStatus,
      replicaAction
    };
  }).sort((a, b) => a.namespace.localeCompare(b.namespace) || a.workload.localeCompare(b.workload));
  debug("generateRecommendations end", { recommendations: results.length });
  return results;
};
var summarizeByNamespace = (rows) => {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const entry = map.get(row.namespace) ?? {
      namespace: row.namespace,
      workloadCount: 0,
      overProvisionedCount: 0,
      underProvisionedCount: 0,
      totalCpuWaste: 0,
      totalMemoryWaste: 0
    };
    entry.workloadCount += 1;
    if (row.cpuStatus === "over-provisioned" || row.memoryStatus === "over-provisioned") {
      entry.overProvisionedCount += 1;
    }
    if (row.cpuStatus === "under-provisioned" || row.memoryStatus === "under-provisioned") {
      entry.underProvisionedCount += 1;
    }
    entry.totalCpuWaste += Math.max(0, row.currentCpuRequest - row.pCpuUsage);
    entry.totalMemoryWaste += Math.max(0, row.currentMemoryRequest - row.pMemoryUsage);
    map.set(row.namespace, entry);
  }
  return [...map.values()].sort((a, b) => {
    const wasteA = a.totalCpuWaste + a.totalMemoryWaste;
    const wasteB = b.totalCpuWaste + b.totalMemoryWaste;
    return wasteB - wasteA;
  });
};

// src/report/html.ts
import { writeFile } from "fs/promises";
import { resolve as resolve2 } from "path";
var f = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "N/A";
var writeReport = async (args) => {
  debug("writeReport start", { outputPath: args.outputPath, rows: args.recommendations.length });
  const abs = resolve2(args.outputPath);
  const summaryRows = args.summary.map(
    (row) => `<tr>
<td>${row.namespace}</td>
<td>${row.workloadCount}</td>
<td>${row.overProvisionedCount}</td>
<td>${row.underProvisionedCount}</td>
<td>${f(row.totalCpuWaste)}</td>
<td>${f(row.totalMemoryWaste / (1024 * 1024 * 1024), 3)}</td>
</tr>`
  ).join("\n");
  const detailRows = args.recommendations.map((row) => {
    const lowUtilization = row.cpuStatus === "over-provisioned" || row.memoryStatus === "over-provisioned";
    return `<tr data-low-utilization="${lowUtilization ? "true" : "false"}">
<td>${row.namespace}</td>
<td>${row.workload}</td>
<td>${row.workloadKind}</td>
<td>${f(row.pCpuUsage)}</td>
<td>${f(row.currentCpuRequest)}</td>
<td>${f(row.recommendedCpuRequest)}</td>
<td>${row.cpuStatus}</td>
<td>${f(row.pMemoryUsage)}</td>
<td>${f(row.currentMemoryRequest)}</td>
<td>${f(row.recommendedMemoryRequest)}</td>
<td>${row.memoryStatus}</td>
<td>${row.currentReplicas}</td>
<td>${row.recommendedReplicas}</td>
<td>${row.replicaAction}</td>
</tr>`;
  }).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Ops Pod Optimization Report</title>
<style>
:root{--bg:#f5f7fb;--card:#fff;--line:#d7dfeb;--text:#12243b;--muted:#4b607b;--accent:#0d6efd}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text)}
main{max-width:1300px;margin:24px auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
h1,h2{margin:0 0 10px 0}.meta{color:var(--muted);font-size:.9rem;display:grid;gap:3px}
button{border:1px solid var(--line);background:#eef4ff;color:#08346f;padding:8px 10px;border-radius:8px;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{padding:8px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:left}
th{background:#eff4fd;position:sticky;top:0}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}
</style>
</head>
<body>
<main>
<section class="card">
<h1>CPU, Memory and Pod Sizing Optimization Report</h1>
<div class="meta">
<div>Generated at (UTC): ${(/* @__PURE__ */ new Date()).toISOString()}</div>
<div>Time window: ${args.config.timeWindow}</div>
<div>Namespaces: ${args.config.namespaces.join(", ")}</div>
<div>Percentile: p${args.config.percentile} | CPU headroom: ${args.config.cpuHeadroomMultiplier} | Memory headroom: ${Math.max(1.3, args.config.memoryHeadroomMultiplier)}</div>
</div>
</section>
<section class="card">
<h2>Namespace Summary (Ranked by Waste)</h2>
<div class="table-wrap">
<table><thead><tr><th>Namespace</th><th>Workloads</th><th>Over-Provisioned</th><th>Under-Provisioned</th><th>CPU Waste</th><th>Memory Waste (GB)</th></tr></thead><tbody>${summaryRows}</tbody></table>
</div>
</section>
<section class="card">
<h2>Workload Recommendations</h2>
<button id="toggle-low">Toggle Low-Utilization Only</button>
<div class="table-wrap" style="margin-top:10px">
<table id="details">
<thead><tr><th>Namespace</th><th>Workload</th><th>Kind</th><th>CPU pN</th><th>CPU Req</th><th>CPU Reco</th><th>CPU Status</th><th>Mem pN</th><th>Mem Req</th><th>Mem Reco</th><th>Mem Status</th><th>Replicas</th><th>Reco Replicas</th><th>Action</th></tr></thead>
<tbody>${detailRows}</tbody>
</table>
</div>
</section>
</main>
<script>
(() => {
  const defaultLow = ${args.filter === "low-utilization" ? "true" : "false"};
  let onlyLow = defaultLow;
  const table = document.getElementById('details');
  const btn = document.getElementById('toggle-low');
  const apply = () => {
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      const isLow = row.getAttribute('data-low-utilization') === 'true';
      row.style.display = onlyLow && !isLow ? 'none' : '';
    });
  };
  btn.addEventListener('click', () => { onlyLow = !onlyLow; apply(); });
  apply();
})();
</script>
</body>
</html>`;
  await writeFile(abs, html, "utf8");
  debug("writeReport end", { abs });
  return abs;
};

// src/index.ts
var VERSION = "0.2.0";
var run = async (argv) => {
  debug("run start", { argv });
  const program = new Command();
  program.name("ops-pod-opt").description("Dynatrace-backed CPU, memory, and pod sizing optimizer").version(VERSION).option("-c, --config <path>", "config file path", "config.yaml").option("-w, --window <window>", "override time window, e.g. 7d or 24h").option("-o, --output <path>", "override output report path").option("--filter <mode>", "report default filter: all | low-utilization", "all").option("--discover-namespaces", "list namespaces visible in Dynatrace and exit");
  program.parse(argv);
  const opts = program.opts();
  if (opts.filter !== "all" && opts.filter !== "low-utilization") {
    throw new Error(`Invalid --filter value: ${opts.filter}`);
  }
  const config = await loadConfig(opts.config, {
    window: opts.window,
    outputPath: opts.output
  });
  const client = new DynatraceClient(config.endpoint, config.apiToken);
  if (opts.discoverNamespaces) {
    const namespaces = await client.discoverNamespaces(config.timeWindow);
    if (namespaces.length === 0) {
      console.log("No namespaces discovered.");
      return;
    }
    console.log("Discovered namespaces:");
    for (const namespace of namespaces) {
      console.log(`- ${namespace}`);
    }
    return;
  }
  const [cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount] = await Promise.all([
    client.queryMetric("cpuUsage", config.timeWindow, config.namespaces),
    client.queryMetric("memoryUsage", config.timeWindow, config.namespaces),
    client.queryMetric("cpuRequest", config.timeWindow, config.namespaces),
    client.queryMetric("memoryRequest", config.timeWindow, config.namespaces),
    client.queryMetric("podCount", config.timeWindow, config.namespaces)
  ]);
  const workloads = mergeMetrics({
    cpuUsage,
    memoryUsage,
    cpuRequest,
    memoryRequest,
    podCount
  });
  const recommendations = generateRecommendations(workloads, config);
  const summary = summarizeByNamespace(recommendations);
  const reportPath = await writeReport({
    outputPath: config.outputPath,
    config,
    recommendations,
    summary,
    filter: opts.filter
  });
  console.log(`Recommendations generated: ${recommendations.length}`);
  console.log(`Report written to: ${reportPath}`);
  debug("run end", { recommendations: recommendations.length, reportPath });
};
var main = async () => {
  try {
    await run(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
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
