# Phase 7C — Community campaigns and verified achievements

## Domain and boundaries

Extends the existing `Campaign` / `CampaignParticipant` models. Types are
`COMMUNITY_EVENT`, `ITEM_DONATION` (physical collectibles/books only), and
`COMMUNITY_CHALLENGE`. ADMIN creates drafts, edits drafts, publishes, closes,
cancels and reviews. Active USER accounts participate, including store owners.
No monetary donations, promotions, price/payment changes, reputation or rankings.
The existing legacy participant `score` is retained for data preservation and is
never read, awarded or exposed by these APIs.

Campaigns keep existing `name` storage; the Phase 7C API exposes `title`. Nullable
organizer preserves legacy campaigns without inventing an ADMIN identity or
publishing them. Legacy rows are excluded from Phase 7C. Published criteria,
eligibility and deadlines cannot be edited: draft-only edits avoid retroactive
changes to participants' obligations. Eligibility combines active USER status,
minimum account age (0–3650 days), human-readable conditions/instructions and
optional capacity. Additional qualitative conditions are checked during review.

`REGISTERED → IN_PROGRESS → SUBMITTED → VERIFIED`. A participant may withdraw
before verification, including after closure. Rejection and withdrawal are
terminal; registration retries return the same participation, never reopen it.
Verified completion may be revoked. There is no resubmission/reaward endpoint.
One immutable evidence submission per participation has a UUID retry key; exact
retries return its current state, while changed keys/content conflict.

New registrations, starts and submissions require ACTIVE and
`startsAt <= DB clock < endsAt`, checked **after** campaign-lock waits. Closure or
expiry awards nothing. Timely pending submissions can be reviewed after closure
or expiry; cancellation prohibits new verification. ITEM_DONATION completion
requires the ADMIN to verify the documented physical handover criteria.

## Evidence, achievements and concurrency

Evidence is private plain text (up to 5000 Unicode code points) and an optional
HTTPS link on `drive.google.com`, `photos.google.com`, `imgur.com`, `i.imgur.com`,
`www.youtube.com`, or `youtu.be`. Credentials, ports, IP/intranet hosts, other
schemes, whitespace, backslashes, malformed Unicode and NUL are rejected. No
fetching, embedding, HTML/Markdown execution or file upload is performed.
Frontend owner/reviewer views render evidence and notes as React text.

Public tags say only that the account participated; `verified:false` is explicit.
Public badges require a verified participation and non-revoked achievement, with
references to both participation and the verification audit source. Public
responses omit evidence, email, credentials and session internals. Cancelled
campaigns and inactive users have no public badge/tag display.

Registration capacity, submission and review serialize on the existing campaign
row; the unique campaign/user key is retained. Verification changes participation,
appends audit and issues its unique achievement in one transaction. Revocation
appends a separate action and clears public highlighting without deleting the
achievement or original verification. No API edits/deletes audit history.

Featured selection replaces at most three unique, owned, currently verified
badges while holding an exclusive user lock. Review takes a compatible shared
target-user fence: it serializes against selection without deadlocking participant
requests that already hold a shared user lock. Campaign mutations recheck/freeze
current account/role. Signed access-token expiry and the current session are
rechecked after resource-lock waits using the existing token service and a shared
session-row fence held until commit. Self-review is forbidden even after promotion.

All routes use existing global JWT/session, account, DTO whitelist and IP guards;
protected campaign routes also reuse strict Authorization-header grammar. Scoped
responses/errors have no-store/nosniff, safe error messages and rate-limit retry
hints. Shared PostgreSQL write budgets, separately committed from domain work:
participation 30/min, evidence 10/min, ADMIN 30/min, featured selection 10/min.
Admission fails closed; DB time, atomic UPSERT and bounded expired-counter cleanup
are used. Fixed windows permit boundary bursts; existing public IP guard remains
process-local and does not replace deployment ingress controls.

Cursor pages are bounded 1–50, query/identity scoped, ordered by timestamp/UUID.
Public discovery also freezes a committed publication-audit sequence watermark;
publication allocation is advisory-locked through commit. Newly published older
drafts cannot enter an existing traversal. History is sequence-ordered with its
own watermark and DB wall-clock action times. Current visibility is always
reapplied, so cancellation/revocation may remove items from later pages.

