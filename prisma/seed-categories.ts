import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

// Keys are permanent identifiers, independent of array order and display names.
export const categoryTaxonomy = [
  { key: 100, name: 'Manga & Anime', icon: '01_anime_manga.png', aliases: ['Anime/Manga'], children: [
    { key: 101, name: 'Manga' }, { key: 102, name: 'Light Novel' },
    { key: 103, name: 'Artbook' }, { key: 104, name: 'Anime Blu-ray/DVD' },
  ] },
  { key: 200, name: 'Game', icon: '02_game.png', aliases: [], children: [
    { key: 201, name: 'Đĩa/Băng game' }, { key: 202, name: 'Máy chơi game' },
    { key: 203, name: 'Tay cầm' }, { key: 204, name: 'Phụ kiện game' },
  ] },
  { key: 300, name: 'Idol & K-pop', icon: '03_idol.png', aliases: ['Idol'], children: [
    { key: 301, name: 'Album' }, { key: 302, name: 'Lightstick' },
    { key: 303, name: 'Concert Blu-ray/DVD' }, { key: 304, name: 'Goods Idol' },
  ] },
  { key: 400, name: 'Figure', icon: '04_figure.png', aliases: ['Figures'], children: [
    { key: 401, name: 'Scale Figure' }, { key: 402, name: 'Nendoroid' },
    { key: 403, name: 'Prize/Trading Figure' }, { key: 404, name: 'Model Kit' },
  ] },
  { key: 500, name: 'Cosplay', icon: '05_do_cosplay.png', aliases: ['Đồ cosplay'], children: [
    { key: 501, name: 'Trang phục cosplay' }, { key: 502, name: 'Tóc giả' },
    { key: 503, name: 'Đạo cụ cosplay' },
  ] },
  { key: 600, name: 'Badge & Goods', icon: '06_badge.png', aliases: ['Badge'], children: [
    { key: 601, name: 'Badge' }, { key: 602, name: 'Keychain' },
    { key: 603, name: 'Standee' }, { key: 604, name: 'Poster' },
    { key: 605, name: 'Văn phòng phẩm' },
  ] },
  { key: 700, name: 'Plush & Doll', icon: '07_plush.png', aliases: ['Plush'], children: [
    { key: 701, name: 'Plush' }, { key: 702, name: 'Doll' },
    { key: 703, name: 'Trang phục Doll' }, { key: 704, name: 'Phụ kiện Doll' },
  ] },
  { key: 800, name: 'Cards & Photocard', icon: '08_card.png', aliases: ['Card'], children: [
    { key: 801, name: 'Photocard' }, { key: 802, name: 'TCG - Thẻ lẻ' },
    { key: 803, name: 'TCG - Booster/Deck' }, { key: 804, name: 'Phụ kiện bảo vệ thẻ' },
  ] },
];

const categoryId = (key: number) => `c4700000-0000-4000-8000-${String(key).padStart(12, '0')}`;
const normalized = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');

export const taxonomyHash = createHash('sha256').update(JSON.stringify(categoryTaxonomy)).digest('hex');

export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  status: string;
}

class CategorySeedError extends Error {}
function refuse(message: string): never { throw new CategorySeedError(message); }

export function seedMode(args: string[]): 'dry-run' | 'apply' {
  const allowed = new Set(['--dry-run', '--apply', `--approve-taxonomy=${taxonomyHash}`]);
  if (args.some((arg) => !allowed.has(arg)) || new Set(args).size !== args.length) refuse('Unknown, duplicate or unapproved taxonomy arguments.');
  if (args.includes('--apply')) {
    if (args.includes('--dry-run') || !args.includes(`--approve-taxonomy=${taxonomyHash}`)) refuse('Apply requires explicit approval of the exact taxonomy hash.');
    return 'apply';
  }
  if (args.some((arg) => arg.startsWith('--approve-taxonomy='))) refuse('Taxonomy approval must accompany --apply.');
  return 'dry-run';
}

