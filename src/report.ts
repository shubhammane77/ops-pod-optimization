import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkloadRecommendation } from './types.js';
import { debug } from './debug.js';

const fmt = (n: number, digits = 2): string => (Number.isFinite(n) ? n.toFixed(digits) : 'n/a');

export const writeHtmlReport = (outputPath: string, rows: WorkloadRecommendation[]): string => {
  debug('writeHtmlReport start', { outputPath, rows: rows.length });
  const abs = resolve(outputPath);

  const bodyRows = rows
    .map((r) => {
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
    })
    .join('\n');

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

  writeFileSync(abs, html, 'utf8');
  debug('writeHtmlReport end', { abs });
  return abs;
};
