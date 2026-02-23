import { describe, it, expect } from 'vitest';

describe('build smoke test', () => {
  it('can import src/index.ts without resolution errors', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.main).toBe('function');
    expect(typeof mod.run).toBe('function');
  });

  it('run() rejects for missing config file', async () => {
    const { run } = await import('../src/index.js');
    await expect(run(['node', 'ops-pod-opt', '--config', './missing-config.yaml'])).rejects.toThrow(
      /Config file not found/,
    );
  });
});
