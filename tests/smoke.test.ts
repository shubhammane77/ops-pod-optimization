// tests/smoke.test.ts
// Verifies the ESM import chain works end-to-end.
// If any import fails with ERR_MODULE_NOT_FOUND, the ESM config is broken.
import { describe, it, expect } from 'vitest';

describe('build smoke test', () => {
  it('can import src/index.ts without resolution errors', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.main).toBe('function');
    expect(typeof mod.run).toBe('function');
  });

  it('run() fails fast on missing config path', async () => {
    const { run } = await import('../src/index.js');
    await expect(run(['node', 'ops-pod-opt', '--config', './missing-config.yaml'])).rejects.toThrow(
      /Config file not found/,
    );
  });
});
