# Dependency security remediation — 25 October 2026

## Gate and decisions

Initial `npm audit --omit=dev --json`: **10 vulnerable package entries** (1 Critical,
8 High, 1 Moderate). Entries include propagated parent findings, not ten distinct
CVEs. All were present before Phase 7A. After the updates below, both production
and full dependency audits report **zero vulnerabilities**. No risk acceptance or
advisory suppression is used. No application-framework/ORM major upgrade is used.

## Production-audit paths, exposure and fixes

| Package / path before remediation | Advisory and impact | GomGoods exposure | Resolution |
| --- | --- | --- | --- |
| `@nestjs/platform-express -> express -> proxy-addr 2.0.7` | **Critical** GHSA-jqcg-44mw-7w3h: spoofed client IP with over-broad IPv4-mapped IPv6 trust subnet | Express uses it for `req.ip`/trust-proxy. No trust-proxy setting is enabled in application bootstrap; WS IP limiting uses the socket peer. A future proxy configuration could expose the issue. | Patch to **2.0.8**; no acceptance based on configuration. Regression checks malformed and valid trust subnets. |
| `@nestjs/platform-express -> express -> body-parser 2.3.0` | **High** GHSA-27r3-jxmh-p828: trailing bytes after compressed request can cause an uncaught decoder error and process exit | **Reachable before authentication and routing** through Nest's JSON body parser, including unknown routes. JWT/DTO limits do not mitigate this. | Patch to **2.4.0**. Child-process HTTP regression submits gzip + trailing junk and verifies subsequent requests succeed. |
| `@nestjs/platform-express 12.0.1 -> multer 2.2.0` | **High** GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4, GHSA-q7qp-rjg7-q26m; also GHSA-qvfw-j98x-7q72 and GHSA-3pph-fpjx-jg34: multipart DoS/leaks/filter races | No upload interceptors/Multer middleware are mounted in current modules; chat is text-only. Would become reachable when upload handlers are introduced. | Adapter **12.0.2**, plus a scoped `@nestjs/platform-express` override to **multer 2.5.0** because the upstream adapter still pins an older 2.x release. |
| `prisma 7.10.0 -> @prisma/config 7.10.0 -> deepmerge-ts 7.1.5` | **High** GHSA-ggr8-5vv4-36mx: recursive object merge stack exhaustion; propagated findings for config/Prisma | Prisma CLI loads trusted local `prisma7.config.ts`; no HTTP/WS request controls this configuration. This is not the chat message merge path. | Align **prisma/client/adapter-pg 7.10.1**. Upstream config patch explicitly adopts **deepmerge-ts 8.0.2**; no forced transitive-major override. |
| `prisma 7.10.0 -> mysql2 3.15.3` | **High** GHSA-3f6p-5ww8-9rcr: auth-plugin downgrade/credential disclosure; GHSA-rgwj-5xj2-c3m3: compressed protocol decompression DoS | The application uses PostgreSQL via `@prisma/adapter-pg`; no MySQL connection is opened by application modules. Package is included by Prisma tooling. | Prisma patch **7.10.1** supplies **mysql2 3.24.4**. |
| `@nestjs/cli -> @angular-devkit/core -> ajv -> fast-uri 3.1.7` | **Moderate** GHSA-hrr3-gc8f-f4qj, GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr; related low findings GHSA-xhq7-xmqj-769h and GHSA-333x-w4r6-6crp: URI normalization/host/scheme confusion | Installed tooling graph; not used by application authorization, fixed SePay URL selection or chat routing. | Same-major patch **3.1.9**. |
| `vite-tsconfig-paths -> vite -> postcss -> source-map-js 1.2.1`; also `@vitest/coverage-v8 -> magicast` | **High** GHSA-68fv-2mgg-jv7q: indexed source-map event-loop DoS | Build/test source-map processing, not a user-controlled REST/WS message parser. | Same-major patch **1.2.2**. |

Runtime evidence: `src/bootstrap/configure-app.ts`, `src/prisma/prisma.service.ts`,
`src/modules/chat/chat.adapter.ts`, controller/module imports and `npm ls` dependency
paths. No Multer upload interceptors, MySQL adapter or source-map processing endpoint
is exposed by application modules. These observations do not waive the findings:
all listed installed versions are patched.

The Prisma ORM patch is documented by upstream at
<https://github.com/prisma/prisma/releases/tag/7.10.1>; it also fixes nested
transaction options leaking between transactions. Its `engines-version` artifact
has an 8.x build label supplied by that patch's manifest; the installed ORM/client/
adapter remain **7.10.1**. Existing schema/migrations are unchanged by this upgrade.

## Development-tool findings

After production remediation, full `npm audit --json` still identified tooling
issues. These were also patched, rather than waived as unreachable:

- `@nestjs/cli -> minimatch -> brace-expansion`: **5.0.9 -> 5.0.12** fixes
  GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p (glob expansion DoS).
- `@nestjs/mau -> inquirer -> external-editor -> tmp`: scoped **inquirer 8.2.7**
  replaces the legacy editor/tmp chain; fixes GHSA-52f5-9888-hmc6 and
  GHSA-ph9p-34f9-6g65. No incompatible direct `tmp` override is forced.
- `@nestjs/mau -> undici`: scoped **6.20.1 -> 6.29.1** fixes its HTTP/WebSocket,
  cookie, decompression and EventSource advisories, including
  GHSA-f269-vfmq-vjvj, GHSA-vrm6-8vpv-qv8q, GHSA-v9p9-hfj2-hcw8,
  GHSA-vxpw-j846-p89q, GHSA-rfgv-xxqx-mfg5 and GHSA-4qv8-2p9j-2685.
  This CLI dependency is distinct from Node's built-in fetch implementation.
- Vite **8.2.2 -> 8.3.5** fixes the affected 8.2.x launch-editor/path traversal
  advisories, including GHSA-587h-7wmj-h5pm and the related
  GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-9jrq-w75r-8gcw,
  GHSA-rq7h-c2jc-7f22 and GHSA-vfpm-58rq-9qcg.
- Vitest and coverage package **4.1.11 -> 4.1.12** align their exact peer versions
  and patch mocker GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp.

Mau is an operator-invoked development/deployment CLI; Vite/Vitest run during
development/testing, not from Nest's production entry point. None of these tools
is exposed as a public chat endpoint. No major tool downgrade suggested by the
automated auditor was applied.

## Verification and maintenance

- Required gates: production/full npm audit, Prisma generate/validate, build, lint,
  typecheck, unit and full PostgreSQL REST/Socket.IO E2E.
- DB checks connect only to the verified test database; compare protected commerce,
  stock, payment-event/ledger and 40-category snapshots around E2E. No seed/reset or
  application DB migration is needed for dependency updates.
- Keep scoped overrides until the upstream parent pins patched dependencies; removing
  an override requires a fresh audit and regression verification.
- Audit output is registry/date-dependent; zero findings is the observed result for
  this lockfile on the review date, not a guarantee about future disclosures.
