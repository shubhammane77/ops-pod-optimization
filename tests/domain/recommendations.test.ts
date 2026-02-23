import { describe, it, expect } from 'vitest';
import type { AppConfig } from '../../src/config/types.js';
import { generateRecommendations } from '../../src/domain/recommendations.js';
import type { WorkloadMetrics } from '../../src/domain/types.js';

const cfg: AppConfig = {
  endpoint: 'https://example.live.dynatrace.com/e/env',
  apiToken: 'token',
  namespaces: ['prod'],
  timeWindow: '7d',
  percentile: 90,
  cpuHeadroomMultiplier: 1.1,
  memoryHeadroomMultiplier: 1.3,
  cpuOverProvisionedThreshold: 0.6,
  cpuUnderProvisionedThreshold: 0.9,
  memoryOverProvisionedThreshold: 0.6,
  memoryUnderProvisionedThreshold: 0.9,
  minReplicaFloor: 2,
  outputPath: './report.html',
};

describe('generateRecommendations', () => {
  it('applies replica floor only to deployments', () => {
    const rows: WorkloadMetrics[] = [
      {
        namespace: 'prod',
        workload: 'api',
        workloadKind: 'deployment',
        cpuUsage: [0.2, 0.3, 0.2],
        memoryUsage: [100, 120, 110],
        cpuRequest: [1, 1, 1],
        memoryRequest: [500, 500, 500],
        podCount: [6, 6, 6],
      },
      {
        namespace: 'prod',
        workload: 'db',
        workloadKind: 'statefulset',
        cpuUsage: [0.8, 0.9, 0.95],
        memoryUsage: [900, 950, 970],
        cpuRequest: [1, 1, 1],
        memoryRequest: [1000, 1000, 1000],
        podCount: [3, 3, 3],
      },
    ];

    const rec = generateRecommendations(rows, cfg);
    const api = rec.find((x) => x.workload === 'api');
    const db = rec.find((x) => x.workload === 'db');

    expect(api).toBeDefined();
    expect(api?.recommendedReplicas).toBeGreaterThanOrEqual(2);
    expect(db?.replicaAction).toBe('n/a');
  });
});