export function verifiedTarget(environment: Record<string, string | undefined>): string {
  if (environment.NODE_ENV !== 'test') refuse('Only NODE_ENV=test is permitted; dev/prod are forbidden.');
  let url: URL;
  try { url = new URL(environment.TEST_DATABASE_URL || ''); }
  catch { return refuse('A valid TEST_DATABASE_URL is required. DATABASE_URL is never used.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55432' ||
    url.pathname !== '/gomgoods_test') refuse('Only 127.0.0.1:55432/gomgoods_test is permitted.');
  if ([...url.searchParams.keys()].some((key) => key !== 'schema') ||
    url.searchParams.getAll('schema').length > 1 ||
    (url.searchParams.get('schema') || 'public') !== 'public') refuse('Only schema public and no connection-routing options are permitted.');
  url.hostname = '127.0.0.1';
  url.searchParams.delete('schema');
  return url.toString();
}

export function verifyIdentity(identity: { database: string; schema: string; serverPort: number; readOnly: string }, mode: 'dry-run' | 'apply') {
  if (identity.database !== 'gomgoods_test' || identity.schema !== 'public' || identity.serverPort !== 5432 ||
    identity.readOnly !== (mode === 'dry-run' ? 'on' : 'off')) refuse('Database identity or transaction mode does not match the approved test target.');
}

export function categoryPlan(existing: CategoryRow[]) {
  const plan: (CategoryRow & { action: 'create' | 'keep' })[] = [];
  const resolveRow = (key: number, name: string, parentId: string | null, aliases: string[] = []) => {
    const id = categoryId(key);
    const names = [name, ...aliases].map(normalized);
    const matches = existing.filter((row) => row.parentId === parentId && names.includes(normalized(row.name)));
    if (matches.length > 1) refuse(`Ambiguous existing categories for ${name}; no automatic merge.`);
    const match = matches[0];
    const collision = existing.find((row) => row.id === id && row.id !== match?.id);
    if (collision) refuse(`Reserved UUID collision for ${name}; no overwrite.`);
    if (match && (match.name !== name || match.status !== 'ACTIVE')) refuse(`Existing ${match.name} needs a separately approved rename/status change.`);
    const row = { id: match?.id || id, parentId, name, status: 'ACTIVE', action: match ? 'keep' as const : 'create' as const };
    plan.push(row);
    return row.id;
  };
  for (const root of categoryTaxonomy) {
    const parentId = resolveRow(root.key, root.name, null, root.aliases);
    for (const child of root.children) resolveRow(child.key, child.name, parentId);
  }
  return plan;
}

async function verifySchema(client: pg.Client) {
  const columns = await client.query<{ column_name: string; udt_name: string; is_nullable: string; character_maximum_length: number | null }>(
    'SELECT column_name, udt_name, is_nullable, character_maximum_length FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    ['public', 'CATEGORY'],
  );
  for (const [name, type, nullable] of [
    ['category_id', 'uuid', 'NO'], ['parent_id', 'uuid', 'YES'], ['name', 'varchar', 'NO'],
    ['status', 'CategoryStatus', 'NO'], ['created_at', 'timestamptz', 'NO'], ['updated_at', 'timestamptz', 'NO'],
  ]) {
    if (!columns.rows.some((column) => column.column_name === name && column.udt_name === type && column.is_nullable === nullable)) refuse(`CATEGORY schema mismatch: ${name}; migration/schema changes require separate approval.`);
  }
  const maxName = Math.max(...categoryTaxonomy.flatMap((root) => [root.name, ...root.children.map((child) => child.name)]).map((name) => name.length));
  if ((columns.rows.find((column) => column.column_name === 'name')?.character_maximum_length || 0) < maxName) refuse('Category names exceed the existing name column length.');
  const statuses = await client.query<{ enumlabel: string }>(
    'SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typname = $2 ORDER BY e.enumsortorder',
    ['public', 'CategoryStatus'],
  );
  if (statuses.rows.map((row) => row.enumlabel).join(',') !== 'ACTIVE,INACTIVE') refuse('CategoryStatus schema mismatch.');
}

export async function main(args = process.argv.slice(2)) {
  const mode = seedMode(args);
  const fileEnvironment: Record<string, string> = {};
  // Load only the test configuration; never import dotenv/config or the general seed.
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env.test'), processEnv: fileEnvironment, quiet: true });
  const connectionString = verifiedTarget({ ...fileEnvironment, ...process.env });
  const client = new pg.Client({
    connectionString, application_name: 'gomgoods_category_seed', connectionTimeoutMillis: 5000,
    options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=5000',
  });
  try {
    await client.connect();
    await client.query(mode === 'dry-run' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE');
    const { rows: [identity] } = await client.query<{ database: string; schema: string; serverPort: number; readOnly: string }>(
      `SELECT current_database() AS database, current_schema() AS schema, inet_server_port() AS "serverPort", current_setting('transaction_read_only') AS "readOnly"`,
    );
    verifyIdentity(identity, mode);
    await verifySchema(client);
    if (mode === 'apply') await client.query('LOCK TABLE public."CATEGORY" IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query<CategoryRow>('SELECT category_id::text AS id, parent_id::text AS "parentId", name, status FROM public."CATEGORY" ORDER BY category_id');
    const plan = categoryPlan(rows);
    if (mode === 'apply') {
      for (const row of plan.filter((row) => row.action === 'create')) {
        await client.query('INSERT INTO public."CATEGORY" (category_id, parent_id, name, status, created_at, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', [row.id, row.parentId, row.name, row.status]);
      }
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
    console.log(JSON.stringify({
      mode, target: '127.0.0.1:55432/gomgoods_test', identity, taxonomyHash,
      roots: categoryTaxonomy.length, children: plan.length - categoryTaxonomy.length,
      existing: rows.length, create: plan.filter((row) => row.action === 'create').length,
      keep: plan.filter((row) => row.action === 'keep').length, writes: mode === 'apply' ? plan.filter((row) => row.action === 'create').length : 0,
      plan,
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    // Connection strings, credentials and raw driver messages must never be logged.
    console.error(error instanceof CategorySeedError ? error.message : 'Category seed failed. Inspect the test target/schema and retry dry-run.');
    process.exitCode = 1;
  });
}