## API inventory

Prefix `/api/campaigns`; ordinary envelopes are `{success:true,data:...}`. Pages
are `{items,nextCursor}`. POST mutation responses are 200 except draft creation
(201). UUID parameters and DTOs are validated; public schemas are in Swagger.

| Method / suffix | Access / behavior |
| --- | --- |
| GET `/`, `/:id` | Public discovery/detail; optional `type`, cursor, limit |
| GET `/me` | Authenticated account's private participation pages |
| GET `/:id/participation` | Current account's private participation or null |
| POST `/:id/register` | USER; idempotent registration |
| POST `/participations/:id/start`, `/withdraw` | USER owner only |
| POST `/participations/:id/evidence` | USER owner; `{submissionKey,text,url?}` |
| GET `/users/:id/achievements`, `/participation-tags` | Public, separately paginated, no evidence |
| GET `/users/:id/featured-badges` | Public; at most three, independent of badge-page position |
| PUT `/me/featured-badges` | Own verified badge IDs, maximum three |
| GET/POST `/admin` | ADMIN discovery / create draft |
| GET/PATCH `/admin/:id` | ADMIN detail / full draft edit with audit note |
| POST `/admin/:id/publish`, `/close`, `/cancel` | ADMIN, mandatory audit note |
| GET `/admin/:id/submissions`, `/audit` | ADMIN private participant/evidence queue and history |
| POST `/admin/participations/:id/verify`, `/reject`, `/revoke` | ADMIN, mandatory note, no self-review |

## Migrations and data safety

Additive migrations only: `20261112000000_community_campaigns` and
`20261112000001_campaign_audit_cursor_fence`. The latter adds the audit sequence
without editing already-applied SQL. Existing columns/rows are retained. Checks
protect policy bounds, submission-state consistency and featured-slot bounds;
FKs preserve verification sources. Application transactions enforce cross-row
eligibility, reviewer identity, featured selection and issuance semantics.

Only the actual socket peer **127.0.0.1:55432**, database **gomgoods_test**, schema
**public**, was used for migrations and mutating tests. A pre-migration snapshot
captures 43 existing tables with frozen-column full-row hashes. Existing migration
metadata/checksums are checked separately. Browser smoke captures all 46 current
public tables before fixtures and proves full-row equality after exact UUID-scoped
cleanup. Existing application data was not accessed or migrated. PostgreSQL audit
and Forum sequence values can advance during fixtures and are not reset; bytewise
database/sequence equality is not claimed. No reset, truncate or seed was run.

## Verification and integration decision — 2026-11-12

Qualified SHA-256-matching portable Node **22.23.4** was used throughout. Existing
Graphify index at the approved QA temp `gomgoods-forum-pattern-graph` was queried
for auth/Prisma/locking context (165 nodes); source inspection supplied campaign
facts. No index was rebuilt.

| Check | Result |
| --- | --- |
| Backend unit, Vitest unit config, maxWorkers=2 | PASS: 173/173, 33 files |
| Full PostgreSQL E2E, qualified serial-fork config | PASS: 199/199, 11 files; 17 new campaign cases |
| Prisma validate/generate, identity-guarded deploy/diff | PASS; 12 applied migrations, no schema drift |
| Backend Nest build, TypeScript, oxlint | PASS |
| Frontend tests | PASS: 159/159, 23 files; 9 campaign UI cases |
| Frontend production build, types, full lint | PASS; 0 ESLint errors / 180 existing warnings |
| Real Chrome, 1440px/390px | PASS: admin create/publish, registration/start/evidence, verification/audit, profile highlight/seller badge, close/revoke, inert XSS and regression routes |
| Data preservation | PASS: original protected data and browser all-46-table hashes |
| Two-axis source/security follow-up | Previous lock, session, cursor/history and draft-navigation findings resolved; no remaining confirmed Critical/High/Medium scoped-code finding |
| Backend full / production dependency audits | PASS: zero findings in both |
| Frontend full / production dependency audits | FAIL integration gate: full 11 Moderate / 2 Low; production-manifest 4 Moderate / 2 Low; 0 High/Critical; existing minimatch/deepmerge tooling advisories |

