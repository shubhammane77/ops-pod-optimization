import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from 'node:process';
import yaml from 'js-yaml';
import { debug } from '../debug.js';
import { AppConfigSchema, type AppConfig, type ConfigOverrides } from './types.js';

const parseByExtension = (raw: string, path: string): unknown => {
  debug('parseByExtension start', { path });
  if (path.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    debug('parseByExtension end', { format: 'json' });
    return parsed;
  }
  const parsed = yaml.load(raw);
  debug('parseByExtension end', { format: 'yaml' });
  return parsed;
};

export const loadConfig = async (configPath: string, overrides?: ConfigOverrides): Promise<AppConfig> => {
  debug('loadConfig start', { configPath, overrides });
  const absPath = resolve(configPath);

  let raw: string;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (error) {
    debug('loadConfig readFile failed', { absPath, error });
    throw new Error(`Config file not found: ${absPath}`);
  }

  let parsed: unknown;
  try {
    parsed = parseByExtension(raw, absPath);
  } catch (error) {
    debug('loadConfig parse failed', { absPath, error });
    throw new Error(`Invalid config format in ${absPath}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    debug('loadConfig invalid parsed type', { parsedType: typeof parsed });
    throw new Error(`Invalid config format in ${absPath}`);
  }

  const configInput = { ...(parsed as Record<string, unknown>) };

  if (overrides?.window) {
    debug('loadConfig applying window override', { window: overrides.window });
    configInput.timeWindow = overrides.window;
  }

  if (overrides?.outputPath) {
    debug('loadConfig applying outputPath override', { outputPath: overrides.outputPath });
    configInput.outputPath = overrides.outputPath;
  }

  if (typeof env.DYNATRACE_API_TOKEN === 'string' && env.DYNATRACE_API_TOKEN.trim().length > 0) {
    configInput.apiToken = env.DYNATRACE_API_TOKEN.trim();
    debug('DYNATRACE_API_TOKEN env override applied');
  }

  let config: AppConfig;
  try {
    config = AppConfigSchema.parse(configInput);
  } catch (error) {
    debug('loadConfig schema validation failed', { error });
    throw error;
  }

  if (!config.apiToken) {
    debug('loadConfig missing api token after merge');
    throw new Error('apiToken is required in config file unless DYNATRACE_API_TOKEN is set');
  }

  debug('loadConfig end', {
    endpoint: config.endpoint,
    namespaces: config.namespaces.length,
    timeWindow: config.timeWindow,
  });
  return config;
};
