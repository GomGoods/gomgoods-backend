# Phase 7B — Community Forum

## Domain and safe deployment

Reuses `Post`, `Comment`, `Reaction`, `Report` and existing enums; no STORE account
role or changes to Chat authorization. Public author fields are `id, username`.
Forum topics are independent of commerce categories: general, anime-manga, game,
idol, collectibles, cosplay. `GET topics` exposes active topics only.

New migrations (existing migrations unchanged):

1. `20261104000000_add_phase7b_forum`: topics, post topic/state metadata, one-level
   comment replies/state, forum report foreign keys/partial uniqueness, moderation
   audit, text/state checks and immutable post/comment identity triggers. It runs
   transactionally and **refuses pre-existing posts/comments/reactions or POST/
   COMMENT reports** rather than guessing topic mappings or transforming content.
   Non-forum reports remain unchanged. Six forum topics are inserted, not commerce
   categories. If legacy forum rows exist, inventory read-only and design a separate
   approved migration; do not delete data or edit an applied migration to bypass it.
2. `20261104010000_add_forum_ranking_history`: append-only application like events
   for stable popular-feed cursors, with a one-time backfill of canonical LIKEs
   that may arrive between deployments. `Reaction` remains the unique current
   `(postId,userId)` state, not a parallel second like API or a denormalized counter.

Preflight verified the existing test environment at
`127.0.0.1:55432/gomgoods_test`, schema public, UTF8: POST/COMMENT/REACTION/REPORT
were empty, and 40 commerce categories were present. Only this test target received
migrations/E2E; no dev/prod DB access, reset, seed, old migration edit or env change.
The general development seed's forum fixture now supplies the required topic and
records like history atomically; the general seed is **not run** for this phase.

## REST contract

All routes below are under `/api/forum`. Existing success/error envelopes apply.
Public reads do not require JWT. Writes/current-user/admin routes use the existing
session JWT guard and current ACTIVE account check. Supplied extra fields are
rejected. Write services recheck the actor (and ADMIN role where required) in the
transaction. Arbitrary author, status metadata, counters and report targets cannot
be supplied by the client. UUIDs, UTC ISO dates, code-point limits and bounded
pagination are documented in Swagger; no private email/phone/session fields.

| Method/path | Input / behavior |
| --- | --- |
| GET `topics` | Active forum taxonomy, no commerce category mapping. |
| GET `posts` | `sort=newest|popular`, `q?` (literal case-insensitive title/content substring, max 100), `topic?` (slug), `cursor?`, `limit=20` (1–50). |
| GET `posts/:id` | Published visible post with active author/topic; otherwise 404, including when an ADMIN uses this public route. |
| POST `posts` | `{title,content,topicId,status?:DRAFT|PUBLISHED}`; defaults PUBLISHED, 201. |
| PATCH `posts/:id` | Own editable post only; any subset of the create fields, no implicit publish on partial edit. |
| DELETE `posts/:id` | Own idempotent soft delete, `{id,status:REMOVED}`. |
| GET `me/posts` | Own drafts/published/hidden/removed including own state metadata, newest-first. |
| GET `posts/:id/comments` | Flat visible comments/replies ordered createdAt/id ascending, cursor/limit. No recursive expansion or per-comment query. |
| POST `posts/:id/comments` | `{content,parentId?}`; only a public post and a visible root parent in that same post, 201. |
| PATCH / DELETE `comments/:id` | Edit visible own text / soft-delete own comment (also allowed for own moderated content). |
| PUT / DELETE `posts/:id/like` | Idempotent like/unlike on a public post; `{postId,liked,likeCount}`. |
| POST `posts/:id/reports`, `comments/:id/reports` | `{reason,content?}`, 200 create/reuse; one report per actor/target across all report states. |
| GET `admin/reports` | ADMIN forum reports only; context, public reporter identity and bounded recent review audit. Never MESSAGE reports or private chats. |
| PATCH `admin/reports/:id` | ADMIN `{status:IN_REVIEW|RESOLVED|REJECTED,action?:NONE|HIDE,note}`; mandatory note, no reopen/duplicate transition; HIDE requires RESOLVED. |
| POST `admin/posts/:id/hide`, `admin/comments/:id/hide` | ADMIN `{note}`, idempotent hide with retained audit. |
| GET `admin/posts/:id/moderation-actions` | ADMIN cursor-paginated complete retained post/comment/report moderation trail for this post. |

`reason` is SPAM/HARASSMENT/SCAM/INAPPROPRIATE/OTHER. Post/comment author edits do not
override moderation. ADMIN can hide, not edit content as another author or
hard-delete it. REMOVED + deletedAt identifies author deletion; HIDDEN + hiddenAt
identifies moderation. Deleting a hidden post retains hiddenAt and its audit.
Public comments/counts also exclude replies whose parent is hidden/deleted or
whose author is inactive. Reporting a non-public target returns 404.

## Text, pagination and ranking

Exact plain text: title 1–250, post body 1–10,000, comment/report explanation/audit
note 1–2,000 Unicode scalar values. Non-whitespace required; NUL/unpaired surrogates
rejected. No trim, NFC/NFD normalization, accent stripping, truncation or HTML
execution. Clients must render escaped text, preserving whitespace/newlines.

Feed sort keys are descending `(createdAt,id)` or
`(popularityScore,createdAt,id)`. `popularityScore` is the number of distinct users
whose latest accepted like event at the page-one event watermark is LIKE. A later
unlike/re-like does not reorder that cursor traversal. Current `likeCount` separately
counts canonical LIKE rows by currently ACTIVE users. Popular score is an as-of
activity signal and can include accounts deactivated after liking; it is not a
permission grant or current-counter claim. There is no time-decay/random score.

