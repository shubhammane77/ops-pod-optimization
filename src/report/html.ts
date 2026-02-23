import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppConfig } from '../config/types.js';
import { debug } from '../debug.js';
import type { NamespaceSummary, WorkloadRecommendation } from '../domain/types.js';

const f = (value: number, digits = 2): string => (Number.isFinite(value) ? value.toFixed(digits) : 'N/A');

export const writeReport = async (args: {
  outputPath: string;
  config: AppConfig;
  recommendations: WorkloadRecommendation[];
  summary: NamespaceSummary[];
  filter: 'all' | 'low-utilization';
}): Promise<string> => {
  debug('writeReport start', { outputPath: args.outputPath, rows: args.recommendations.length });
  const abs = resolve(args.outputPath);

  const summaryRows = args.summary
    .map(
      (row) => `<tr>
<td>${row.namespace}</td>
<td>${row.workloadCount}</td>
<td>${row.overProvisionedCount}</td>
<td>${row.underProvisionedCount}</td>
<td>${f(row.totalCpuWaste)}</td>
<td>${f(row.totalMemoryWaste / (1024 * 1024 * 1024), 3)}</td>
</tr>`,
    )
    .join('\n');

  const detailRows = args.recommendations
    .map((row) => {
      const lowUtilization = row.cpuStatus === 'over-provisioned' || row.memoryStatus === 'over-provisioned';
      return `<tr data-low-utilization="${lowUtilization ? 'true' : 'false'}">
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
    })
    .join('\n');

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
<div>Generated at (UTC): ${new Date().toISOString()}</div>
<div>Time window: ${args.config.timeWindow}</div>
<div>Namespaces: ${args.config.namespaces.join(', ')}</div>
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
  const defaultLow = ${args.filter === 'low-utilization' ? 'true' : 'false'};
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

  await writeFile(abs, html, 'utf8');
  debug('writeReport end', { abs });
  return abs;
};
