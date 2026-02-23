import { Command } from 'commander';
import { loadConfig } from './config/loader.js';
import { debug } from './debug.js';
import { DynatraceClient } from './dynatrace/client.js';
import { generateRecommendations, mergeMetrics, summarizeByNamespace } from './domain/recommendations.js';
import { writeReport } from './report/html.js';

const VERSION = '0.2.0';

interface CliOptions {
  config: string;
  window?: string;
  output?: string;
  filter: 'all' | 'low-utilization';
  discoverNamespaces?: boolean;
}

export const run = async (argv: string[]): Promise<void> => {
  debug('run start', { argv });
  const program = new Command();

  program
    .name('ops-pod-opt')
    .description('Dynatrace-backed CPU, memory, and pod sizing optimizer')
    .version(VERSION)
    .option('-c, --config <path>', 'config file path', 'config.yaml')
    .option('-w, --window <window>', 'override time window, e.g. 7d or 24h')
    .option('-o, --output <path>', 'override output report path')
    .option('--filter <mode>', 'report default filter: all | low-utilization', 'all')
    .option('--discover-namespaces', 'list namespaces visible in Dynatrace and exit');

  program.parse(argv);
  const opts = program.opts<CliOptions>();

  if (opts.filter !== 'all' && opts.filter !== 'low-utilization') {
    throw new Error(`Invalid --filter value: ${opts.filter}`);
  }

  const config = await loadConfig(opts.config, {
    window: opts.window,
    outputPath: opts.output,
  });

  const client = new DynatraceClient(config.endpoint, config.apiToken);

  if (opts.discoverNamespaces) {
    const namespaces = await client.discoverNamespaces(config.timeWindow);
    if (namespaces.length === 0) {
      console.log('No namespaces discovered.');
      return;
    }

    console.log('Discovered namespaces:');
    for (const namespace of namespaces) {
      console.log(`- ${namespace}`);
    }
    return;
  }

  const [cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount] = await Promise.all([
    client.queryMetric('cpuUsage', config.timeWindow, config.namespaces),
    client.queryMetric('memoryUsage', config.timeWindow, config.namespaces),
    client.queryMetric('cpuRequest', config.timeWindow, config.namespaces),
    client.queryMetric('memoryRequest', config.timeWindow, config.namespaces),
    client.queryMetric('podCount', config.timeWindow, config.namespaces),
  ]);

  const workloads = mergeMetrics({
    cpuUsage,
    memoryUsage,
    cpuRequest,
    memoryRequest,
    podCount,
  });

  const recommendations = generateRecommendations(workloads, config);
  const summary = summarizeByNamespace(recommendations);

  const reportPath = await writeReport({
    outputPath: config.outputPath,
    config,
    recommendations,
    summary,
    filter: opts.filter,
  });

  console.log(`Recommendations generated: ${recommendations.length}`);
  console.log(`Report written to: ${reportPath}`);
  debug('run end', { recommendations: recommendations.length, reportPath });
};

export const main = async (): Promise<void> => {
  try {
    await run(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  void main();
}
