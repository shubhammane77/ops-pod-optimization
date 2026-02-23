import { debug } from '../debug.js';
import type { PodMetricPoint } from '../dynatrace/client.js';

export interface PodInventoryRow {
  namespace: string;
  pod: string;
  avgCpuMillicores: number;
  p90CpuMillicores: number;
  cpuLimitMillicores: number;
  cpuLimitUtilizationP90Pct: number;
  avgMemoryBytes: number;
  p90MemoryBytes: number;
  memoryLimitBytes: number;
  memoryLimitUtilizationP90Pct: number;
  sampleCount: number;
}

const keyFor = (namespace: string, pod: string): string => `${namespace}::${pod}`;

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

const mergeByPod = (rows: PodMetricPoint[]): Map<string, number[]> => {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const key = keyFor(row.namespace, row.pod);
    const existing = map.get(key) ?? [];
    existing.push(...row.values);
    map.set(key, existing);
  }
  return map;
};

export const buildPodInventory = (args: {
  namespace: string;
  cpuUsage: PodMetricPoint[];
  memoryUsage: PodMetricPoint[];
  cpuLimit: PodMetricPoint[];
  memoryLimit: PodMetricPoint[];
}): PodInventoryRow[] => {
  debug('buildPodInventory start', {
    namespace: args.namespace,
    cpuUsage: args.cpuUsage.length,
    memoryUsage: args.memoryUsage.length,
    cpuLimit: args.cpuLimit.length,
    memoryLimit: args.memoryLimit.length,
  });

  const cpuMap = mergeByPod(args.cpuUsage);
  const memMap = mergeByPod(args.memoryUsage);
  const cpuLimitMap = mergeByPod(args.cpuLimit);
  const memLimitMap = mergeByPod(args.memoryLimit);

  const podKeys = new Set<string>([
    ...cpuMap.keys(),
    ...memMap.keys(),
    ...cpuLimitMap.keys(),
    ...memLimitMap.keys(),
  ]);

  const rows: PodInventoryRow[] = [];
  for (const key of podKeys) {
    const [, pod] = key.split('::');
    const cpuValues = cpuMap.get(key) ?? [];
    const memValues = memMap.get(key) ?? [];
    const cpuLimitValues = cpuLimitMap.get(key) ?? [];
    const memLimitValues = memLimitMap.get(key) ?? [];

    const avgCpuMillicores = mean(cpuValues);
    const p90CpuMillicores = percentile(cpuValues, 90);
    const cpuLimitMillicores = mean(cpuLimitValues);
    const avgMemoryBytes = mean(memValues);
    const p90MemoryBytes = percentile(memValues, 90);
    const memoryLimitBytes = mean(memLimitValues);

    const cpuLimitUtilizationP90Pct = cpuLimitMillicores > 0 ? (p90CpuMillicores / cpuLimitMillicores) * 100 : 0;
    const memoryLimitUtilizationP90Pct =
      memoryLimitBytes > 0 ? (p90MemoryBytes / memoryLimitBytes) * 100 : 0;

    rows.push({
      namespace: args.namespace,
      pod,
      avgCpuMillicores,
      p90CpuMillicores,
      cpuLimitMillicores,
      cpuLimitUtilizationP90Pct,
      avgMemoryBytes,
      p90MemoryBytes,
      memoryLimitBytes,
      memoryLimitUtilizationP90Pct,
      sampleCount: Math.max(cpuValues.length, memValues.length),
    });
  }

  const out = rows.sort((a, b) => a.pod.localeCompare(b.pod));
  debug('buildPodInventory end', { rows: out.length });
  return out;
};
