# Phase 7A — Buyer / Seller Realtime Chat

## Domain and persistence

One conversation per `(buyerId, listingId)`, with exactly two User participants.
Creation resolves the personal seller or `Listing.product.store.userId` on the
server. There is no STORE account type, arbitrary participant API, admin override,
or ownership transfer of history. New threads require a public listing and active
buyer/seller accounts. A buyer cannot chat with themselves.

The immutable application context snapshot contains listing identity, description,
price/condition, product name, seller identity/username and store identity/name/avatar.
Messages and context are not re-derived from mutable catalogue data. The listing
and store IDs are historical identifiers without live catalogue foreign keys.
SOLD/INACTIVE listings do not disable an existing thread. Store-backed sending
requires the original owner and an ACTIVE live store; missing, suspended, closed
or transferred stores are read-only. Non-ACTIVE accounts cannot access chat.

Migration `20261025000000_add_phase7a_chat` extends the existing three chat tables.
It is transactional and refuses any pre-existing chat data rather than inventing
a buyer/listing mapping or resetting receipts. It adds unique thread/message keys,
sender membership FK, content/sequence/receipt checks and deferred exact-two-member
checks. Existing migration files and commerce tables are not modified.

Follow-up migration `20261025010000_harden_phase7a_chat_invariants` makes historical
context/member identity immutable, prevents persisted sequence/receipt regression,
and checks the full text length including surrounding spaces. It does not rewrite
the applied migration or transform existing message contents. Both migrations are
transactional and fail rather than silently repairing incompatible data.

The general development seed's chat fixture is updated for the new constraints;
it is not run as part of this phase or E2E. Never run it against the demo test DB.

## REST contract

All routes require Bearer access JWT and a current active session. Standard envelopes:

```json
{"success":true,"data":{}}
```

```json
{"success":false,"error":{"code":"RESOURCE_NOT_FOUND","message":"Chat resource not found","details":[]}}
```

| Route under `/api/chat` | Body / query | Data |
| --- | --- | --- |
| POST `/conversations` | `{listingId}` | `{conversation,created}`; 201 new, 200 existing |
| GET `/conversations` | `cursor?,limit=30` | `{items,nextCursor}`; each item has unreadCount |
| GET `/conversations/:id` | — | conversation |
| GET `/conversations/:id/messages` | `before?` OR `after?`, `limit=30` | `{items,hasMore,nextCursor}` |
| POST `/conversations/:id/messages` | `{clientMessageId,content}` | `{message,duplicate}`; 201 new, 200 replay |
| PUT `/conversations/:id/delivery` | `{messageId}` | receipt watermark |
| PUT `/conversations/:id/read` | `{messageId}` | receipt watermark |
| GET `/unread-count` | — | `{unreadMessages,unreadConversations}` |

Conversation fields: id, buyerId, sellerUserId, listingId, storeId, contextSnapshot,
lastSequence, createdAt, updatedAt, lastMessage, participants. Participants contain
only userId, lastDeliveredSequence and lastReadSequence; no email/session credentials.

Message fields: id, conversationId, senderId, clientMessageId, sequence, content,
status, sentAt. All BIGINT sequences/watermarks are **decimal strings**. Dates are
ISO strings. Text is 1–2000 Unicode code points and must contain non-whitespace.
It is stored as plain text, not interpreted HTML. IDs must be UUIDs.

Messages default to descending sequence. `before` returns older messages descending;
`after` returns newer messages ascending and accepts `0` for initial catch-up. Follow
nextCursor in the same direction until hasMore=false. Limit is 1–100. Sequence cursors
are interpreted only within the authenticated conversation. Inbox cursors are opaque,
member-scoped `(updatedAt,id)` boundaries; the live inbox can move during pagination,
so deduplicate/refetch it on updates.

401 means invalid/expired/revoked authentication; 403 means inactive account, sender
attempting a recipient receipt or read-only store chat; 404 hides absent/foreign chat
resources equally; 409 means idempotency identity/content conflict or self-chat;
422 means invalid input/cursor; 429 means rate limit. No client-supplied sender,
status, sequence, participant list, amount or arbitrary fields are accepted.

