param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
if ((Get-Location).ProviderPath -ne $PSScriptRoot) {
    throw 'Run this script from the gomgoods-backend repository directory.'
}
if (-not (Test-Path -LiteralPath "$PSScriptRoot\node_modules\tsx")) {
    throw 'Existing project dependencies (including tsx) are required.'
}

# Read env files without modifying them or the caller's environment.
# Do not run migrations, seeds, cleanup, or payment requests here.
$javascript = @'
import dotenv from 'dotenv';
import pg from 'pg';
import { spawn } from 'node:child_process';
import { validateEnvironment, databaseTargetsMatch } from './src/config/environment.ts';

const load = path => {
  const result = dotenv.config({ path, quiet: true, processEnv: {} });
  if (result.error) throw new Error('Required env file could not be read');
  return result.parsed;
};

async function main() {
  const base = load('.env');
  const test = load('.env.test');
  if (!test.DATABASE_URL || !test.TEST_DATABASE_URL) {
    throw new Error('The test env file must provide both database URLs');
  }
  const environment = {
    ...base, ...test, ...process.env,
    NODE_ENV: 'test', PAYMENT_MODE: 'sepay_test',
    // Pin both inputs to the test file, correcting stale terminal overrides.
    // DATABASE_URL remains the application identity marker, never a connection target here.
    DATABASE_URL: test.DATABASE_URL,
    TEST_DATABASE_URL: test.TEST_DATABASE_URL,
  };
  const validated = validateEnvironment({ ...environment, PAYMENT_MODE: 'disabled' });
  const target = new URL(validated.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
      target.port !== '55432' || target.pathname !== '/gomgoods_test' ||
      !['public', null].includes(target.searchParams.get('schema')) ||
      [...target.searchParams.keys()].some(key => key !== 'schema') ||
      databaseTargetsMatch(environment.DATABASE_URL, environment.TEST_DATABASE_URL)) {
    throw new Error('Unsafe test database identity');
  }
  console.log('Input URL identities differ: PASS (validated by the application validator)');
  console.log('Only connection target: ' + target.hostname + ':55432/gomgoods_test');

  const client = new pg.Client({
    connectionString: validated.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    options: '-c default_transaction_read_only=on',
  });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows: [row] } = await client.query(`
      SELECT current_database() AS database,
             current_setting('transaction_read_only') AS read_only,
             to_regclass('public."PAYMENT_EVENT"') IS NOT NULL AS payment_events_ready
    `);
    if (row.database !== 'gomgoods_test' || row.read_only !== 'on' || !row.payment_events_ready) {
      throw new Error('Database identity or Phase 6 readiness check failed');
    }
    await client.query('ROLLBACK');
    console.log('Read-only DB verification: PASS; database=gomgoods_test; PaymentEvent table present');
  } finally {
    await client.end();
  }

  const missing = ['SEPAY_TEST_WEBHOOK_SECRET', 'SEPAY_TEST_ACCOUNT_NUMBER',
    'SEPAY_TEST_BANK_NAME', 'VIETQR_TEST_BANK_BIN', 'VIETQR_TEST_ACCOUNT_NAME']
    .filter(key => !environment[key]?.trim());
  if (missing.length) {
    console.error('SePay startup BLOCKED: set these Test Mode variables in this terminal: ' + missing.join(', '));
    process.exitCode = 2;
    return;
  }
  // Run all real Phase 6 guards before spawning Nest. No bypasses.
  validateEnvironment(environment);
  console.log('SePay Test Mode startup configuration: PASS (credentials not displayed)');
  if (process.argv.includes('--check-only')) {
    console.log('CheckOnly: backend not started; no data writes performed');
    return;
  }
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run start:dev'], {
    cwd: process.cwd(), env: environment, stdio: 'inherit',
  });
  child.on('error', () => {
    console.error('Backend launch failed (details redacted)');
    process.exitCode = 1;
  });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}

main().catch(() => {
  console.error('Preflight BLOCKED: invalid configuration, unavailable test DB, or missing Phase 6 table. No backend started; details redacted.');
  process.exitCode = 1;
});
'@

$mode = if ($CheckOnly) { '--check-only' } else { '--start' }
$javascript | & node --import tsx --input-type=module - $mode
if ($LASTEXITCODE -ne 0) {
    throw "SePay launcher stopped (exit $LASTEXITCODE). No env files were modified."
}
