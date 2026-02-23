#!/usr/bin/env node

// src/index.ts
var VERSION = "0.1.0";
function main() {
  console.log(`ops-pod-opt v${VERSION}`);
  console.log("Run with --help for usage (available after Phase 9).");
}
var isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
export {
  main
};
