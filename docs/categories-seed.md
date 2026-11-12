# Categories aligned with existing frontend artwork

Status: proposed children; dry-run only until the exact taxonomy and test-only
write are approved. No API contract, Prisma schema or migration changes are needed.
The image files were opened and checked; they are not renamed, copied or deleted.

| Root | Existing file in frontend `public/category_icons/` | Children |
| --- | --- | --- |
| Manga & Anime | `01_anime_manga.png` | Manga; Light Novel; Artbook; Anime Blu-ray/DVD |
| Game | `02_game.png` | Đĩa/Băng game; Máy chơi game; Tay cầm; Phụ kiện game |
| Idol & K-pop | `03_idol.png` | Album; Lightstick; Concert Blu-ray/DVD; Goods Idol |
| Figure | `04_figure.png` | Scale Figure; Nendoroid; Prize/Trading Figure; Model Kit |
| Cosplay | `05_do_cosplay.png` | Trang phục cosplay; Tóc giả; Đạo cụ cosplay |
| Badge & Goods | `06_badge.png` | Badge; Keychain; Standee; Poster; Văn phòng phẩm |
| Plush & Doll | `07_plush.png` | Plush; Doll; Trang phục Doll; Phụ kiện Doll |
| Cards & Photocard | `08_card.png` | Photocard; TCG - Thẻ lẻ; TCG - Booster/Deck; Phụ kiện bảo vệ thẻ |

Total: **8 roots + 32 children = 40 categories**, all proposed as `ACTIVE`.
Roots have `parentId = null`; children reference their root UUID. The previous
standalone Standee/TCG proposals become children, so this is a data change only.
The icon filenames are presentation metadata, not new database/API fields.

Verified dry-run: database `gomgoods_test`, schema `public`, server port `5432`,
`readOnly: on`; existing `0`, planned creates `40`, keeps `0`, writes `0`.
Taxonomy approval hash:

```text
f855b86b1b3af9e71240a2d95a49645bceb03d3c46d623438ce2013f7643c243
```

## Commands and target

From the backend repo:

```powershell
npm run db:seed:categories
# Explicit equivalent:
npm run db:seed:categories -- --dry-run
```

The dedicated script `prisma/seed-categories.ts` loads `.env.test` plus explicit
process overrides. It never uses `DATABASE_URL` and never imports/runs the general
`prisma/seed.ts` script. It requires `NODE_ENV=test` and permits only
`127.0.0.1:55432/gomgoods_test`, schema `public`. A `localhost` URL is normalized
to `127.0.0.1` before connecting; other host/port/database/schema/routing options
are rejected. No environment file is modified.

Every connection defaults to read-only. Dry-run uses a repeatable-read READ ONLY
transaction, checks actual `current_database()`, schema, PostgreSQL server port
`5432` (mapped to `55432` by the existing test compose), transaction mode, category
column types and status enum, then reads categories and rolls back. Its output
includes the full plan and `writes: 0`, never credentials.

## Idempotency and conflict handling

- Permanent UUID keys do not depend on array position or label order.
- Existing exact canonical categories retain their UUIDs; child parent IDs follow
  the retained root UUID. Existing active rows are kept, not updated.
- Detect normalized sibling names and legacy root aliases before inserting.
  Duplicate matches, reserved UUID collisions, inactive rows or required renames
  stop the operation; nothing is silently merged, moved or reactivated.
- After approval, apply serializes category writes with a table lock, re-reads
  current rows and inserts only missing categories in one transaction. Re-running
  against the resulting canonical taxonomy produces only `keep` actions.
- The root-name check and lock are needed because the current unique
  `(parent_id, name)` index allows multiple root rows with NULL `parent_id`.
- Only `CATEGORY` can be inserted by this script. No users, products, listings,
  orders, payments or other commerce records are changed.

Apply is not the default. It requires both `--apply` and
`--approve-taxonomy=<SHA-256 from the approved dry-run>`. Changing any taxonomy
entry changes that hash, invalidating the previous approval argument. Do not use
apply until the user explicitly approves the children and test database write.

## Frontend alignment

`CategoryNav` maps all eight canonical root names to the files above, retains the
old labels as aliases, and does not choose icons by array index. It does not mount
the seed manifest or fabricate category records. Home links use the API category
UUID in `categoryId`; Marketplace filters use the same root/child UUIDs from the
categories API. Empty API data remains an empty state until an approved seed runs.

## Verification

```powershell
npm run test:unit -- src/modules/categories/seed-categories.spec.ts
npx tsc --noEmit --incremental false
npx oxlint prisma/seed-categories.ts src/modules/categories/seed-categories.spec.ts
```

The unit tests exercise planning/idempotency, existing UUID reuse, duplicate/alias
conflicts, exact taxonomy approval and wrong-target/identity rejection without
connecting to or writing a database. Live apply has not been executed.
