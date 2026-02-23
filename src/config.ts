import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from 'node:process';
import yaml from 'js-yaml';
import { z } from 'zod';
import { debug } from './debug.js';
import type { AppConfig } from './types.js';

const metricsSchema = z
  .object({
    cpuUsage: z.string().min(1).default('builtin:kubernetes.workload.cpu_usage'),
    memoryUsage: z.string().min(1).default('builtin:kubernetes.workload.memory_working_set'),
    cpuRequest: z.string().min(1).default('builtin:kubernetes.workload.requests_cpu'),
    memoryRequest: z.string().min(1).default('builtin:kubernetes.workload.requests_memory'),
    podCount: z.string().min(1).default('builtin:kubernetes.workload.pods'),
  })
  .default({
    cpuUsage: 'builtin:kubernetes.workload.cpu_usage',
    memoryUsage: 'builtin:kubernetes.workload.memory_working_set',
    cpuRequest: 'builtin:kubernetes.workload.requests_cpu',
    memoryRequest: 'builtin:kubernetes.workload.requests_memory',
    podCount: 'builtin:kubernetes.workload.pods',
  });

const configSchema = z.object({
  endpoint: z.string().url(),
  apiToken: z.string().min(1),
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
  metrics: metricsSchema,
});

export const loadConfig = (configPath: string, windowOverride?: string): AppConfig => {
  debug('loadConfig start', { configPath, windowOverride });
  const absPath = resolve(configPath);
  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }

  debug('reading config file', absPath);
  const raw = readFileSync(absPath, 'utf8');
  debug('parsing yaml');
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid config YAML in ${absPath}`);
  }

  const input = parsed as Record<string, unknown>;
  if (windowOverride) {
    debug('applying --window override', windowOverride);
    input.timeWindow = windowOverride;
  }

  if (env.DYNATRACE_API_TOKEN) {
    debug('DYNATRACE_API_TOKEN env override applied');
    input.apiToken = env.DYNATRACE_API_TOKEN;
  }

  debug('validating config schema');
  const cfg = configSchema.parse(input);
  debug('loadConfig end', { endpoint: cfg.endpoint, namespaceCount: cfg.namespaces.length });
  return cfg;
};
