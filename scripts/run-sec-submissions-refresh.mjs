// No dotenv discovery, default CIKs, shared pool, cron or API integration.
import { pathToFileURL } from 'node:url';
import { runSubmissionsRefresh, validateRefreshCiks } from '../lib/sec-structured-data/submissionsRefreshRunner.ts';

export function parseRefreshArguments(args) {
  const input = { ciks: [], apply: false };
  const seen = new Set();
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (seen.has(key)) throw Error('invalid_arguments');
    seen.add(key);
    if (arg === '--apply') input.apply = true;
    else if (arg.startsWith('--ciks=')) input.ciks = arg.slice(7).split(',');
    else if (arg.startsWith('--expect-db=') && arg.slice(12).trim()) input.expectedDatabase = arg.slice(12);
    else throw Error('invalid_arguments');
  }
  input.ciks = validateRefreshCiks(input.ciks);
  if (input.apply && !input.expectedDatabase) throw Error('expected_database_required');
  return input;
}

export async function runRefreshCli(args, options = {}) {
  const write = options.write ?? (text => process.stdout.write(`${text}\n`));
  try {
    const input = parseRefreshArguments(args);
    const report = await (options.run ?? runSubmissionsRefresh)(input);
    write(JSON.stringify(report, null, 2));
    return report.status === 'completed' ? 0 : report.status === 'busy' ? 2 : 1;
  } catch (error) {
    const allowed = new Set(['invalid_arguments','invalid_ciks','too_many_ciks',
      'expected_database_required','database_url_required','sec_user_agent_required']);
    write(JSON.stringify({ status: 'failed', error: allowed.has(error?.message) ? error.message : 'runner_failed' }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runRefreshCli(process.argv.slice(2));
}
