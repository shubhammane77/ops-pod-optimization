// src/index.ts
// Phase 1 stub: prints version. Full CLI wired in Phase 9.
// Does NOT auto-execute on import — uses explicit main() guard.

const VERSION = '0.1.0';

export function main(): void {
  console.log(`ops-pod-opt v${VERSION}`);
  console.log('Run with --help for usage (available after Phase 9).');
}

// Only execute when run directly, not when imported by tests
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
