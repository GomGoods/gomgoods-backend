# Phase 7D — C2C realtime auctions

## Approved V1 domain and payment decision

Extends existing `Auction`, `Bid`, `Listing`, `Address`, `Order` and `Payment`;
adds only auction audit/admission tables. USER is the seller/buyer account type,
including Store owners; ownership is resolved through `Store.userId`. ADMIN may
exceptionally cancel before the deadline with a reason. No new account role,
funds system, deposit, escrow, fine, proxy bid, reserve price, Buy Now or automatic
second-highest promotion.

Each auction commits exactly one unit from an ACTIVE, single-unit FIXED_PRICE
listing. Creation locks the listing, checks seller/catalogue/category eligibility,
existing auctions and non-cancelled/non-refunded order items, then sets
`sellingMode=AUCTION`, `status=RESERVED`, `quantity=0`. Existing unique
`Auction.listingId` is retained: one auction per listing, not a new parallel sales
domain. Unsold/cancelled/defaulted listings remain AUCTION/INACTIVE, with stock
released once; a seller must explicitly create a new listing to sell again.
They cannot resurrect the old fixed-price offer or alter auction terms.

**Winner deadline is 30 minutes, not the proposed 24 hours.** Existing prepaid
checkout expires after 30 minutes and existing payment ingestion rejects expired
orders. `PREPAID_EXPIRY_MINUTES` is now a shared constant; no expiry bypass.
Closing creates one PENDING BANK_TRANSFER order/payment using the immutable
persisted winning bid price and private address snapshot, without decrementing
stock a second time. The existing payment pipeline handles mock/SePay Test Mode
and its authorization, amount equality, event idempotency, expiry and PAID CAS.
No provider Live flow or money movement is added.

Prices/increments are integer VND, 1–999999999999 (existing Decimal(14,2) bound).
Start/end require UTC-offset ISO timestamps; configured duration is 1 hour–7 days.
Configuration is immutable after creation, including before first bid. First bid
must meet starting price; subsequent bids must be at least highest + seller's
configured increment. Increments are minimums, not a hardcoded pricing schedule.

## Lifecycle, time and durability

SCHEDULED → LIVE (effective server interval) → AWAITING_PAYMENT → SETTLED, or
DEFAULTED after legitimate order cancellation/expiry. No bid → CLOSED_UNSOLD.
Seller may cancel only before deadline with no accepted bid. ADMIN may cancel a
scheduled/live auction before deadline with a mandatory audited reason; after
closing, existing order/payment lifecycle applies. No individual bid deletion or
withdrawal API exists. Exceptional invalid bids require cancellation of the whole
unclosed auction, preserving all history. Inactive winner/seller/catalogue at
close causes an auditable cancellation; never promotes a second bidder.

PostgreSQL time is checked after blocking auction/listing/address/auth waits.
Each accepted bid serializes on the auction row, validates current USER/session,
server owner and private address, appends its monotonically ordered version and
updates effective end atomically. Identical `(auction,user,idempotencyKey)` retries
return the persisted bid; changed amount/address conflict. Rejected/duplicate
bids do not extend time. With **less than 120 seconds** remaining, a new accepted
bid extends to at least acceptance +120 seconds, capped at original end +30 min.
At the cap the remaining time may be less than two minutes.

An application worker scans durable managed auction rows each second in bounded
batches (25), closes due auctions and reconciles actionable winner orders.
Multiple instances/restarts re-read PostgreSQL; row locks, unique order relation,
state checks and atomic transactions prevent duplicate winner orders or stock
release. No frontend clock/socket is needed. Invalid/unavailable persistence is
retried and logged with a constant warning; operators must monitor reconciliation
backlog/errors. No production traffic/SLO or arbitrary outage recovery guarantee
is inferred from fixtures.

Audit versions record creation, accepted bids (including consecutive leader bids),
cancel, unsold/ineligible close, winner order, payment and non-payment. No audit
edit/delete endpoints. A single non-payment does not suspend an account or impose
a fee. Accepted-key retries still consume admission budget; an unresolved client
key is retained across throttling/auth/transient network failures.

