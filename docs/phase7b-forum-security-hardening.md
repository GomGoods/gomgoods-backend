# Phase 7B — Forum Security Hardening & Production Readiness Gate

Review date: 2026-11-10. Latest decision after **Runtime recovery** below: **CONDITIONAL PASS for verified hardening/integration on Node.js 22.23.4 LTS; public launch remains subject to deployment prerequisites.** Earlier FAIL evidence is retained as history, not erased.

## 1. Executive summary

The review reproduced duplicate post creation across independent app instances, a public cursor integer-overflow 500, and an oversized-body 500. It also confirmed process-local write budgets, missing server-side Forum cache policy and ambiguous authorization-header parsing. These are remediated. No exploitable High/Critical issue remains confirmed within the inspected scope; this is not proof that no vulnerability exists.

Forum write admission now uses an independent PostgreSQL counter table, atomic UPSERT and database time. Separate sessions/app instances and an app restart share the same budget. Storage contention fails Forum writes closed with a sanitized 503; public reads and authentication remain available when only that table is unavailable. Real HTTP/DB negative tests assert both response/error and unchanged Forum domain state.

The Windows Node 24.15.0 attempts included full-process exit **3221226505 (0xC0000409)** and could not support release verification. The runtime-recovery follow-up qualified an official, SHA-256-verified portable **Node 22.23.4 LTS**: **five consecutive full 182/182 PostgreSQL E2E passes**, baseline comparison before/after every run, no skipped assertions/unhandled errors/native exits. Backend 158 unit and frontend 150 tests, builds/types/lint and security/header checks passed on that runtime. The exact Node 24 native fault is not claimed fixed or attributed to an application/native module; Node 24 is excluded from the qualified project environment and fails E2E configuration before fixture execution. Backend audits are zero; frontend scoped tooling findings remain as documented. Public deployment controls/capacity remain prerequisites.

## 2. Scope, authority and assumptions

- Inspected backend base `78b74cb38af12b7de7e698029ebd5fef67c1fc22`, frontend base `aa3c14442279a2e0b4c90916139e39a75e61af45`; both started on clean local `main`. Work uses `fix/forum-security-hardening` in both repos.
- Read `PROJECT_RULES.md` before editing. It permits an explicitly approved schema change; the user separately approved **one independent rate-limit model/table and additive migration only**. Existing domain models/migrations, auth implementation, payment, Chat and Marketplace source were not changed.
- Reviewed all 20 Forum routes, service/DTO/selectors/policy, guards/current-session lookup, exception/validation/bootstrap configuration, models/migrations, frontend rendering/request/state code, existing tests and security reports. Existing Graphify Chat/auth pattern index was queried; it does not index new Forum code and was not treated as authoritative Forum evidence.
- Only the isolated PostgreSQL target was contacted: actual socket peer **127.0.0.1:55432**, database **gomgoods_test**, schema **public**, encoding **UTF8**. Application/dev/prod URLs were not used for database access. No env files, credentials, reset, seed, truncate or deployment were changed/run.
- Production reverse proxy, CDN, TLS, real replica topology, database privileges and traffic volume are not available as verified evidence. Findings below distinguish confirmed implementation behavior from conditional deployment exposure.

## 3. Endpoint security inventory

All paths have `/api/forum` prefix. `AUTH` means valid Bearer JWT + non-expired, non-revoked session + currently ACTIVE DB user; both USER and ADMIN may use ordinary author actions. `G` is the existing **100 requests / 60 seconds / controller-handler / socket IP / process** HTTP guard. `W` is the new shared `(authenticated user UUID, operation)` PostgreSQL budget, additional to G. UUID parameters use `UuidParamDto`; unknown DTO fields are forbidden globally. No create-on-behalf-of-owner authority exists.

Coverage: **F** = existing `test/phase7b.e2e-spec.ts`; **S** = new `test/phase7b-security.e2e-spec.ts` (27 cases, including parameterized operations); **B** = newly executed isolated real browser smoke.