## Socket.IO contract

Namespace `/chat`; Engine.IO path `/socket.io`, **not** `/api/socket.io`.
Use a configured `CORS_ORIGINS` origin; handshake Origin is enforced for WebSocket
upgrades as well as HTTP transports. Do not put JWTs in URLs. Example Next.js client:

```ts
const socket = io(`${backendOrigin}/chat`, {
  path: '/socket.io', auth: { accessToken },
});
const ack = await socket.emitWithAck('conversation.subscribe', { conversationId });
```

Client commands return exactly one success/error envelope through the Socket.IO
acknowledgement callback. Server notifications carry their canonical payload directly.

| Command | Payload |
| --- | --- |
| `conversation.subscribe` / `conversation.unsubscribe` | `{conversationId}` |
| `message.send` | `{conversationId,clientMessageId,content}` |
| `message.delivered` / `message.read` | `{conversationId,messageId}` |

| Notification | Payload |
| --- | --- |
| `message.created` | canonical message; only subscribed authorized sockets |
| `receipt.updated` | `{conversationId,userId,lastDeliveredSequence,lastReadSequence}` |
| `conversation.updated` | `{conversationId}`; invalidate member inbox/unread |
| `auth.expired` | `{reconnect:true}`; connection is closed |

Handshake errors expose only a sanitized error envelope in `connect_error.data`.
JWT/session/account are checked on handshake, every command and immediately before
outbound delivery. Idle sessions are revalidated every second and disconnected when
invalid, including logout-all. No content is broadcast blindly to a room. ADMIN must
be an actual participant. Socket subscriptions are not authorization grants.

## Ordering, receipts and reconnect

SENT means committed in PostgreSQL. DELIVERED means the recipient client acknowledges
receipt; READ means the recipient acknowledges reading and implies DELIVERED. Sending
does not deliver/read the sender's own message. Receipt message IDs must belong to the
same thread and be incoming to the actor. They advance cumulative watermarks monotonically
across devices; stale receipts never regress state and cannot acknowledge future messages.
Clients must acknowledge only the highest contiguously received/read incoming message.

Sending and receipts lock the conversation row. Sequence allocation, message persistence
and activity update commit atomically; receipt watermark and message statuses likewise.
Unread counts exclude the actor's own messages and are queried from persisted messages,
not inferred by subtracting sequences. Receipts do not reorder the inbox.

Unique `(conversationId,senderId,clientMessageId)` deduplicates REST/WS retries together.
Reuse the same key/content after an ambiguous timeout; changing content returns 409.
Duplicate attempts consume budget and do not emit a new message event.
UUID inputs are case-insensitive; persisted IDs and realtime routing/receipt
payloads use the canonical database UUID, including when REST/WS callers use uppercase.

Realtime notifications are best-effort **after commit**, not a durable event queue.
On reconnect: refresh JWT through the existing REST/cookie/CSRF flow if needed, subscribe,
then fetch `after=lastPersistedSequence` until exhausted while buffering live events.
Merge by canonical message ID/sequence and refetch receipts/inbox/unread. This recovers
a disconnect after commit but before ACK/emit. No exactly-once network delivery is promised.
Render text through normal React escaping; do not use dangerouslySetInnerHTML.

## Tiếng Việt, Unicode và tích hợp Next.js

- PostgreSQL server/client encoding must be `UTF8`; E2E checks both. REST JSON and
  Socket.IO preserve accented Vietnamese, supplementary emoji, emoji modifiers,
  ZWJ/variation selectors, special characters, LF/CRLF, tabs and leading/trailing spaces.
- Content is preserved exactly: no ASCII conversion, accent removal, translation,
  trimming, HTML stripping, automatic NFC/NFD normalization or truncation. Distinct
  NFC/NFD sequences are distinct idempotency payloads. Retry the exact original text
  with the same clientMessageId; changed text still returns RESOURCE_CONFLICT.
