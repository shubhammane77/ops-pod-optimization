import { z } from 'zod';

export const AppConfigSchema = z.object({
  endpoint: z.string().url(),
  apiToken: z.string().optional().default(''),
  namespaces: z.array(z.string().min(1)).min(1),
  timeWindow: z.string().regex(/^\d+[dh]$/).default('7d'),
  percentile: z.number().int().min(50).max(99).default(90),
  cpuHeadroomMultiplier: z.number().min(1).default(1.1),
  memoryHeadroomMultiplier: z.number().min(1.3).default(1.3),
  cpuOverProvisionedThreshold: z.number().min(0.1).max(0.9).default(0.6),
  cpuUnderProvisionedThreshold: z.number().min(0.5).max(1).default(0.9),
  memoryOverProvisionedThreshold: z.number().min(0.1).max(0.9).default(0.6),
  memoryUnderProvisionedThreshold: z.number().min(0.5).max(1).default(0.9),
  minReplicaFloor: z.number().int().min(1).default(2),
  outputPath: z.string().min(1).default('./report.html'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export interface ConfigOverrides {
  window?: string;
  outputPath?: string;
}
