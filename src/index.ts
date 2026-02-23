import { Command } from 'commander';
import { debug } from './debug.js';
import { loadConfig } from './config.js';
import { DynatraceClient } from './dynatrace.js';
import { mergeMetricPoints, recommend } from './analysis.js';
import { writeHtmlReport } from './report.js';

const VERSION = '0.2.0';

export const run = async (argv: string[]): Promise<void> => {
  debug('run start', { argv });
  const program = new Command();

  program
    .name('ops-pod-opt')
    .description('CPU, memory and pod sizing optimization based on Dynatrace APIs')
    .version(VERSION)
    .option('-c, --config <path>', 'Path to YAML config file', 'config.yaml')
    .option('-w, --window <window>', 'Override config timeWindow (e.g. 7d, 24h)');

  program.parse(argv);
  const opts = program.opts<{ config: string; window?: string }>();

  debug('cli options parsed', opts);
  const config = loadConfig(opts.config, opts.window);

  const client = new DynatraceClient(config.endpoint, config.apiToken);

  debug('querying Dynatrace metrics for optimization');
  const [cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount] = await Promise.all([
    client.queryMetricSeries(config.metrics.cpuUsage, config.timeWindow, config.namespaces),
    client.queryMetricSeries(config.metrics.memoryUsage, config.timeWindow, config.namespaces),
    client.queryMetricSeries(config.metrics.cpuRequest, config.timeWindow, config.namespaces),
    client.queryMetricSeries(config.metrics.memoryRequest, config.timeWindow, config.namespaces),
    client.queryMetricSeries(config.metrics.podCount, config.timeWindow, config.namespaces),
  ]);

  const samples = mergeMetricPoints(cpuUsage, memoryUsage, cpuRequest, memoryRequest, podCount);
  const recommendations = recommend(samples, config);
  const reportPath = writeHtmlReport(config.outputPath, recommendations);

  console.log(`Recommendations generated: ${recommendations.length}`);
  console.log(`Report written to: ${reportPath}`);
  debug('run end', { recommendations: recommendations.length, reportPath });
};

export const main = async (): Promise<void> => {
  try {
    await run(process.argv);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${msg}`);
    process.exitCode = 1;
  }
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  void main();
}