- The 2000 limit counts Unicode scalar values/code points, consistent with PostgreSQL
  `char_length`, JSON Schema maxLength and `Array.from(content).length` in JavaScript.
  It does **not** count UTF-16 code units or grapheme clusters: `😀` counts 1, `❤️`
  counts 2 and `👩🏽‍💻` counts 4. Combining marks count separately; decomposed Vietnamese
  remains supported and unchanged. REST/WS/service all share the same validation.
- Messages exceeding the limit are rejected as a whole with VALIDATION_FAILED (422
  for REST); they are never sliced through a surrogate pair or compound emoji.
  Unpaired surrogates and NUL (not representable in PostgreSQL text) are also rejected
  with VALIDATION_FAILED rather than repaired/replaced or allowed to reach a DB error.
- Literal `<script>`/HTML is supported as plain text. The backend never executes it;
  Next.js must use React text interpolation and preserve line breaks, with no raw HTML
  insertion or automatic Markdown/HTML execution. Use a Unicode-capable font stack.
- Do not set textarea `maxLength={2000}` as the Unicode policy: browsers count UTF-16
  units there. Show a code-point counter and reject over-limit content without silently
  rewriting it. Keep the original string for optimistic messages and retries.
- Keep machine error codes and SENT/DELIVERED/READ enum values unchanged. The default
  UI locale is `vi-VN`; translate by code, not by matching English error.message.
  Default labels are:

  | UI key / status | Nhãn mặc định |
  | --- | --- |
  | messages | Tin nhắn |
  | SENT | Đã gửi |
  | DELIVERED | Đã nhận |
  | READ | Đã xem |
  | typing | Đang nhập... |
  | empty | Chưa có tin nhắn |

  `typing` is a UI label for a future typing indicator, not a new Phase 7A socket event.

- Store message instants in the existing `timestamptz`; transport canonical UTC ISO
  timestamps ending in `Z`. Do not shift stored timestamps by seven hours. Display
  them in Next.js using explicit `Asia/Ho_Chi_Minh` and `vi-VN`, independent of the
  browser/server default timezone:

```tsx
const sentAtFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
});

// message.content is a text child, never HTML. Keep LF/CRLF visually as lines.
<p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.content}</p>
<time dateTime={message.sentAt}>
  {sentAtFormatter.format(new Date(message.sentAt))}
</time>
```

For example, `2026-10-25T18:05:00.000Z` displays on **26/10/2026 at 01:05** in
Vietnam. The UTC value sent back to the API or retained in the client cache stays
unchanged. Frontend components/localization are implemented in the frontend repository;
this backend contract and sample define the required integration behavior.

## Limits / deployment

Single backend instance only: shared in-process REST/WS sliding windows enforce 30
message attempts/minute/user and a burst of 5/second, 10 thread-creation attempts/minute/user.
Additional bounds: 120 WS commands/minute/user, 20 authenticated connection attempts/minute/user,
5 concurrent sockets/user, 50 subscriptions/socket, 60 Engine.IO handshakes/minute/source IP,
16 KiB transport message payload. HTTP's existing global throttling also remains in force.
Duplicate creation attempts consume budget; invalid DTOs are rejected before persistence.
Restart resets these in-memory budgets. Reverse proxies must preserve WebSocket upgrades;
the handshake limiter uses the actual socket peer, not untrusted X-Forwarded-For.

There is no Redis, attachment/edit/delete/group-chat API, automatic ownership transfer,
or guaranteed push replay. Scale-out needs a shared adapter, revocation and limiter strategy.

## Verification safety

Before migrations/E2E verify the isolated test target `localhost:55432/gomgoods_test`,
actual PostgreSQL database/schema/port, and separation from the application URL. Inventory
legacy chat read-only first. E2E uses UUID-scoped fixture cleanup, real Socket.IO clients
and PostgreSQL transactions/locks; it checks protected commerce/payment/category snapshots.
Never reset, truncate, seed or migrate the application database to run this suite.
