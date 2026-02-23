// tests/smoke.test.ts
// Verifies the ESM import chain works end-to-end.
// If any import fails with ERR_MODULE_NOT_FOUND, the ESM config is broken.
import { describe, it, expect } from 'vitest';

describe('build smoke test', () => {
  it('can import src/index.ts without resolution errors', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.main).toBe('function');
  });

  it('main() function is callable', async () => {
    const { main } = await import('../src/index.js');
    // Should not throw
    expect(() => main()).not.toThrow();
  });
});
