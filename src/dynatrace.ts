import { debug } from './debug.js';

interface DynatraceMetricSeries {
  dimensions: string[];
  dimensionMap?: Record<string, string>;
  timestamps: number[];
  values: Array<number | null>;
}

interface DynatraceMetricResult {
  metricId: string;
  data: DynatraceMetricSeries[];
}

interface DynatraceMetricResponse {
  totalCount?: number;
  nextPageKey?: string;
  result: DynatraceMetricResult[];
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

  private async fetchMetricPage(params: URLSearchParams): Promise<DynatraceMetricResponse> {
    const url = `${this.endpoint}/api/v2/metrics/query?${params.toString()}`;
    debug('Dynatrace metrics query start', { url });
    const response = await fetch(url, {
      headers: {
        Authorization: `Api-Token ${this.token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      debug('Dynatrace metrics query failed', { status: response.status, body });
      throw new Error(`Dynatrace API error ${response.status}: ${body}`);
    }

    const payload = (await response.json()) as DynatraceMetricResponse;
    debug('Dynatrace metrics query end', {
      totalCount: payload.totalCount,
      nextPageKey: payload.nextPageKey ?? null,
      resultCount: payload.result?.length ?? 0,
    });
    return payload;
  }

  async queryMetricSeries(metricSelector: string, from: string, namespaces: string[]): Promise<MetricPoint[]> {
    debug('queryMetricSeries start', { metricSelector, from, namespaceCount: namespaces.length });
    const points: MetricPoint[] = [];
    let nextPageKey: string | undefined;
    let page = 0;

    do {
      page += 1;
      const params = new URLSearchParams();
      params.set('metricSelector', metricSelector);
      params.set('from', `now-${from}`);
      params.set('resolution', 'Inf');
      if (nextPageKey) {
        params.set('nextPageKey', nextPageKey);
      }

      const payload = await this.fetchMetricPage(params);
      const result = payload.result ?? [];

      for (const metric of result) {
        for (const series of metric.data ?? []) {
          const values = (series.values ?? []).filter((value): value is number => typeof value === 'number');
          if (values.length === 0) {
            continue;
          }

          const dimensionMap = series.dimensionMap ?? {};
          const namespace =
            dimensionMap['k8s.namespace.name'] ??
            dimensionMap['dt.entity.cloud_application_namespace.name'] ??
            this.pickByKeyContains(dimensionMap, 'namespace') ??
            'unknown';

          if (!namespaces.includes(namespace)) {
            continue;
          }

          const workload =
            dimensionMap['k8s.workload.name'] ??
            dimensionMap['k8s.deployment.name'] ??
            dimensionMap['k8s.statefulset.name'] ??
            this.pickByKeyContains(dimensionMap, 'workload') ??
            this.pickByKeyContains(dimensionMap, 'cloud_application') ??
            series.dimensions?.find((d) => d && d !== namespace) ??
            'unknown';

          const workloadKind =
            dimensionMap['k8s.workload.kind'] ??
            (dimensionMap['k8s.deployment.name'] ? 'deployment' : undefined) ??
            this.inferKindFromMap(dimensionMap, workload);

          points.push({
            namespace,
            workload,
            workloadKind: workloadKind || 'other',
            values,
          });
        }
      }

      nextPageKey = payload.nextPageKey;
      debug('metrics pagination step', { page, nextPageKey: nextPageKey ?? null, accumulatedPoints: points.length });
    } while (nextPageKey);

    debug('queryMetricSeries end', { metricSelector, points: points.length });
    return points;
  }

  private pickByKeyContains(map: Record<string, string>, needle: string): string | undefined {
    const key = Object.keys(map).find((k) => k.toLowerCase().includes(needle.toLowerCase()));
    return key ? map[key] : undefined;
  }

  private inferKindFromMap(map: Record<string, string>, workload: string): string {
    const keyBlob = Object.keys(map).join(' ').toLowerCase();
    const valBlob = Object.values(map).join(' ').toLowerCase();
    const blob = `${keyBlob} ${valBlob} ${workload.toLowerCase()}`;
    if (blob.includes('deployment')) return 'deployment';
    if (blob.includes('statefulset')) return 'statefulset';
    if (blob.includes('daemonset')) return 'daemonset';
    if (blob.includes('cronjob')) return 'cronjob';
    return 'other';
  }
}