Each page-one query freezes a post creation cutoff and a committed like-event
watermark. PostgreSQL advisory transaction locking serializes state-changing event
allocation through commit, preventing lower uncommitted sequence numbers from
appearing below an already issued watermark. Cursors bind scope/filter/sort/actor
where applicable, validate types/UUIDs/dates/bounds, and use deterministic ID ties.
They are not authorization tokens: all visibility/ownership filters are re-applied
on every page. Hiding/deleting/deactivating content can remove it during traversal;
it is never resurrected for snapshot consistency. Physical history deletion or a
future retention-policy change requires cursor invalidation/review.

Feed SQL uses parameters, at most two bounded collection queries plus watermark
lookup, and a repeatable-read snapshot; no N+1 reads. Parent/reply expansion is a
flat page. No full-text infrastructure or denormalized counters were introduced.

## Concurrency, moderation and spam controls

- Mutation order: active actor row shared lock, parent post row `FOR UPDATE`, then
  author/topic shared locks and re-read state/ownership; replies, edits/deletes, likes, reports and moderation on
  the same post serialize. Identity triggers prevent changing author/parent/post.
- Unique Reaction key plus transactional state changes/history prevents double
  likes and drift. Forum report partial unique index plus real POST/COMMENT FKs
  prevents duplicates/orphans without changing non-forum polymorphic semantics.
- Report resolution, optional hide and audit append are atomic. There is no
  hard-delete/audit-edit/reopen endpoint. Terminal/repeated review transitions
  return 409. Direct hides are audited once. Forum moderation adds no Chat power.
- Global existing HTTP IP throttling remains enabled. Per-user sliding-minute
  budgets across sessions: post 5, edit/delete 30, comment mutations 30, like 120,
  report 10 (duplicates consume budget), moderation 60. Rate state is bounded by
  active windows and single-instance, like the existing Chat deployment boundary.
- Like-history allocation has a global transaction fence: deliberately simple
  throughput ceiling; reconsider for high-volume likes, multiple service instances
  or history retention. No lock, limit, public permission or account checks are
  waived for tests or ADMINs.

## Verification and audit

Tests use HTTP contracts and PostgreSQL (no mocked DB). Cases include Unicode/null/
unknown inputs, IDOR/auth/session/disabled users, draft partial-edit safety,
visibility, one-level/cross-post replies, query-bound tied pagination, stable
popular ordering after new likes, concurrent likes/unlikes/duplicate reports,
moderation races/audit privacy, immutable identities/FKs/uniqueness and user/IP
rate limits. Cleanup targets captured fixture UUIDs only. Protected full-row hashes
cover commerce, stock, payments, Chat and all 40 categories before/after E2E.

Prisma validate/generate and test-target migrate status/schema diff are required,
along with full unit/E2E, build, typecheck, lint and diff checks. No generated client
or credentials belong in Git. Dependency graph is unchanged: current audit has two
baseline Moderate package findings (`@nestjs/cli -> minimatch`,
GHSA-g3hv-75wg-m249), no High/Critical. This code does not import/call that dev CLI
from forum/public runtime or pass website text to glob/build tooling; no new Medium
blocker or dependency was introduced. Do not run developer tooling against
untrusted glob inputs; no blanket advisory waiver or major override is applied.

### Observed release checks

- Prisma validate/generate PASS; both new migrations applied on the verified test
  target, migration status up to date, schema diff **no difference**.
- Full unit suite: **157 PASS**. Full PostgreSQL E2E: **155 PASS**, including 15
  forum cases. Build, lint (0 errors), typecheck and `git diff --check` PASS.
- Full-suite before/after table hashes match the read-only preflight for all
  protected commerce/payment/stock/Chat/category rows and empty legacy forum
  tables; fixture users/posts/comments/reactions/reports/events/audits cleaned.
- Standards and spec reviews found no confirmed blocking deviations. A related
  author/topic visibility race was hardened with shared locks/re-fetch through
  commit. The regression observes the actual PostgreSQL blocker before releasing
  the suspension transaction, rather than assuming a request started after a delay.
- Dependency manifest/lock unchanged from the reviewed base; audit exits nonzero
  for the two pre-existing dev-CLI Moderate package entries above, not new forum
  exposure. No Critical/High, dependency suppression or generated artifact added.

### Resume verification

- Re-ran all release gates: unit **157/157**, full E2E **155/155**, Prisma
  validate/generate, migration status/schema diff, build, lint, typecheck and diff
  check PASS. The first unit run hit the existing Express child-process 4-second
  timeout under parallel load; the isolated regression (2/2) and final full unit
  run passed without code changes. This remains a test-timing flake observation.
- Verified the configured `localhost:55432` connection's actual socket peer is
  IPv4 loopback `127.0.0.1`, database `gomgoods_test`, schema `public`, UTF8.
  All nine applied migration checksums match local SQL, including both new forum
  migrations; forum checks/FKs are validated, identity/depth triggers enabled,
  and the partial unique report index valid.
- Protected preflight hashes still match before/after full E2E, including the
  existing PAID payment and 40 categories. Legacy forum tables remain empty;
  forum events/audits and captured E2E users are cleaned.
- Production audit (`npm audit --omit=dev --json`) reports **0 findings**. Full
  audit exits 1 for the same two Moderate entries: installed dev dependency
  `@nestjs/cli@12.0.0 -> minimatch@10.2.6`, one underlying advisory
  GHSA-g3hv-75wg-m249. The scoped tooling-input mitigation above remains applicable;
  no runtime exposure, new blocker, dependency change or blanket waiver was found.
- Reused the prior external Graphify pattern index (165 nodes, Chat/auth/Prisma
  patterns); it does not index the new Forum implementation, which was reviewed
  directly with its DTOs, selectors, service, migrations and PostgreSQL tests.
