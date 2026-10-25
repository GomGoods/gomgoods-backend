import { describe, expect, it } from 'vitest';
import {
  categoryPlan, categoryTaxonomy, seedMode, taxonomyHash,
  verifiedTarget, verifyIdentity, type CategoryRow,
} from '../../../prisma/seed-categories.js';

const target = { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://localhost:55432/gomgoods_test?schema=public' };

describe('categories-only seed', () => {
  it('plans eight roots and 32 children with permanent unique UUIDs', () => {
    const plan = categoryPlan([]);
    expect(categoryTaxonomy.map((root) => root.icon)).toEqual([
      '01_anime_manga.png', '02_game.png', '03_idol.png', '04_figure.png',
      '05_do_cosplay.png', '06_badge.png', '07_plush.png', '08_card.png',
    ]);
    expect(plan).toHaveLength(40);
    expect(plan.filter((row) => row.parentId === null)).toHaveLength(8);
    expect(new Set(plan.map((row) => row.id)).size).toBe(40);
    expect(plan.every((row) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/.test(row.id))).toBe(true);
    expect(plan.every((row) => row.action === 'create' && row.status === 'ACTIVE' && row.name.length <= 120)).toBe(true);
    const rootIds = plan.filter((row) => row.parentId === null).map((row) => row.id);
    expect(plan.filter((row) => row.parentId !== null).every((row) => rootIds.includes(row.parentId!))).toBe(true);
  });

  it('is idempotent when the first plan already exists and does not mutate input rows', () => {
    const existing: CategoryRow[] = categoryPlan([]).map(({ action: _action, ...row }) => row);
    const before = structuredClone(existing);
    const plan = categoryPlan(existing);
    expect(plan.every((row) => row.action === 'keep')).toBe(true);
    expect(plan.map((row) => row.id)).toEqual(existing.map((row) => row.id));
    expect(existing).toEqual(before);
  });

  it('reuses an existing canonical root UUID and keeps its child parent IDs aligned', () => {
    const root = { id: '00000000-0000-4000-8000-000000000030', parentId: null, name: 'Figure', status: 'ACTIVE' };
    const plan = categoryPlan([root]);
    expect(plan.find((row) => row.name === 'Figure')).toMatchObject({ id: root.id, action: 'keep' });
    expect(plan.find((row) => row.name === 'Nendoroid')?.parentId).toBe(root.id);
  });

  it('refuses ambiguous root names despite nullable parent unique semantics', () => {
    expect(() => categoryPlan([
      { id: 'a', parentId: null, name: 'Figure', status: 'ACTIVE' },
      { id: 'b', parentId: null, name: ' figure ', status: 'ACTIVE' },
    ])).toThrow('Ambiguous');
  });

  it('does not silently rename an alias or reactivate an existing category', () => {
    expect(() => categoryPlan([{ id: 'a', parentId: null, name: 'Figures', status: 'ACTIVE' }])).toThrow('separately approved');
    expect(() => categoryPlan([{ id: 'a', parentId: null, name: 'Figure', status: 'INACTIVE' }])).toThrow('separately approved');
  });

  it('refuses UUID reuse by another category or hierarchy', () => {
    const desired = categoryPlan([])[0];
    expect(() => categoryPlan([{ ...desired, name: 'Unrelated category' }])).toThrow('UUID collision');
  });

  it('defaults to dry-run and requires approval of the exact taxonomy before apply', () => {
    expect(seedMode([])).toBe('dry-run');
    expect(seedMode(['--dry-run'])).toBe('dry-run');
    expect(() => seedMode(['--apply'])).toThrow('explicit approval');
    expect(() => seedMode(['--apply', '--approve-taxonomy=outdated'])).toThrow('unapproved');
    expect(() => seedMode(['--apply', '--dry-run', `--approve-taxonomy=${taxonomyHash}`])).toThrow();
    expect(seedMode(['--apply', `--approve-taxonomy=${taxonomyHash}`])).toBe('apply');
  });

  it('normalizes localhost to the sole allowed test endpoint without using DATABASE_URL', () => {
    const url = new URL(verifiedTarget({ ...target, DATABASE_URL: 'postgresql://127.0.0.1:5432/gomgoods' }));
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('55432');
    expect(url.pathname).toBe('/gomgoods_test');
  });

  it.each([
    { ...target, NODE_ENV: 'development' },
    { ...target, NODE_ENV: 'production' },
    { ...target, TEST_DATABASE_URL: undefined },
    { ...target, TEST_DATABASE_URL: 'postgresql://127.0.0.1:5432/gomgoods' },
    { ...target, TEST_DATABASE_URL: 'postgresql://remote:55432/gomgoods_test' },
    { ...target, TEST_DATABASE_URL: 'postgresql://127.0.0.1:55432/other_test' },
    { ...target, TEST_DATABASE_URL: 'postgresql://127.0.0.1:55432/gomgoods_test?schema=private' },
    { ...target, TEST_DATABASE_URL: 'postgresql://127.0.0.1:55432/gomgoods_test?host=remote' },
  ])('refuses all other modes, databases and routing overrides (%j)', (environment) => {
    expect(() => verifiedTarget(environment)).toThrow();
  });

  it('checks actual database identity and read-only mode, not only the URL', () => {
    const identity = { database: 'gomgoods_test', schema: 'public', serverPort: 5432, readOnly: 'on' };
    expect(() => verifyIdentity(identity, 'dry-run')).not.toThrow();
    expect(() => verifyIdentity({ ...identity, database: 'gomgoods' }, 'dry-run')).toThrow();
    expect(() => verifyIdentity({ ...identity, schema: 'private' }, 'dry-run')).toThrow();
    expect(() => verifyIdentity({ ...identity, readOnly: 'off' }, 'dry-run')).toThrow();
    expect(() => verifyIdentity(identity, 'apply')).toThrow();
  });
});
