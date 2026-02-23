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
    debug('DynatraceClient initialized', { endpoint: this.endpoint });
  }

  private async requestMetrics(params: URLSearchParams): Promise<MetricsResponse> {
    const url = `${this.endpoint}/api/v2/metrics/query?${params.toString()}`;
    const startedAt = Date.now();
    debug('dynatrace api request start', {
      method: 'GET',
      url,
      metricSelector: params.get('metricSelector'),
      from: params.get('from'),
      resolution: params.get('resolution'),
      nextPageKeyPresent: Boolean(params.get('nextPageKey')),
    });

    const response = await fetch(url, {
      headers: {
        Authorization: `Api-Token ${this.token}`,
      },
    });
    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      const body = await response.text();
      debug('dynatrace api request failed', {
        status: response.status,
        statusText: response.statusText,
        elapsedMs,
        bodyPreview: body.slice(0, 500),
      });
      throw new Error(`Dynatrace API error ${response.status}: ${body}`);
    }

    const payload = (await response.json()) as MetricsResponse;
    const seriesCount = (payload.result ?? []).reduce((acc, result) => acc + (result.data?.length ?? 0), 0);
    const metricIds = (payload.result ?? []).map((result) => result.metricId).slice(0, 5);
    debug('dynatrace api request end', {
      status: response.status,
      elapsedMs,
      resultCount: payload.result?.length ?? 0,
      seriesCount,
      metricIdsPreview: metricIds,
      nextPageKey: payload.nextPageKey ?? null,
    });
    return payload;
  }

  private parseMetricSeries(payload: MetricsResponse, namespaces: string[], requiredTags: string[]): MetricPoint[] {
    debug('parseMetricSeries start', {
      resultCount: payload.result?.length ?? 0,
      namespaceCount: namespaces.length,
      requiredTags,
    });
    const out: MetricPoint[] = [];
    let skippedNoValues = 0;
    let skippedByNamespace = 0;
    let skippedByTags = 0;

    for (const metric of payload.result ?? []) {
      for (const series of metric.data ?? []) {
        const values = (series.values ?? []).filter((v): v is number => typeof v === 'number');
        if (values.length === 0) {
          skippedNoValues += 1;
          continue;
        }

        const map = series.dimensionMap ?? {};

        const namespace =
          map['k8s.namespace.name'] ??
          map['dt.entity.cloud_application_namespace.name'] ??
          this.findDimensionByNeedle(map, 'namespace') ??
          'unknown';

        if (!namespaces.includes(namespace)) {
          skippedByNamespace += 1;
          continue;
        }

        const workload =
          map['k8s.workload.name'] ??
          map['dt.entity.cloud_application.name'] ??
          this.findDimensionByNeedle(map, 'workload') ??
          this.findDimensionByNeedle(map, 'cloud_application') ??
          series.dimensions.find((value) => value && value !== namespace) ??
          'unknown';

        const workloadKind =
          map['k8s.workload.kind'] ?? this.findDimensionByNeedle(map, 'kind') ?? this.inferKind(workload, map);

        if (!this.matchesTags(map, requiredTags)) {
          skippedByTags += 1;
          continue;
        }

        out.push({ namespace, workload, workloadKind, values });
      }
    }

    debug('parseMetricSeries end', {
      outputRows: out.length,
      skippedNoValues,
      skippedByNamespace,
      skippedByTags,
    });
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

  private matchesTags(map: Record<string, string>, requiredTags: string[]): boolean {
    if (requiredTags.length === 0) {
      return true;
    }

    const entries = Object.entries(map).map(([key, value]) => [key.toLowerCase(), value.toLowerCase()] as const);
    const blob = `${Object.keys(map).join(' ')} ${Object.values(map).join(' ')}`.toLowerCase();

    return requiredTags.every((rawTag) => {
      const tag = rawTag.trim().toLowerCase();
      if (!tag) return true;

      const eqIndex = tag.indexOf('=');
      if (eqIndex > 0) {
        const keyNeedle = tag.slice(0, eqIndex).trim();
        const valNeedle = tag.slice(eqIndex + 1).trim();
        if (!keyNeedle || !valNeedle) return false;
        return entries.some(([key, value]) => key.includes(keyNeedle) && value.includes(valNeedle));
      }

      return blob.includes(tag);
    });
  }

  private buildNamespaceScopedSelector(selector: string, namespace: string): string {
    const escapedNamespace = namespace.replace(/"/g, '\\"');
    return `${selector}:filter(eq("k8s.namespace.name","${escapedNamespace}"))`;
  }

  private async queryWithSelector(
    selector: string,
    fromWindow: string,
    namespace: string,
    requiredTags: string[],
  ): Promise<MetricPoint[]> {
    const scopedSelector = this.buildNamespaceScopedSelector(selector, namespace);
    debug('queryWithSelector start', { selector, scopedSelector, fromWindow, namespace, requiredTags });
    const rows: MetricPoint[] = [];
    let page = 0;
    let nextPageKey: string | undefined;

    do {
      page += 1;
      const params = new URLSearchParams();
      if (nextPageKey) {
        params.set('nextPageKey', nextPageKey);
      } else {
        params.set('metricSelector', scopedSelector);
        params.set('from', `now-${fromWindow}`);
        params.set('resolution', fromWindow.endsWith('h') ? '1m' : '5m');
      }

      const payload = await this.requestMetrics(params);
      rows.push(...this.parseMetricSeries(payload, [namespace], requiredTags));
      nextPageKey = payload.nextPageKey;
      debug('queryWithSelector page', {
        selector: scopedSelector,
        page,
        nextPageKey: nextPageKey ?? null,
        cumulativeRows: rows.length,
      });
    } while (nextPageKey);

    debug('queryWithSelector end', { selector: scopedSelector, rows: rows.length, namespace });
    return rows;
  }

  async queryMetric(
    metricType: 'cpuUsage' | 'memoryUsage' | 'cpuRequest' | 'memoryRequest' | 'podCount',
    fromWindow: string,
    namespaces: string[],
    requiredTags: string[] = [],
  ): Promise<MetricPoint[]> {
    debug('queryMetric start', { metricType, fromWindow, namespaceCount: namespaces.length, requiredTags });
    const selectorByType: Record<typeof metricType, string> = {
      cpuUsage: 'builtin:kubernetes.workload.cpu_usage:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
      memoryUsage: 'builtin:kubernetes.workload.memory_working_set:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
      cpuRequest: 'builtin:kubernetes.workload.requests_cpu:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
      memoryRequest: 'builtin:kubernetes.workload.requests_memory:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
      podCount: 'builtin:kubernetes.pods:splitBy("k8s.namespace.name","k8s.workload.name","k8s.workload.kind"):avg',
    };

    const selector = selectorByType[metricType];
    const allRows: MetricPoint[] = [];

    for (const namespace of namespaces) {
      debug('queryMetric namespace start', { metricType, namespace, selector });
      const rows = await this.queryWithSelector(selector, fromWindow, namespace, requiredTags);
      if (rows.length === 0) {
        debug('queryMetric namespace empty', { metricType, namespace, selector });
        throw new Error(
          `No usable Dynatrace selector for ${metricType} in namespace ${namespace}. Attempt: ${selector}${requiredTags.length ? `, tags: ${requiredTags.join(',')}` : ''}`,
        );
      }

      allRows.push(...rows);
      debug('queryMetric namespace success', { metricType, namespace, rows: rows.length });
    }

    if (allRows.length === 0) {
      debug('queryMetric end failed empty', { metricType, selector });
      throw new Error(`No usable Dynatrace selector for ${metricType}. Attempt: ${selector}`);
    }
    debug('queryMetric end success', { metricType, rows: allRows.length, selector });
    return allRows;
  }

  async discoverNamespaces(fromWindow: string): Promise<string[]> {
    debug('discoverNamespaces start', { fromWindow });
    const selector = 'builtin:kubernetes.workload.pods:splitBy("k8s.namespace.name"):avg';
    debug('discoverNamespaces selector', { selector });
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

    const output = [...namespaces].sort();
    debug('discoverNamespaces end', { namespaces: output.length });
    return output;
  }
}
