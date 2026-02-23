export type WorkloadKind = 'deployment' | 'statefulset' | 'daemonset' | 'cronjob' | 'other';

export interface AppConfig {
  endpoint: string;
  apiToken: string;
  namespaces: string[];
  timeWindow: string;
  percentile: number;
  cpuHeadroomMultiplier: number;
  memoryHeadroomMultiplier: number;
  cpuOverProvisionedThreshold: number;
  cpuUnderProvisionedThreshold: number;
  memoryOverProvisionedThreshold: number;
  memoryUnderProvisionedThreshold: number;
  minReplicaFloor: number;
  outputPath: string;
  metrics: {
    cpuUsage: string;
    memoryUsage: string;
    cpuRequest: string;
    memoryRequest: string;
    podCount: string;
  };
}

export interface WorkloadSample {
  namespace: string;
  workload: string;
  workloadKind: WorkloadKind;
  cpuUsage: number[];
  memoryUsage: number[];
  cpuRequest: number[];
  memoryRequest: number[];
  podCount: number[];
}

export interface WorkloadRecommendation {
  namespace: string;
  workload: string;
  workloadKind: WorkloadKind;
  currentCpuRequest: number;
  currentMemoryRequest: number;
  currentReplicas: number;
  pCpuUsage: number;
  pMemoryUsage: number;
  recommendedCpuRequest: number;
  recommendedMemoryRequest: number;
  recommendedReplicas: number;
  cpuUtilizationVsRequest: number;
  memoryUtilizationVsRequest: number;
  cpuStatus: 'over-provisioned' | 'under-provisioned' | 'balanced' | 'unknown';
  memoryStatus: 'over-provisioned' | 'under-provisioned' | 'balanced' | 'unknown';
  replicaAction: 'scale-down' | 'scale-up' | 'keep' | 'n/a';
}
