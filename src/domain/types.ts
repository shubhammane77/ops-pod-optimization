export type WorkloadKind = 'deployment' | 'statefulset' | 'daemonset' | 'cronjob' | 'job' | 'other';

export interface WorkloadMetrics {
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
  pCpuUsage: number;
  pMemoryUsage: number;
  currentCpuRequest: number;
  currentMemoryRequest: number;
  currentReplicas: number;
  recommendedCpuRequest: number;
  recommendedMemoryRequest: number;
  recommendedReplicas: number;
  cpuStatus: 'over-provisioned' | 'under-provisioned' | 'balanced' | 'unknown';
  memoryStatus: 'over-provisioned' | 'under-provisioned' | 'balanced' | 'unknown';
  replicaAction: 'scale-down' | 'scale-up' | 'keep' | 'n/a';
}

export interface NamespaceSummary {
  namespace: string;
  workloadCount: number;
  overProvisionedCount: number;
  underProvisionedCount: number;
  totalCpuWaste: number;
  totalMemoryWaste: number;
}