## Security and cross-module integrity

- Current JWT signature/expiry, ACTIVE account and non-revoked session checked;
  transactional shared user/session fences freeze admitted authority. Users
  cannot supply actor, seller, winner, sequence, status, amount totals or reviewer.
- Listing edits/status mutations now lock and re-read before applying changes;
  AUCTION mode cannot be changed through ordinary listing APIs. Product updates
  and archive lock related listing rows in UUID order, then product, and reject
  SCHEDULED/LIVE/AWAITING_PAYMENT commitments. This prevents seller cancellation
  through catalogue archival or item replacement after bids.
- Cart/checkout mutex uses a transaction-scoped per-user advisory lock plus shared
  USER fence. This preserves cart serialization while avoiding a USER/listing
  lock inversion with auctions. Checkout explicitly requires FIXED_PRICE after
  listing locking and in its stock CAS; stale cart requests cannot buy auction
  stock or the old price. Existing concurrency regressions remain enabled.
- Winner expiry uses existing Orders inventory release with `ORDER → PAYMENT →
  inventory` locking and conditional PENDING state transitions. PAID is never
  counted as defaulted/released by that path. Worker only sweeps managed auction
  orders, not unrelated original pending orders.
- REST strict Authorization grammar/no-store/nosniff and sanitized exceptions reuse
  existing policies. DTOs forbid unknown fields; HTTP/IP and Socket.IO origin/body
  policies remain active. Shared PostgreSQL fixed-window budgets: bid 20/min across
  REST/WS/instances, mutations 10/min, socket admission/commands 60/min. Fail closed;
  bounded expired-counter pruning. Connection/subscription caps are process-local
  (5/user, 20/connection), not a claim of cluster-wide ingress/DDoS protection.
- Public selects expose bid UUID/sequence/amount/time and public user ID/username,
  never email, session, token, address or shipping snapshot. Order/payment entry
  is returned only to the actual winner. Audit is seller/ADMIN only. Private
  owned address list/create uses the existing Address model because no address
  REST interface previously existed; addresses remain private and immutable here.
- Blocking self/store-owner bids does not eliminate collusion/secondary accounts.
  Consecutive leader bids are auditable; no device fingerprinting or reputation
  manipulation. All supported text is Unicode plain text, not executable HTML.

## REST / realtime contract

Prefix `/api/auctions`; existing `{success:true,data}` envelopes. Cursor pages are
bounded 1–50 and scoped to query/account. Clock/version values in snapshots are
authoritative; BigInt versions/sequences serialize as strings, VND as decimals.

| Endpoint | Access |
| --- | --- |
| GET `/`, `/:id`, `/:id/bids` | Public discovery, repeatable-read detail, safe bid history |
| POST `/` | USER legitimate seller; immutable configuration and atomic reservation |
| GET `/me` | Authenticated own sold/participated auctions |
| POST `/:id/bids` | USER; `{amount,addressId,idempotencyKey}` |
| POST `/:id/cancel` | Seller before bids, or ADMIN; pre-deadline only, `{reason}` |
| GET `/:id/outcome` | Current account's winner/order/payment navigation, no foreign order ID |
| GET `/:id/audit` | Current seller or ADMIN |
| GET/POST `/me/addresses` | Current account's private existing Address records / USER creation |

Socket.IO namespace `/auctions`, existing transport adapter/origin policy.
Authenticated commands: `auction.subscribe`, `auction.unsubscribe`, `bid.place`.
ACKs use success/error envelopes. `auction.updated` carries a safe complete
snapshot after observing a changed committed version; `auth.expired` disconnects
invalid sessions. Each instance polls subscribed durable versions, so updates
from another instance need no in-memory cross-instance broadcast assumption.
On reconnect, subscribe returns the latest snapshot. Persistence is idempotent;
network delivery is **not exactly once**. Clients deduplicate/reconcile snapshots.

