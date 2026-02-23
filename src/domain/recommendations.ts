import type { AppConfig } from '../config/types.js';
import { debug } from '../debug.js';
import type { NamespaceSummary, WorkloadMetrics, WorkloadRecommendation, WorkloadKind } from './types.js';

const toKey = (namespace: string, workload: string): string => `${namespace}::${workload}`;

const mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
};

const classifyUtilization = (
  ratio: number,
  overThreshold: number,
  underThreshold: number,
): WorkloadRecommendation['cpuStatus'] => {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'unknown';
  if (ratio < overThreshold) return 'over-provisioned';
  if (ratio > underThreshold) return 'under-provisioned';
  return 'balanced';
};

const inferKind = (kind: string): WorkloadKind => {
  const normalized = kind.trim().toLowerCase();
  if (normalized.includes('deployment')) return 'deployment';
  if (normalized.includes('stateful')) return 'statefulset';
  if (normalized.includes('daemon')) return 'daemonset';
  if (normalized.includes('cron')) return 'cronjob';
  if (normalized === 'job') return 'job';
  return 'other';
};

export const mergeMetrics = (datasets: {
  cpuUsage: Array<{ namespace: string; workload: string; workloadKind: string; values: number[] }>;
  memoryUsage: Array<{ namespace: string; workload: string; workloadKind: string; values: number[] }>;
  cpuRequest: Array<{ namespace: string; workload: string; workloadKind: string; values: number[] }>;
  memoryRequest: Array<{ namespace: string; workload: string; workloadKind: string; values: number[] }>;
  podCount: Array<{ namespace: string; workload: string; workloadKind: string; values: number[] }>;
}): WorkloadMetrics[] => {
  debug('mergeMetrics start', {
    cpuUsage: datasets.cpuUsage.length,
    memoryUsage: datasets.memoryUsage.length,
    cpuRequest: datasets.cpuRequest.length,
    memoryRequest: datasets.memoryRequest.length,
    podCount: datasets.podCount.length,
  });

  const map = new Map<string, WorkloadMetrics>();
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
        podCount: [],
      });
    }
  }

  const fill = (
    points: Array<{ namespace: string; workload: string; values: number[] }>,
    field: keyof Pick<WorkloadMetrics, 'cpuUsage' | 'memoryUsage' | 'cpuRequest' | 'memoryRequest' | 'podCount'>,
  ): void => {
    for (const point of points) {
      const key = toKey(point.namespace, point.workload);
      const row = map.get(key);
      if (!row) continue;
      row[field].push(...point.values);
    }
  };

  fill(datasets.cpuUsage, 'cpuUsage');
  fill(datasets.memoryUsage, 'memoryUsage');
  fill(datasets.cpuRequest, 'cpuRequest');
  fill(datasets.memoryRequest, 'memoryRequest');
  fill(datasets.podCount, 'podCount');

  const merged = [...map.values()];
  debug('mergeMetrics end', { workloads: merged.length });
  return merged;
};

export const generateRecommendations = (workloads: WorkloadMetrics[], config: AppConfig): WorkloadRecommendation[] => {
  debug('generateRecommendations start', { workloads: workloads.length });
  const results = workloads
    .map((workload) => {
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
        config.cpuUnderProvisionedThreshold,
      );
      const memoryStatus = classifyUtilization(
        memoryRatio,
        config.memoryOverProvisionedThreshold,
        config.memoryUnderProvisionedThreshold,
      );

      let recommendedReplicas = currentReplicas;
      let replicaAction: WorkloadRecommendation['replicaAction'] = 'keep';

      if (workload.workloadKind === 'deployment') {
        const targetCpuPerPod = Math.max(1e-9, recommendedCpuRequest);
        const totalLoad = pCpuUsage * currentReplicas;
        const supported = Math.max(1, Math.ceil(totalLoad / targetCpuPerPod));
        recommendedReplicas = Math.max(config.minReplicaFloor, supported);
        if (recommendedReplicas < currentReplicas) replicaAction = 'scale-down';
        if (recommendedReplicas > currentReplicas) replicaAction = 'scale-up';
      } else {
        replicaAction = 'n/a';
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
        replicaAction,
      } satisfies WorkloadRecommendation;
    })
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.workload.localeCompare(b.workload));

  debug('generateRecommendations end', { recommendations: results.length });
  return results;
};

export const summarizeByNamespace = (rows: WorkloadRecommendation[]): NamespaceSummary[] => {
  debug('summarizeByNamespace start', { rows: rows.length });
  const map = new Map<string, NamespaceSummary>();

  for (const row of rows) {
    const entry = map.get(row.namespace) ?? {
      namespace: row.namespace,
      workloadCount: 0,
      overProvisionedCount: 0,
      underProvisionedCount: 0,
      totalCpuWaste: 0,
      totalMemoryWaste: 0,
    };

    entry.workloadCount += 1;
    if (row.cpuStatus === 'over-provisioned' || row.memoryStatus === 'over-provisioned') {
      entry.overProvisionedCount += 1;
    }
    if (row.cpuStatus === 'under-provisioned' || row.memoryStatus === 'under-provisioned') {
      entry.underProvisionedCount += 1;
    }

    entry.totalCpuWaste += Math.max(0, row.currentCpuRequest - row.pCpuUsage);
    entry.totalMemoryWaste += Math.max(0, row.currentMemoryRequest - row.pMemoryUsage);

    map.set(row.namespace, entry);
  }

  const out = [...map.values()].sort((a, b) => {
    const wasteA = a.totalCpuWaste + a.totalMemoryWaste;
    const wasteB = b.totalCpuWaste + b.totalMemoryWaste;
    return wasteB - wasteA;
  });

  debug('summarizeByNamespace end', { namespaces: out.length });
  return out;
};