Earlier new-test failures were corrected rather than suppressed: revoked-session
fixtures now satisfy the existing revocation-reason check; each campaign case
cleans only its own captured fixtures; frontend evidence tests wait for the real
deadline clock to enable submission. Browser's initial exact select-label locator
was corrected; no application permission or assertion was relaxed.

**Integration blocked:** the user's strict gate allows no unresolved Medium
blockers. Existing frontend Moderate tooling advisories therefore prevent BOTH
commits and both fast-forward merges. Both `feature/phase-7c-community-campaigns`
branches remain uncommitted; local main histories remain unchanged. No push or
deployment. Resolve the documented dependency advisories with a compatible,
separately reviewed dependency change and rerun affected gates before integration.

## Final security gate — local integration acceptance, 2026-11-12

**CONDITIONAL PASS under the user's final-gate instruction.** This supersedes the
earlier strict-audit hold above: unchanged developer-tool advisories may be
accepted only within the existing verified input/local-deployment controls.
Full evidence and control limits are in frontend
`docs/phase7c-community-campaigns.md`, “Final security gate — scoped acceptance”.

Fresh audits retain only frontend `GHSA-g3hv-75wg-m249` (minimatch, Moderate) and
`GHSA-gcqx-w48m-w2h4` (deepmerge, Low): full **11 Moderate/2 Low**, production
manifest **4 Moderate/2 Low**, **0 High/Critical**. Raw audits still exit 1. Backend
full/production audits both have **zero findings**. Parent propagation is not a new
advisory. No new/changed/public-facing exploitable finding is accepted here.

Minimatch first fixed **11.0.1** is outside the installed parents' `^10` ranges;
latest compatible 10.x remains **10.2.6**. Current shadcn **4.23.0** and
typescript-estree **8.72.2** retain the affected dependency ranges. Deepmerge
latest remains **4.3.1**, with no published first patched version. No safe narrow
security fix was available; both dependency graphs/manifests remain unchanged.

Fresh frontend source/production inspection covers **365 files / 1,225 module
references**, **39 production traces**, and Campaign additions. It found no
affected JavaScript tooling import, server action, arbitrary module/eval/process
execution, remote build/config hook, custom registry or website-to-tooling input
bridge. Only the existing static shadcn CSS export is consumed. Existing controls
prohibit unverified CLI/config/glob/registry input, production CLI/MCP execution,
and website data reaching build/lint/config/process boundaries; reassess on any
change or new patch/advisory. Acceptance is limited to the inspected developer
workflows/local Next build/start path, not public deployment or arbitrary tooling.

Finalization changes documentation only; captured non-Markdown file hashes guard
all source/tests/configuration/dependency files. Reuse prior qualified Node
**22.23.4** results: **173/173 unit, 199/199 full PostgreSQL E2E** (and final
**17/17** campaign rerun), Nest build, typecheck, lint, Prisma validate/generate,
frontend **159/159**, production build/types/lint and Chrome 1440px/390px smoke.
Campaign registration/evidence/verification/highlight/revocation, Unicode and
profile privacy/API compatibility were exercised against the real test backend.

Fresh DB gate verifies actual peer **127.0.0.1:55432/gomgoods_test**, schema
**public**, before read-only checks. **12 applied migrations**, status up to date,
no schema drift; historical SQL/metadata/checksums are unchanged. All **43 original
protected-table frozen-column hashes** match, preserving **40 categories** and
commerce/payment/stock, Chat and Forum data. Reused browser evidence restores all
**46 current public-table hashes** after exact fixture cleanup. No fresh fixtures,
data deletion, migration application, seed or dev/prod DB access is needed.

All scoped functional/security conditions support the user-authorized commits
and separate local-main fast-forward merges after final index/diff/clean-tree
checks. No push/deployment. Actual hashes/merge results are supplied in the final
Git report. Supporting evidence is external under approved QA temp
`phase7c-final-gate/`; neither secrets nor QA runtime artifacts are staged.
