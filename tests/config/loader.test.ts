import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';

const tempPaths: string[] = [];

afterEach(async () => {
  delete process.env.DYNATRACE_API_TOKEN;
  for (const path of tempPaths.splice(0, tempPaths.length)) {
    await rm(path, { recursive: true, force: true });
  }
});

const writeTempConfig = async (content: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'ops-pod-opt-'));
  tempPaths.push(dir);
  const path = join(dir, 'config.yaml');
  await writeFile(path, content, 'utf8');
  return path;
};

describe('loadConfig', () => {
  it('loads a valid minimal config and applies defaults', async () => {
    const path = await writeTempConfig(`endpoint: "https://example.live.dynatrace.com/e/env"
apiToken: "file-token"
namespaces:
  - production
`);

    const config = await loadConfig(path);
    expect(config.endpoint).toContain('dynatrace');
    expect(config.apiToken).toBe('file-token');
    expect(config.namespaces).toEqual(['production']);
    expect(config.timeWindow).toBe('7d');
    expect(config.percentile).toBe(90);
  });

  it('DYNATRACE_API_TOKEN env var overrides file token', async () => {
    const path = await writeTempConfig(`endpoint: "https://example.live.dynatrace.com/e/env"
apiToken: "file-token"
namespaces:
  - prod
`);

    process.env.DYNATRACE_API_TOKEN = 'env-token';
    const config = await loadConfig(path);
    expect(config.apiToken).toBe('env-token');
  });

  it('throws for missing required field', async () => {
    const path = await writeTempConfig(`apiToken: "x"
namespaces:
  - prod
`);
    await expect(loadConfig(path)).rejects.toThrow();
  });

  it('throws for memoryHeadroomMultiplier below 1.30', async () => {
    const path = await writeTempConfig(`endpoint: "https://example.live.dynatrace.com/e/env"
apiToken: "x"
namespaces:
  - prod
memoryHeadroomMultiplier: 1.2
`);
    await expect(loadConfig(path)).rejects.toThrow();
  });
});