## Migration / verification evidence

Additive migration `20261112020000_realtime_auctions`; no historical SQL edited.
Legacy auctions remain `managed=false`; no legacy auction/bid existed in the
verified test DB. Schema retains old columns and existing winner/price constraints.
Only actual peer **127.0.0.1:55432/gomgoods_test**, schema **public**, was used.
No dev/prod DB access, reset, truncate or seed. Original **46 protected tables**
have frozen-column row-hash snapshots; 40 categories, PAID payments, orders/stock,
Chat, Forum and Campaigns are preserved. New fixture UUID scopes are explicitly
tracked; browser compares all 48 current public-table hashes after cleanup.

Qualified runtime: Node **22.23.4**. Existing 165-node Graphify index was queried;
it does not index this auction/commerce work. Relevant source was inspected directly;
no whole-repository rebuild. Two independent read-only reviews found product
archive bypass, post-deadline cancel, lock inversion, unstable retry/clock and
effective-status issues; fixes and regressions were source-confirmed resolved.

| Check | Observed result |
| --- | --- |
| Backend unit | PASS 183/183, 34 files |
| Full real PostgreSQL/HTTP/Socket.IO E2E | PASS 212/212, 12 files, including 13 auction cases; all original regression suites retained |
| Backend build/lint/typecheck | PASS |
| Prisma validate/generate/status/diff | PASS; 13 migrations applied/up to date, no drift |
| Frontend component/unit | PASS 178/178, 26 files; final terminal-copy regression rerun separately |
| Frontend build/types/full lint | PASS; 0 errors / 180 existing warnings |
| Browser desktop/mobile | PASS real Chrome 1440px/390px: seller creation, private addresses, competing bids, soft-close/reconnect, winner price/payment/loser privacy, unsold/defaulted, regression routes; all 48 table hashes restored |
| Backend full/production audits | PASS, both zero findings |
| Frontend raw full/production audits | Still exit 1: 11 Moderate+2 Low / 4 Moderate+2 Low; exactly existing two advisory roots, 0 High/Critical |
| Frontend scoped reachability | PASS: 372 source files / 1254 references, 41 production traces, zero tooling execution/import/trace paths or server actions; graphs/config/hooks unchanged |

Residual tooling acceptance remains limited to `GHSA-g3hv-75wg-m249` (minimatch)
and `GHSA-gcqx-w48m-w2h4` (deepmerge), under the existing Phase 7C/baseline controls:
reviewed developer source/config/globs/registries only, no website-to-tooling path,
no public CLI/MCP exposure, no unverified remote input, reassess new graph/hooks,
patch/advisory/severity/deployment changes. No forced upgrade or audit suppression.
It is not unrestricted public-deployment approval or acceptance of a new exploit.

An interrupted full-suite run left original concurrency-suite fixtures. Before
cleanup, all 46 unaffected hashes matched after excluding the captured UUIDs;
only those fixture IDs were removed, restoring the baseline. The subsequent full
212-case run and post-run preservation both passed. Initial fixture precision and
mock-provider setup errors were fixed without relaxing DB/auth/rate assertions.
Browser found missing submit types on two new form controls; both were fixed and
covered by component regressions. No failed/interrupted run is reported as PASS.
Brief offline/online recovery also required preserving connected transport state
and refreshing the REST snapshot even when no new Socket.IO connect event fires;
the final browser reconnect and hook regression both pass. Visual review prompted
terminal countdown/order-link copy corrections, verified by component assertions
and a fresh build without changing the proven API/payment/inventory behavior.

External approved-temp evidence: `phase7d-baseline.json`, `phase7d-db.cjs`,
`phase7d-full-e2e-retry1/`, `phase7d-interrupted-fixture-scope.json`,
`phase7d-security/`, and `phase7d-browser-retry3/` (passing full smoke; earlier
attempt failures retained separately). Commit/fast-forward integration
is conditional on all final gates and exact scope; no push or deployment.
