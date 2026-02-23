import { debug } from '../debug.js';

interface MetricsSeries {
  dimensions: string[];
  dimensionMap?: Record<string, string>;
  values: Array<number | null>;
}

interface MetricsResult {
  metricId: string;
  data: MetricsSeries[];
}

interface MetricsResponse {
  nextPageKey?: string;
  result: MetricsResult[];
}

interface NamespaceSeries {
  namespace: string;
}

export interface MetricPoint {
  namespace: string;
  workload: string;
  workloadKind: string;
  values: number[];
}

export class DynatraceClient {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(endpoint: string, token: string) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.token = token;
  }

  private async requestMetrics(params: URLSearchParams): Promise<MetricsResponse> {
    const url = `${this.endpoint}/api/v2/metrics/query?${params.toString()}`;
    debug('dynatrace request start', { url });

    const response = await fetch(url, {
      headers: {
        Authorization: `Api-Token ${this.token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      debug('dynatrace request failed', { status: response.status, body });
      throw new Error(`Dynatrace API error ${response.status}: ${body}`);
    }

    const payload = (await response.json()) as MetricsResponse;
    debug('dynatrace request end', {
      resultCount: payload.result?.length ?? 0,
      nextPageKey: payload.nextPageKey ?? null,
    });
    return payload;
  }

  private parseMetricSeries(payload: MetricsResponse, namespaces: string[]): MetricPoint[] {
    const out: MetricPoint[] = [];

    for (const metric of payload.result ?? []) {
      for (const series of metric.data ?? []) {
        const values = (series.values ?? []).filter((v): v is number => typeof v === 'number');
        if (values.length === 0) continue;

        const map = series.dimensionMap ?? {};

        const namespace =
          map['k8s.namespace.name'] ??
          map['dt.entity.cloud_application_namespace.name'] ??
          this.findDimensionByNeedle(map, 'namespace') ??
          'unknown';

        if (!namespaces.includes(namespace)) continue;

        const workload =
          map['k8s.workload.name'] ??
          map['dt.entity.cloud_application.name'] ??
          this.findDimensionByNeedle(map, 'workload') ??
          this.findDimensionByNeedle(map, 'cloud_application') ??
          series.dimensions.find((value) => value && value !== namespace) ??
          'unknown';

        const workloadKind =
          map['k8s.workload.kind'] ?? this.findDimensionByNeedle(map, 'kind') ?? this.inferKind(workload, map);

        out.push({ namespace, workload, workloadKind, values });
      }
    }

    return out;
  }

  private findDimensionByNeedle(map: Record<string, string>, needle: string): string | undefined {
    const match = Object.entries(map).find(([key]) => key.toLowerCase().includes(needle));
    return match?.[1];
  }

  private inferKind(workload: string, map: Record<string, string>): string {
    const blob = `${workload} ${Object.keys(map).join(' ')} ${Object.values(map).join(' ')}`.toLowerCase();
    if (blob.includes('deployment')) return 'deployment';
    if (blob.includes('stateful')) return 'statefulset';
    if (blob.includes('daemon')) return 'daemonset';
    if (blob.includes('cron')) return 'cronjob';
    if (blob.includes('job')) return 'job';
    return 'other';
  }

  private async queryWithSelector(selector: string, fromWindow: string, namespaces: string[]): Promise<MetricPoint[]> {
    debug('queryWithSelector start', { selector, fromWindow });
    const rows: MetricPoint[] = [];
    let page = 0;
    let nextPageKey: string | undefined;

    do {
      page += 1;
      const params = new URLSearchParams();
      if (nextPageKey) {
        params.set('nextPageKey', nextPageKey);
      } else {
        params.set('metricSelector', selector);
        params.set('from', `now-${fromWindow}`);
        params.set('resolution', fromWindow.endsWith('h') ? '1m' : '5m');
      }

      const payload = await this.requestMetrics(params);
      rows.push(...this.parseMetricSeries(payload, namespaces));
      nextPageKey = payload.nextPageKey;
      debug('queryWithSelector page', { selector, page, nextPageKey: nextPageKey ?? null, rows: rows.length });
    } while (nextPageKey);

    debug('queryWithSelector end', { selector, rows: rows.length });
    return rows;
  }

  async queryMetric(metricType: 'cpuUsage' | 'memoryUsage' | 'cpuRequest' | 'memoryRequest' | 'podCount', fromWindow: string, namespaces: string[]): Promise<MetricPoint[]> {
    const selectorsByType: Record<typeof metricType, string[]> = {
      cpuUsage: [
        'builtin:kubernetes.workload.cpu_usage:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
        'builtin:containers.cpu.usagePercent:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
      ],
      memoryUsage: [
        'builtin:kubernetes.workload.memory_working_set:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
        'builtin:containers.memory.residentMemoryBytes:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
      ],
      cpuRequest: [
        'builtin:kubernetes.workload.requests_cpu:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
      ],
      memoryRequest: [
        'builtin:kubernetes.workload.requests_memory:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
      ],
      podCount: [
        'builtin:kubernetes.workload.pods:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
      ],
    };

    const selectors = selectorsByType[metricType];
    const failures: string[] = [];

    for (const selector of selectors) {
      try {
        const rows = await this.queryWithSelector(selector, fromWindow, namespaces);
        if (rows.length > 0) {
          return rows;
        }
        failures.push(`${selector} (no matching data)`);
      } catch (error) {
        failures.push(`${selector} (${error instanceof Error ? error.message : String(error)})`);
      }
    }

    throw new Error(`No usable Dynatrace selector for ${metricType}. Attempts: ${failures.join(' | ')}`);
  }

  async discoverNamespaces(fromWindow: string): Promise<string[]> {
    const selector = 'builtin:kubernetes.workload.pods:splitBy("k8s.namespace.name"):avg';
    const params = new URLSearchParams({
      metricSelector: selector,
      from: `now-${fromWindow}`,
      resolution: 'Inf',
    });

    const payload = await this.requestMetrics(params);
    const namespaces = new Set<string>();

    for (const result of payload.result ?? []) {
      for (const series of result.data ?? []) {
        const map = series.dimensionMap ?? {};
        const namespace =
          map['k8s.namespace.name'] ?? this.findDimensionByNeedle(map, 'namespace') ?? series.dimensions[0];
        if (namespace) {
          namespaces.add(namespace);
        }
      }
    }

    return [...namespaces].sort();
  }
}
