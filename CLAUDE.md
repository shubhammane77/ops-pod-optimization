# Project Guidelines: ops-pod-opt

## Debug Logging

**Every significant step must emit a debug log.** Use the `DEBUG` env var pattern:

```ts
// src/debug.ts — single shared utility
import { env } from 'node:process';
export const debug = (...args: unknown[]) => {
  if (env.DEBUG) console.debug('[debug]', ...args);
};
```

Import and use in every module:
```ts
import { debug } from '../debug.js';

debug('Loading config from', filePath);
debug('Config validated, endpoint:', config.endpoint);
debug('DYNATRACE_API_TOKEN env override applied');
```

**Where to add debug logs (minimum):**
- Start and end of every public function (with key params/results)
- Before and after every network/API call
- Each pagination step (page N fetched, nextPageKey present/absent)
- Config loading: file read, yaml parse, zod validate, env override
- Any error path before throwing

Usage: `DEBUG=true npx ops-pod-opt --config config.yaml`

## General

- POC first — no over-engineering
- Integrate directly with live Dynatrace API — no fixture data
- Keep modules small and focused
