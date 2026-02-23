# ops-pod-opt

Dynatrace-backed CLI POC for CPU, memory, and pod sizing optimization.

## Run Commands

### 1. Install dependencies

```bash
npm install
```

### 2. Typecheck

```bash
npm run typecheck
```

### 3. Run tests

```bash
npm test
```

### 4. Build CLI bundle

```bash
npm run build
```

### 5. Run in dev mode (with config)

```bash
npm run dev -- --config config.yaml
```

### 6. Run with debug logs from CLI input

```bash
npm run dev -- --config config.yaml --debug
```

### 7. Override analysis window

```bash
npm run dev -- --config config.yaml --window 7d
```

### 8. Discover namespaces from Dynatrace

```bash
npm run dev -- --config config.yaml --discover-namespaces
```

### 9. Generate report to a custom output path

```bash
npm run dev -- --config config.yaml --output ./report.html
```

## Config Setup

1. Copy example config:

```bash
cp config.example.yaml config.yaml
```

2. Update `config.yaml` values:
- `endpoint`
- `apiToken` (or set `DYNATRACE_API_TOKEN`)
- `namespaces`

3. Run:

```bash
npm run dev -- --config config.yaml --debug
```

Output report is written to `outputPath` (default: `./report.html`).
