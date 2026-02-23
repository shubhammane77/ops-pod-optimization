import { Command } from 'commander';
import { loadConfig } from './config/loader.js';
import { debug, setDebugEnabled } from './debug.js';
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
  debug?: boolean;
}

export const run = async (argv: string[]): Promise<void> => {
  if (argv.includes('--debug') || argv.includes('-d')) {
    setDebugEnabled(true);
  }
  debug('run start', { argv });
  const program = new Command();

  program
    .name('ops-pod-opt')
    .description('Dynatrace-backed CPU, memory, and pod sizing optimizer')
    .version(VERSION)
    .option('-c, --config <path>', 'config file path', 'config.yaml')
    .option('-w, --window <window>', 'override time window, e.g. 7d or 24h')
    .option('-o, --output <path>', 'override output report path')
    .option('-d, --debug', 'enable debug logging')
    .option('--filter <mode>', 'report default filter: all | low-utilization', 'all')
    .option('--discover-namespaces', 'list namespaces visible in Dynatrace and exit');

  program.parse(argv);
  const opts = program.opts<CliOptions>();
  if (opts.debug) {
    setDebugEnabled(true);
  }
  debug('cli options parsed', opts);

  if (opts.filter !== 'all' && opts.filter !== 'low-utilization') {
    debug('invalid filter received', { filter: opts.filter });
    throw new Error(`Invalid --filter value: ${opts.filter}`);
  }

  const config = await loadConfig(opts.config, {
    window: opts.window,
    outputPath: opts.output,
  });
  debug('config loaded', {
    endpoint: config.endpoint,
    timeWindow: config.timeWindow,
    outputPath: config.outputPath,
    namespaceCount: config.namespaces.length,
  });

  const client = new DynatraceClient(config.endpoint, config.apiToken);

  if (opts.discoverNamespaces) {
    debug('discover namespaces mode enabled');
    const namespaces = await client.discoverNamespaces(config.timeWindow);
    if (namespaces.length === 0) {
      console.log('No namespaces discovered.');
      return;
    }

    console.log('Discovered namespaces:');
    for (const namespace of namespaces) {
      console.log(`- ${namespace}`);
    }
    debug('discover namespaces mode complete', { namespaces: namespaces.length });
    return;
  }

  debug('starting metrics collection');
  const [cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount] = await Promise.all([
    client.queryMetric('cpuUsage', config.timeWindow, config.namespaces),
    client.queryMetric('memoryUsage', config.timeWindow, config.namespaces),
    client.queryMetric('cpuRequest', config.timeWindow, config.namespaces),
    client.queryMetric('memoryRequest', config.timeWindow, config.namespaces),
    client.queryMetric('podCount', config.timeWindow, config.namespaces),
  ]);
  debug('metrics collection complete', {
    cpuUsage: cpuUsage.length,
    memoryUsage: memoryUsage.length,
    cpuRequest: cpuRequest.length,
    memoryRequest: memoryRequest.length,
    podCount: podCount.length,
  });

  const workloads = mergeMetrics({
    cpuUsage,
    memoryUsage,
    cpuRequest,
    memoryRequest,
    podCount,
  });

  const recommendations = generateRecommendations(workloads, config);
  const summary = summarizeByNamespace(recommendations);
  debug('analysis complete', { workloads: workloads.length, recommendations: recommendations.length, summary: summary.length });

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
  debug('main start');
  try {
    await run(process.argv);
    debug('main end success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debug('main end failure', { message });
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  void main();
}