| Method | Endpoint suffix | Authentication / role | Ownership / visibility | Limit after hardening | Validation | Abuse risk / disposition | Coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/topics` | Public | Active topics only | G | No body/query contract | Scraping/anonymous volume needs ingress capacity policy | F/S/B |
| GET | `/posts` | Public | Published, active author/topic, not hidden/deleted | G | `ForumFeedDto`: newest/popular, literal q<=100, topic slug, cursor, limit 1–50 | Forged large score fixed; large-data search/ranking cost residual | F/S/B |
| GET | `/posts/:id` | Public | Same public visibility, even for ADMIN | G | UUID | IDOR/hidden-content bypass negative tests | F/S/B |
| GET | `/posts/:id/comments` | Public | Public post; visible comment/author/root parent | G | UUID + `ForumPageDto` | No recursive expansion; flat bounded pagination | F/S/B |
| GET | `/me/posts` | AUTH | Server user UUID only; own drafts/hidden/removed allowed | G | `ForumPageDto` | Cross-user scope/cache disclosure hardening | F/S/B |
| POST | `/posts` | AUTH | Actor is author; active topic | G + W `post` 3/min | `CreateForumPostDto` | Shared quota; duplicate body across topics/titles blocked 10 min | F/S/B |
| PATCH | `/posts/:id` | AUTH | Own editable DRAFT/PUBLISHED, no hidden/deleted metadata | G + W `edit` 10/min | `UpdateForumPostDto` | IDOR/mass assignment rejected; explicit Prisma field mapping | F/S/B |
| DELETE | `/posts/:id` | AUTH | Own; includes own moderated content; soft/idempotent | G + W `delete` 5/min | UUID; no body fields used | Cannot remove another author; cannot resurrect | F/S/B |
| POST | `/posts/:id/comments` | AUTH | Public post; optional visible root in same post | G + W `comment` 10/min | `CreateForumCommentDto` | Replies share creation budget; duplicate same context blocked 60s | F/S/B |
| PATCH | `/comments/:id` | AUTH | Own visible comment on public post | G + W `comment-edit` 10/min | `UpdateForumCommentDto` | Lookup occurs after admission; forged author rejected | F/S/B |
| DELETE | `/comments/:id` | AUTH | Own, including moderated; soft/idempotent | G + W `comment-delete` 10/min | UUID; no body fields used | Missing-ID probing also spends budget | F/S/B |
| PUT | `/posts/:id/like` | AUTH | Only current actor's reaction, public post | G + W `like` 30/min | UUID; body identity ignored | Unique reaction + serialized history; shared like/unlike budget | F/S/B |
| DELETE | `/posts/:id/like` | AUTH | Only current actor's reaction, public post | Same `like` budget | UUID; body identity ignored | Forged userId cannot unlike another actor | F/S/B |
| POST | `/posts/:id/reports` | AUTH | Public target; current actor's report only | G + W `report` 3/10min | `CreateForumReportDto` | Dedup + total workload cap; reports never auto-hide | F/S/B |
| POST | `/comments/:id/reports` | AUTH | Public post and visible comment/root | Same `report` budget | Same DTO + UUID | Missing target/duplicates also spend budget | F/S/B |
| GET | `/admin/reports` | AUTH + current ADMIN | Forum POST/COMMENT reports only; no MESSAGE/Chat reports | G | `ForumPageDto` | Current role, bounded context/recent audit, no private user fields | F/S/B |
| PATCH | `/admin/reports/:id` | AUTH + current ADMIN rechecked in transaction | Forum report, valid transition, note; optional atomic hide | G + W `moderation` 30/min | `ReviewForumReportDto` | Conflicting reviews serialize; terminal decisions cannot reopen | F/S/B |
| POST | `/admin/posts/:id/hide` | AUTH + current ADMIN rechecked in transaction | Existing non-removed target; actor is authenticated admin | Same `moderation` budget | `ForumModerationDto` | Idempotent hide audited once; revocation race tested | F/S/B |
| POST | `/admin/comments/:id/hide` | Same | Existing non-removed comment in locked post | Same `moderation` budget | Same DTO + UUID | No author impersonation/hard delete | F/S/B |
| GET | `/admin/posts/:id/moderation-actions` | AUTH + current ADMIN | Retained forum trail for this post | G | `ForumPageDto` + UUID | USER/anonymous denied; history has no mutation endpoint | F/S/B |

There are **no approve, restore, audit-edit, hard-delete, arbitrary report-target, upload or notification endpoints** in this Forum implementation.

## 4. Threat model

| Boundary / asset | Attacker capability | Attack scenario | Enforcement/evidence |
| --- | --- | --- | --- |
| Browser → HTTP parser/DTO | Arbitrary body, headers, Unicode, URL/query/cursor | XSS, oversized JSON, injection, forged identity/status/time | 100 KiB parser rejection, scalar bounds/whitelist, parameterized SQL, real HTTP/browser tests |
| JWT/session → actor/role | Anonymous, invalid/expired JWT, revoked session, stale ADMIN claim | Write without auth, retain revoked powers | Current-session/current-role DB lookup; every protected endpoint tested |
| Actor → target resource | Known UUID of another user's post/comment/report | Edit/delete someone else's content; private-history access | Server actor ID, owner predicates, uniform denied/not-found response plus domain hash |
| App instances → shared budget | Concurrent sessions/instances, changed XFF, restart | Multiply/reset in-memory quota | Atomic PostgreSQL PK/UPSERT, DB clock; independent app clients/restart tests |
| Transaction → post/comment/report/audit | Races with delete/hide/role revocation | Invalid state, duplicate reports/likes/audits | Row/shared/advisory locks, canonical unique keys/FKs/checks, concurrent HTTP assertions |
| Operator/build → tooling | Untrusted registry/config/glob objects | minimatch DoS/deepmerge object poisoning | Backend patched; frontend source/build trace review and retained input/deployment restrictions |
| Deployment → public service | Distributed sources, proxy/CDN errors, storage failure | IP evasion, resource exhaustion, cached private data, fail-open writes | No-store/nosniff, scoped framing policy, write fail-closed test; ingress/TLS/capacity still prerequisites |

Not assumed: secrecy of UUIDs/cursors, client controls, a trustworthy forwarded header, an honest ADMIN claim, one HTTP session per actor, or security inferred from a successful build. A stolen valid session has that account's current permissions; rate limits do not solve account takeover or Sybil abuse.

## 5. Findings and severity

| ID | Severity / confidence | Confirmed evidence or exposure condition | Remediation / final disposition |
| --- | --- | --- | --- |
| F-01 | Moderate implementation gap; horizontal-deployment exposure conditional | Old Forum limiter was a process-local Map, reset by restart and independent per process. No shared production limiter was configured. | Replaced with PostgreSQL atomic counters; multi-instance/session/restart admission verified. Public ingress limiter remains separate prerequisite. |
| F-02 | Moderate anti-spam defect, confirmed | Before fix two independent app requests with identical body returned **201/201**, inserting two posts. Comments had no duplicate-content protection. | Per-actor transaction fencing + exact recent-body/context checks; concurrent requests now **201/409**, one stored row. Workload quotas also tightened. |
| F-03 | Moderate input-triggered error/log amplification, confirmed; no process crash/data exposure demonstrated | Forged valid-shaped popular cursor `score=9007199254740991` produced PostgreSQL `22003` and HTTP **500**. | Score restricted to the SQL INT32 score range; regression gets **422**, unchanged domain state. Cursor remains non-authoritative, not a signed authorization token. |
| F-04 | Low error-handling defect, confirmed | >100 KiB JSON was rejected by body-parser but normalized to **500**, with a parser stack log. | Recognize parser 413/400 with safe constant messages; actual oversized HTTP request returns **413**, no row inserted. |
| F-05 | Moderate defense gap; shared-cache leak not demonstrated | Authenticated `me/posts` response lacked server `Cache-Control`. First-party fetch no-store alone is not a server/proxy policy. | Forum success/error responses now `private, no-store`, plus nosniff. Proxy compliance still needs deployment verification. |
| F-06 | Low parser ambiguity; not a JWT authentication bypass | Global auth parsed only the first two authorization tokens; valid JWT plus extra fields was accepted. An additional raw duplicate-header probe returned **201** when Node selected the first valid Authorization header. A valid JWT/session was still required. | Forum-scoped guard requires exactly one raw Authorization header and a strict Bearer shape; both ambiguous forms are rejected. Existing auth/refresh implementation unchanged. |
| F-07 | Low abuse-control/feedback gap | Some missing comment/report target lookups preceded the per-user budget; no per-user Retry-After hint existed. | Admission precedes target lookup, including missing IDs; 429 includes Retry-After and retryAfterSeconds; real negative/flood tests. |
| F-08 | Defense-in-depth hardening; no stored-XSS exploit demonstrated | Forum already used React plain-text rendering. Scoped frontend framing/CSP protection was not configured. Unexpected driver errors could reach generic stack logging. | Scoped DENY/frame-ancestors/object-src/base-uri/nosniff; Chromium framing denial verified. Forum unexpected errors are sanitized before generic logging. XSS matrix remains inert. |
| F-09 | Moderate dev-tool advisory, confirmed baseline | Backend `@nestjs/cli@12.0.0 → minimatch@10.2.6`, GHSA-g3hv-75wg-m249. | Compatible parent patch `@nestjs/cli@12.0.12 → minimatch@11.0.5`; backend full/production audits **0**. |
| F-10 | Moderate availability regression caught during hardening self-review, not present in the original lookup placement | Moving target lookup after admission initially used the outer Prisma client while holding a transaction connection. A real HTTP test with two pool connections reproduced **500/500** under two concurrent comment deletes. | Resolvers now receive and use the held transaction client, including report resolution. Same constrained-pool requests now **200/200**, included in all five qualified Node 22 full-suite passes. No production timeout was relaxed. |
| F-11 | Historical runtime verification blocker; exploitability/native module unestablished | Windows Node 24.15.0 had intermittent fork exits and threads-process **0xC0000409**; no useful module record/dump was obtained. | **Isolated for the qualified Node 22.23.4 environment**, not a claimed fix to Node 24. Five consecutive full-suite passes, fresh gates and preservation proof qualify Node 22; project pins and fail-fast E2E config exclude Node 24 before database mutation. See Runtime recovery. |

No BOLA, role-escalation, arbitrary report deletion, cross-user unlike, SQL injection or executable stored-XSS bypass was confirmed by the executed scenarios. This statement is bounded by those tests and the inspected code; it is not a universal non-exploitability claim.

## 6. Remediation details / exact code scope

- `prisma/schema.prisma`: adds only `ForumRateLimit`; no existing model fields/relations changed.
- `prisma/migrations/20261110000000_add_forum_rate_limits/migration.sql`: one independent table/index with operation/count/window checks and no domain FK, trigger, ALTER or domain DML. Reviewed before applying to test DB. Applied migrations were not edited.
- `src/modules/forum/forum-rate-limit.ts`: shared atomic admission, finite timeouts, operation isolation, Retry-After exception, periodic bounded expiry cleanup. Counter transaction commits independently so later domain rollback cannot restore credit.
- `forum.service.ts`: awaits admission before target lookup/work; passes the transaction client into target resolvers to prevent nested pool acquisition; transaction-safe duplicate detection; explicit allowed post-update fields; preserves ownership, visibility and moderation locks.
- `forum-policy.ts`: SQL score integer bound. `forum-http-policy.ts` + `forum.controller.ts`: strict protected-header grammar, no-store/nosniff, safe errors and retry header; no auth module modification.
- `src/common/filters/api-exception.filter.ts`: narrowly handles body-parser failures before controller filters. Valid auth/payment/Chat behavior is unchanged and full regression was executed.
- `test/phase7b-security.e2e-spec.ts`, `forum-rate-limit.spec.ts`: adversarial real HTTP/DB and focused storage-failure tests. Existing Forum tests now use distinct legitimate fixture bodies, clean operational rows and expect the stronger quota rather than bypassing it.
- `package.json`/`package-lock.json`: one backend CLI parent patch and its dev-only upstream dependency tree; no forced overrides or runtime dependency update. Lock diff reviewed; all changed package entries are dev tooling (including compatible Vite picomatch dedup).
- Frontend `next.config.ts`, `src/lib/forum/forum-model.ts`, its test, and `src/components/forum/forum-content-security.test.tsx`: scoped security headers, bounded server retry feedback/duplicate/413/503 localization and inert-content regressions. Frontend dependencies/auth/session handling/UI structure unchanged.
- Runtime recovery adds `.node-version` and exact `engines.node` metadata in both package manifests/root lock entries, plus `vitest.config.e2e.ts` runtime qualification and explicit serial fork defaults. Backend lock also adds only the missing optional dev peer `vite-tsconfig-paths/node_modules/typescript@5.9.3`; root TypeScript 6.0.3 and all previously locked package versions/integrities remain unchanged. Existing Linux libc selection metadata was preserved.

## 7. Rate-limit configuration and storage behavior

| Server operation | Current shared threshold | Previous process-local threshold | Reason |
| --- | --- | --- | --- |
| post | 3 / 60s | 5 / 60s | Ordinary composer use; constrain repeated content/work |
| edit post | 10 / 60s | edit+delete combined 30 / 60s | Separate update budget, preserve normal editing |
| delete post | 5 / 60s | same edit bucket | Separate destructive-action budget; idempotent retries still count |
| comment/reply create | 10 / 60s combined | all comment mutations 30 / 60s | Replies cannot become a second creation budget |
| edit comment | 10 / 60s | same comment bucket | Independent from composing/deleting |
| delete comment | 10 / 60s | same comment bucket | Bound destructive retries and missing-ID probing |
| like/unlike | 30 / 60s combined | 120 / 60s | Idempotence is not free unlimited workload |
| post/comment report | 3 / 600s combined | 10 / 60s | Cap distinct moderation workload as well as duplicate flood |
| ADMIN mutation | 30 / 60s combined | 60 / 60s | Direct hides and report decisions share admin budget |

These are **fixed windows starting at first admitted request**, not sliding-window guarantees. Boundary bursts can approach twice the limit across adjacent windows; this finite burst allowance is documented, not hidden. Counters use PostgreSQL `statement_timestamp()`, not client timestamps or per-instance clocks. Admission uses one `(user_id, operation)` PK and conditional UPSERT; denied credit is not incremented. Clients cannot choose the key. Validation/auth rejection may occur before service admission; the G IP guard remains additional protection.

Each counter contains only UUID, operation, count and timestamps; no text, token, email or device data. Expired keys reset atomically. Every live app schedules a sweep each 60 seconds; each sweep deletes at most **1,000 expired rows**, ordered by indexed expiry, using `FOR UPDATE SKIP LOCKED`. Normal low-backlog retention is window duration (at most 10 minutes) plus sweep interval. Physical deletion is **not guaranteed while all apps are stopped, storage is unavailable, or expiry backlog exceeds sweep capacity**. Production must monitor oldest expired row/count and ensure sweep capacity or an approved operational cleanup job; no unbounded application scan/job was introduced.

Admission and expiry-cleanup transactions use `maxWait=1000ms`, `timeout=2500ms`, SQL `statement_timeout=1500ms`; write admission failure returns sanitized **503**, with no RAM fallback. Cleanup also times out on a table-level lock rather than pinning a pool connection indefinitely; its scheduled caller catches failure and logs only a constant warning. Real table-lock contention verified write denial, bounded cleanup failure, and topics plus `/auth/me` returning 200. This does **not** claim the whole application remains available if the entire shared PostgreSQL database is down. No external paid service or Redis dependency was added.

## 8. Authorization matrix

| Principal | Public reads | Own post/comment writes | Others' author writes | Report | Queue/history | Hide/review |
| --- | --- | --- | --- | --- | --- | --- |
| Anonymous/invalid/expired JWT | Public visibility only | 401 | 401 | 401 | 401 | 401 |
| Revoked/expired/missing session | Public visibility only | 401 | 401 | 401 | 401 | 401 |
| ACTIVE USER | Public visibility only | Allowed within state/quota | 404/no mutation | Visible target only, quota | 403 | 403 |
| ACTIVE ADMIN | Public visibility only on public routes | Own only, same author rules | 404/no mutation | Same report rules | Allowed | Current DB ADMIN + transactional recheck |
| Suspended/deleted account | Content excluded as required | 403 | 403 | 403 | 403 | 403 |
| Demoted former ADMIN with old token | Public reads | Ordinary owner rights only | No impersonation | Ordinary rules | 403 | 403, including pending write after demotion commits |

Current DB role, not token `accountType`, governs privileges. Promotion/demotion is effective on the next request without requiring a refresh. A fabricated ADMIN claim in a valid fixture token for a DB USER was denied. Every protected route was exercised with missing, invalid and expired credentials. Sensitive writes recheck/freeze current actor state through commit. No API allows users to change account role.

## 9. Anti-spam and moderation integrity

- Exact post-body duplicates by the same actor are blocked for 10 minutes even if title/topic differs, including recently hidden/removed posts. This does not normalize Vietnamese/Unicode or modify submitted content.
- Exact comment duplicates by same actor/post/parent context are blocked for 60 seconds. A legitimate short response on another thread is not treated as an identical-context duplicate. Cross-thread volume still shares the user creation quota.
- Unique canonical reaction, per-post row serialization and committed event fencing retain idempotent like/unlike counts/history. A forged body `userId` cannot remove another actor's reaction.
- A report can only name the route's real public target. Existing partial uniqueness/FKs remain intact; duplicate reports consume quota but reuse one row. Distinct reports are also capped. No report count automatically hides/removes content.
- Post: author DRAFT↔PUBLISHED while editable; author soft-delete to REMOVED, including own HIDDEN; ADMIN can hide non-REMOVED, idempotently. HIDDEN/REMOVED cannot be author-published again. No restore endpoint exists.
- Comment: one root/reply level, immutable identity/parent/post, visible-root/same-post enforcement; public children disappear with hidden/deleted/inactive roots. Own edit requires public state; own deletion can remove moderated content.
- Report: OPEN→IN_REVIEW/RESOLVED/REJECTED; IN_REVIEW→RESOLVED/REJECTED. HIDE only with RESOLVED; repeated/terminal transitions conflict. Report decision/hide/audit is atomic; actor comes from authenticated identity. History has no write/delete route.
- Public feed/detail/search/comments always reapply current visibility, including on forged/old cursors. Pagination is bounded 1–50 and data uses explicit public author projections. No unsafe HTML/Markdown interpretation, uploads or automatic URL linking was added.

## 10. Security tests and observed verification

| Executed command/check | Result / evidence |
| --- | --- |
| `npm run test:e2e -- test/phase7b-security.e2e-spec.ts` (initial red) | FAIL intentionally demonstrated duplicate **201/201** and missing no-store header |
| `npm run test:e2e -- test/phase7b-security.e2e-spec.ts -t "cursor integer bounds"` (red) | FAIL: expected 422, got **500 / SQL 22003** before score bound |
| Oversized JSON adversarial request (red) | FAIL before parser fix: expected 413, got **500**; after fix real HTTP returns 413 |
| Node 22.23.4: `npm run test:unit -- --maxWorkers=2` | **158/158 PASS** |
| Node 22.23.4: full E2E, forks, one worker, serial files | **5 consecutive runs × 182/182 PASS / 10 files**, with 27 security cases and all original assertions; final two runs used ordinary `npm run test:e2e` and the committed configuration defaults |
| Historical Node 24.15.0 fork/threads attempts | Intermittent failures including full-process **0xC0000409**; retained as failed evidence and not used to qualify Node 22 or claim Node 24 safety |
| Constrained-pool HTTP regression (`-t "bounded pool"`) | Before fix **500/500** after transaction timeout; after fix **200/200**, observed whole test <1 second. The dedicated test has a 10-second observation budget to expose the pre-fix 5-second transaction failure; production timeouts/guards were not weakened |
| `npm run prisma:validate`, `npm run prisma:generate` | PASS |
| `node <approved-temp>/gomgoods-forum-prisma.cjs status` and `... diff` | PASS: helper verifies test identity then selects TEST_DATABASE_URL for Prisma; 10 applied migrations, no difference |
| Node 22.23.4: backend `npm run build`, `npm run lint`, `tsc --noEmit`, `git diff --check` | PASS; lint 0 errors |
| Node 22.23.4: frontend `npm test -- --maxWorkers=2` | **150/150 PASS / 22 files**, including nine inert-payload cases and retry/storage feedback coverage |
| Frontend `npm run build`, `npm run typecheck`; full ESLint JSON check | PASS; **0 errors / 180 existing warnings**; original production API configuration rebuilt after QA |
| Real Chrome, isolated test backend, 1440px/390px | PASS: public feed/search/topics/cursors, login/refresh, post CRUD/drafts, comment/reply/edit/delete, like/unlike, reports, ADMIN review/hide/history and denied USER moderation |
| Real stored-content browser matrix | PASS: script/img/SVG/event/entity/Markdown/javascript URL/iframe content inert in post/comment/report/audit; exact Unicode/emoji/CRLF persisted; no browser JS/hydration/duplicate-key/chunk errors |
| Browser regression | PASS: Home, Marketplace, Profile, Cart, Checkout, Messages and Chat alias on desktop/mobile |
| Local Next production-mode HTTP/framing smoke | PASS: all four Forum route shapes have DENY/CSP/nosniff; Chromium refused iframe embedding. Non-owned origins were blocked in this **header-only** check; it is not an authenticated production deployment test |
| Node 22.23.4: both repos `npm ci --dry-run --ignore-scripts --no-audit --no-fund` | PASS: lock/manifest compatibility; no destructive dependency reinstall or install scripts in this check |
| Node 24.15.0: E2E config/list probe after qualification guard | Controlled **exit 1**, explicit unsupported-runtime error, no fixtures executed; baseline unchanged |

New HTTP cases include all 16 protected routes × missing/invalid/expired credentials; every ADMIN route with USER/stale claims/demotion; invalidated sessions; duplicate/raw malformed authorization headers; all ownership/body mutation families; foreign-like identity injection; current-role revocation race; SQL/cursor/filter/oversize validation; visibility; per-operation limits; duplicate/report flood/concurrent integrity; two independent Nest/Prisma app instances and app restart; expiry pruning, blocked-store fail-closed behavior and a genuine two-connection-pool regression. Each negative helper compares full-row hashes for post/comment/reaction/report/event/audit state before/after. Operational admission counters intentionally change for authenticated failed attempts; those are not unauthorized domain mutations.

Unit storage mocks test error sanitization only; they are **not** counted as proof of production authorization or atomicity. Real HTTP and PostgreSQL supply that evidence. **Historical Node 24 evidence:** intermittent fork exits included **180/181 + unhandled worker error**, then **3 failed / 144 passed / 15 skipped**, failed Forum setup seeing 43 categories and auth/search assertions. Threads passed once, then aborted Node with **0xC0000409**. Those runs remain failed evidence; no benign cause is assumed. The later repeated Node 22 qualification below supersedes the verification hold only for that exact supported environment.

Interrupted runs required exact cleanup: early security fixtures (14 users), original Forum fixtures (28 users plus one inactive topic; later 19 users), and Chat regression fixtures (42 users, 2 stores, 2 products, 3 temporary categories, 20 conversations, 17 listings and their own sessions/messages). Chat ownership was verified against the original test's UUID-based email/username/category signatures. Before any Chat-fixture deletion, full-row hashes of **every affected table after excluding exactly the captured IDs** were proven equal to baseline; no existing baseline row was removed. Recovery used manifests and fixed exact UUID scopes, not blanket commerce/Chat/category deletion. All 41 original table hashes were then restored, including the original 40 categories and paid payments.

A read-only external exit probe observed normal Vitest SIGTERM recycling during a passing run, not the failing native module; it was removed. The available Windows Application event query did not yield a usable module record. No causal link between the separately fixed pool regression and native exits was established. An initially invalid expired-session fixture violated an existing DB expiry constraint; fixture timestamps were corrected, not the constraint/auth implementation. User/topic UUID manifests support interrupted-run cleanup. No production instrumentation, disabled assertion, guard weakening or test suppression was added. Subsequent mutating verification was bounded to the qualified Node 22 runs and passed preservation every time.

## 11. Database preservation and migration evidence

Read-only baseline was captured **before new migration/test writes**. It records counts and SHA-256 hashes of sorted complete rows for 41 preexisting public domain/auth tables, plus a separate inventory of the nine migration names/checksums/application states. There were 42 public tables including `_prisma_migrations` before this task, 43 after the independent counter table was added. Representative counts: CATEGORY 40, USER 4, AUTH_SESSION 4, REFRESH_CREDENTIAL 4, ADDRESS/CART 2 each, LISTING 2, ORDER/ORDER_ITEM/CHECKOUT_GROUP/PAYMENT 2 each, PAYMENT_EVENT 4, TRANSACTION 1, FORUM_TOPIC 6; Chat and legacy Forum content/report/history tables were empty. The existing PAID payment was preserved.

Only the approved counter table and one migration metadata row were added. All nine original migration names/checksums/application/rollback states remained unchanged; all ten applied SQL checksums match local SQL. After completed verification/recovery, all **41 preexisting table hashes matched**; the final check after the native abort and exact cleanup also matched, with zero operational fixture counters. Real browser before/after compared all **43 current public tables**, including migration metadata/new limiter; all hashes matched after cleanup. Cleanup removed only exact owned Forum and interrupted-regression fixture scopes as documented above; user fixtures cascade their own sessions/credentials. No preexisting commerce/payment/Chat/category row was edited/deleted. PostgreSQL sequence allocations are not row hashes: fixture like events can advance the Forum event sequence, which was not reset; its exact pre-test value was not captured. Sequence-value equality/byte-for-byte database equality is not claimed.

Evidence outside Git, under `C:/Users/Admin/AppData/Local/Temp/opencode/`:

- `gomgoods-forum-security-baseline.json`, `gomgoods-forum-security-state.cjs` (identity/count/hash/checksum gate).
- `forum-security-fixture-manifest.log`, `forum-*-recovered-fixtures*.json`, `forum-original-recovered-topics-*.json` (fixture UUID evidence only).
- `gomgoods-forum-security-gates.cjs`, `forum-security-gates-result.json`, `forum-security-*.log` (latest full gate records the native abort/failed verification; earlier successful and failed runs are also recorded in session execution output).
- `gomgoods-forum-chat-fixture-recovery.cjs`, `phase7a-interrupted-fixture-scope-*.json` (source-signature ownership inventory, pre-deletion unaffected-row hash proof and exact interrupted-regression fixture cleanup).
- `gomgoods-forum-frontend-live.mjs`, `gomgoods-forum-frontend-browser/result.json` and captures (actual isolated browser workflows/preservation).
- `forum-production-headers-result.json` (local production header/framing-only check).

These artifacts contain no raw database rows/credentials in the report. They are supporting local evidence, not required production runtime dependencies.

## 12. Dependency audit assessment

| Finding / package path | Actual exposure and action | Remaining disposition |
| --- | --- | --- |
| Backend GHSA-g3hv-75wg-m249: `@nestjs/cli@12.0.0 → minimatch@10.2.6` | Operator build CLI, not HTTP parser; an upstream same-major parent patch exists. Installed **CLI 12.0.12 → minimatch 11.0.5**, with its dev-only pinned subtree. Node 24.15.0/build/regressions verified. | Fixed. Fresh full and `--omit=dev` audits both **0 findings**, exit 0. |
| Frontend Moderate GHSA-g3hv-75wg-m249: `shadcn@4.22.0 → ts-morph@26.0.0 → @ts-morph/common@0.27.0 → minimatch@10.2.6` | Tooling glob amplification from untrusted patterns; no website input/CLI invocation in inspected source/build. Latest inspected shadcn **4.23.0** still uses ts-morph ^26. | Residual tooling risk under existing scoped controls; no unsupported minimatch major override. |
| Frontend dev ESLint path: `eslint-config-next@16.4.3 → typescript-eslint@8.70.0 → typescript-estree → minimatch@10.2.6` | Developer lint inputs only. Latest inspected typescript-estree **8.72.2** still declares minimatch ^10.2.2. Root minimatch 3.1.5 exists but is not listed in the current advisory's affected >=7 range. | No narrow update demonstrated to eliminate this root advisory; keep verified local inputs. |
| Frontend Low (registry severity) GHSA-gcqx-w48m-w2h4: `shadcn@4.22.0 → deepmerge@4.3.1`, also `@shadcn/registry@0.2.0 → deepmerge` | Prototype poisoning of returned objects when CLI config/registry objects are untrusted. Published deepmerge latest remains **4.3.1**; latest inspected shadcn still requires it. | Not dismissed as preexisting: residual untrusted-registry/config risk remains; no published safe leaf patch verified. |

Current recovery audit: frontend raw `npm audit --json` exits **1**, **13 package findings (11 Moderate, 2 Low)**; `npm audit --omit=dev --json` exits **1**, **6 (4 Moderate, 2 Low)**. Earlier audit output was 12 full findings; the additional current entry is dev dependency `eslint-config-next@16.4.3`, propagated via `typescript-eslint`, not a new advisory root or package-version change. Its actual source use is the trusted static ESLint config and it has **zero production trace hits**. Exactly the two advisory IDs above remain; **0 High/Critical**. Parent propagation is not counted as a distinct exploit. Dependencies were not moved/removed to hide findings, and no suppression/forced downgrade was applied.

Revalidated current frontend: **356 source files / 1,166 module references**, no tooling/process-execution imports, server actions, custom registry or executable deployment hook; **35 production trace manifests, zero affected tooling-package paths**. Only shadcn static CSS is imported. This explains production-manifest findings without asserting universal non-reachability. Existing scoped acceptance in frontend `docs/frontend-baseline-remediation.md` remains limited to checked developer inputs/local deployment: never run CLI/MCP against unverified objects/globs or in public production, and never bridge website inputs to build/config/process execution. A different deployment requires its own evidence/reassessment.

## 13. Residual risks and unverified assumptions

1. No real public ingress/CDN/TLS topology was tested. Public/anonymous IP throttling remains per-handler **process-local**, not a cluster-wide DDoS control; proxy trust stays false and arbitrary XFF is ignored. Deployment must avoid both spoofed-IP bypass and all-users-sharing-one-proxy exhaustion.
2. Feed/search/popular ranking query cardinality/latency under production-sized text/event history has not been load-tested. Literal lowercase substring search and historical ranking can be expensive despite bounded result pages; global like-event fence is a known throughput ceiling. No capacity guarantee is inferred from fixtures.
3. Fixed-window boundary bursts, whitespace/semantic/normalization variants, coordinated accounts and moderator workload beyond the tested per-user budgets remain abuse considerations. No semantic spam classifier, CAPTCHA or notification/auto-hide rule was invented.
4. Counter physical expiry cleanup is bounded/best-effort during outages/backlog; DB pool/failover/network-partition and multi-host traffic behavior were not stress-tested. Shared writable primary, cleanup monitoring and capacity evidence are prerequisites.
5. Frontend developer-tool advisories remain. Local source/trace evidence and prior constrained acceptance do not authorize untrusted CLI inputs or unknown production automation.
6. Framing policy is narrow CSP hardening, **not a complete script-src/nonce CSP**. Production CSP, HSTS, cookie/CORS/origin settings, logging/redaction and network/DB least-privilege policy need deployment-specific review. No headers were claimed to replace plain-text escaping or server authorization.
7. Session revocation is checked on request admission; these tests do not establish cancellation of already-admitted in-flight HTTP requests or erasure of content an authorized client already viewed. Sensitive write role/account state is separately rechecked transactionally.
8. Windows Node 24.15.0 remains unqualified: its native fault was not repaired or conclusively attributed. Integration qualification is restricted to Node 22.23.4 and the recorded worker settings, demonstrated by repeated complete runs. Requalify any Node/OS/native-dependency/worker-pool change; do not bypass `.node-version`/engines/E2E preflight based on an occasional green Node 24 run.

## 14. Production deployment prerequisites

- Review the real deployment: TLS/HSTS, exact public CORS origins and secure cookie configuration, trusted proxy address ranges, API network exposure, no cache of authenticated Forum responses, and effective framing headers through the proxy/CDN.
- Provide tested cluster-wide ingress/public endpoint protection and anonymous request/payload/time budgets. Do not blindly enable `trust proxy` or trust client XFF. Existing auth/Chat process-local throttling is unchanged and needs its own multi-instance deployment review.
- Apply approved migrations using least-privileged, reviewed operator workflow before enabling writes; all Forum app instances must use the same writable PostgreSQL counter store. This session migrated **only test**. Earlier Forum migrations intentionally refuse legacy Forum rows: production legacy-data inventory/mapping safety remains unverified and must not be bypassed by deleting data or editing applied SQL.
- Verify application DB permissions and counter-table grants; monitor 429/503 rates, SQL/pool wait/latency, expired-row age/count and cleanup throughput. Prove failure/recovery and sweep capacity at expected traffic; arrange an approved bounded operational cleanup job if needed.
- Load-test search/feed/history and like fence on representative volumes; establish SLOs and ingress/DB resource controls. Back up/validate production migration safety independently.
- Keep shadcn/MCP/registry/build tooling isolated from website inputs and public runtime; reassess residual advisories for the actual deployment/automation. Validate a compatible Node version for the updated dev CLI tree.
- Use the qualified Node 22.23.4 runtime in build/test/deployment automation and repeat environment-specific CI checks. Node 24 support requires its own native crash/module diagnosis and requalification; do not alter auth, relax guards, remove tests or bypass the runtime preflight.

## 15. Final gate decision / Git boundary

**CONDITIONAL PASS for the qualified environment.** Hardening/runtime regression and preservation evidence now support integration and continued **Phase 7C development on Node 22.23.4**. The current user's conditional authorization permits separate hardening commits and fast-forward local-main integration after exact scope checks. This is **not public production/deployment approval**: the separate ingress/TLS/proxy/capacity/tooling-input prerequisites remain. No universal fix to the Windows Node 24 fault is claimed.

Changes are limited to the reviewed security code/tests, the explicitly approved independent counter migration/model, backend CLI patch, runtime qualification/lock consistency and documentation. Original bases were backend `78b74cb38af12b7de7e698029ebd5fef67c1fc22` and frontend `aa3c14442279a2e0b4c90916139e39a75e61af45`. Final verified commit hashes/merge results are returned in the session Git report. No history rewrite, force operation, GitHub push or deployment is authorized by this recovery. The approved migration remains test-only, with no rollback/reset or historical SQL change.

## Runtime recovery — bounded qualification, 2026-11-10

- **Conclusion:** the exact native fault in Windows Node 24.15.0 is unknown. A reproducible compatible environment was established instead, as authorized: official Windows x64 **Node 22.23.4 LTS (Jod)**, Vitest **4.1.12**, Vite **8.3.5**, `pool: forks`, `maxWorkers: 1`, `fileParallelism: false`. Concurrency inside the tests (parallel HTTP/SQL/session/moderation cases) was not reduced.
- Downloaded only to the approved QA temp directory, verified against Node's HTTPS release checksums. ZIP `node-v22.23.4-win-x64.zip` SHA-256: `cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20`; extracted executable SHA-256: `dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f`.
- Native-boundary inspection found Argon2/rolldown bindings, plus lint/CSS tooling bindings. Same installed Argon2 and rolldown libraries loaded under Node 22; four Argon2 hash/verify probes passed. No package/native-module update was used to manufacture the runtime comparison. The old failure was not blamed on any specific binding without evidence.
- Qualification was finite: three initial consecutive **182/182** runs on unchanged security code/dependencies, followed by two **182/182** ordinary npm runs after project pins and the missing optional compiler peer were synchronized. **5/5 completed, 910 test-case executions**, no skips/unhandled errors/native exits; each run checked test identity and all protected hashes before/after. No fixture recovery was needed in these Node 22 runs.
- `.node-version` and `engines.node` pin both projects to **22.23.4**. Backend `vitest.config.e2e.ts` reads the pin and fails configuration on any other Node version before loading database-mutating test files. A Node 24 list/config probe verified controlled exit 1 and unchanged baseline, not silent test skipping.
- Portable npm exposed a missing optional peer `vite-tsconfig-paths/node_modules/typescript@5.9.3`. The lock was synchronized and that peer installed with lifecycle scripts disabled; **root TypeScript remains 6.0.3, all existing package versions/integrities and Linux libc-selection metadata preserved**. Both clean-install dry runs passed. Frontend lock changes only declare the qualified root engine.
- Node reports were configured with `--report-on-fatalerror --report-exclude-env`, under the QA temp directory. No fatal report was generated during healthy Node 22 runs; absence of a report is not proof of a Node 24 cause. The Windows Event Log query yielded no usable module evidence. No global Node/Python installation, system PATH, env file, database identity or production process was changed. Docker/Linux isolation was unnecessary after successful Windows LTS qualification.
- Evidence: `C:/Users/Admin/AppData/Local/Temp/opencode/forum-runtime-recovery/`: `runtime-artifact.json`, `runtime-guard-result.json`, `e2e-1/`, `e2e-2/`, `e2e-3/`, `e2e-final/`, `e2e-confirm/`, per-gate `result.json`/sanitized `output.log`, and `db-checks.log`. Diagnostic artifacts are external, not shipping dependencies.
- `final-verification.json` aggregates all qualified gates; `frontend-audit-current.json` retains the current raw nonzero audit. The extra reported dev parent was separately inspected for production reachability, not silently waived. No frontend dependency versions/integrities changed.

Reproduce with Node **22.23.4** selected by a version manager or verified portable distribution (check `node --version`); use existing isolated test configuration, then `npm run test:unit -- --maxWorkers=2` and ordinary `npm run test:e2e`. Run backend/frontend build, lint, typecheck, audit and pre/post data checks as documented above. Do not run the write suites on an unverified database or bypass the unsupported-runtime error. Runtime/native dependency upgrades require fresh qualification rather than widening the pin automatically.
