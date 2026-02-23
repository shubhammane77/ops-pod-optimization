import { debug } from './debug.js';
import type { AppConfig, WorkloadRecommendation, WorkloadSample, WorkloadKind } from './types.js';

interface RawMetricPoint {
  namespace: string;
  workload: string;
  workloadKind: string;
  values: number[];
}

const sortAsc = (arr: number[]): number[] => [...arr].sort((a, b) => a - b);

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = sortAsc(values);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
};

const mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const workloadKindFromString = (value: string): WorkloadKind => {
  switch (value.toLowerCase()) {
    case 'deployment':
      return 'deployment';
    case 'statefulset':
      return 'statefulset';
    case 'daemonset':
      return 'daemonset';
    case 'cronjob':
      return 'cronjob';
    default:
      return 'other';
  }
};

const keyFor = (namespace: string, workload: string): string => `${namespace}::${workload}`;

export const mergeMetricPoints = (
  cpuUsage: RawMetricPoint[],
  memoryUsage: RawMetricPoint[],
  cpuRequest: RawMetricPoint[],
  memoryRequest: RawMetricPoint[],
  podCount: RawMetricPoint[],
): WorkloadSample[] => {
  debug('mergeMetricPoints start', {
    cpuUsage: cpuUsage.length,
    memoryUsage: memoryUsage.length,
    cpuRequest: cpuRequest.length,
    memoryRequest: memoryRequest.length,
    podCount: podCount.length,
  });

  const all = [cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount].flat();
  const map = new Map<string, WorkloadSample>();

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
        podCount: [],
      });
    }
  }

  const fill = (points: RawMetricPoint[], field: keyof Pick<WorkloadSample, 'cpuUsage' | 'memoryUsage' | 'cpuRequest' | 'memoryRequest' | 'podCount'>): void => {
    for (const point of points) {
      const key = keyFor(point.namespace, point.workload);
      const row = map.get(key);
      if (!row) continue;
      row[field].push(...point.values);
    }
  };

  fill(cpuUsage, 'cpuUsage');
  fill(memoryUsage, 'memoryUsage');
  fill(cpuRequest, 'cpuRequest');
  fill(memoryRequest, 'memoryRequest');
  fill(podCount, 'podCount');

  const merged = [...map.values()];
  debug('mergeMetricPoints end', { merged: merged.length });
  return merged;
};

const classify = (
  utilization: number,
  overThreshold: number,
  underThreshold: number,
): 'over-provisioned' | 'under-provisioned' | 'balanced' | 'unknown' => {
  if (!Number.isFinite(utilization) || utilization <= 0) return 'unknown';
  if (utilization < overThreshold) return 'over-provisioned';
  if (utilization > underThreshold) return 'under-provisioned';
  return 'balanced';
};

export const recommend = (samples: WorkloadSample[], config: AppConfig): WorkloadRecommendation[] => {
  debug('recommend start', { samples: samples.length, percentile: config.percentile });

  const results = samples
    .map((sample) => {
      const pCpuUsage = percentile(sample.cpuUsage, config.percentile);
      const pMemoryUsage = percentile(sample.memoryUsage, config.percentile);

      const currentCpuRequest = mean(sample.cpuRequest);
      const currentMemoryRequest = mean(sample.memoryRequest);
      const currentReplicas = Math.max(1, Math.round(mean(sample.podCount)));

      const recommendedCpuRequest = pCpuUsage * config.cpuHeadroomMultiplier;
      const recommendedMemoryRequest = pMemoryUsage * Math.max(1.3, config.memoryHeadroomMultiplier);

      const cpuUtilizationVsRequest =
        currentCpuRequest > 0 ? pCpuUsage / currentCpuRequest : 0;
      const memoryUtilizationVsRequest =
        currentMemoryRequest > 0 ? pMemoryUsage / currentMemoryRequest : 0;

      const cpuStatus = classify(
        cpuUtilizationVsRequest,
        config.cpuOverProvisionedThreshold,
        config.cpuUnderProvisionedThreshold,
      );

      const memoryStatus = classify(
        memoryUtilizationVsRequest,
        config.memoryOverProvisionedThreshold,
        config.memoryUnderProvisionedThreshold,
      );

      const perPodCapacity = Math.max(1e-9, Math.min(recommendedCpuRequest, currentCpuRequest || recommendedCpuRequest));
      const estimatedLoad = pCpuUsage * currentReplicas;
      const idealReplicas = Math.max(1, Math.ceil(estimatedLoad / perPodCapacity));

      let recommendedReplicas = currentReplicas;
      let replicaAction: WorkloadRecommendation['replicaAction'] = 'keep';

      if (sample.workloadKind === 'deployment') {
        recommendedReplicas = Math.max(config.minReplicaFloor, idealReplicas);
        if (recommendedReplicas < currentReplicas) replicaAction = 'scale-down';
        if (recommendedReplicas > currentReplicas) replicaAction = 'scale-up';
      } else {
        replicaAction = 'n/a';
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
        replicaAction,
      } satisfies WorkloadRecommendation;
    })
    .sort((a, b) =>
      a.namespace.localeCompare(b.namespace) || a.workload.localeCompare(b.workload),
    );

  debug('recommend end', { recommendations: results.length });
  return results;
};
