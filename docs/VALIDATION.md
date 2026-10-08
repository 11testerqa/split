# Validation — 8 October 2026

## Delivered

- Existing React/TypeScript/Vite app and four local workflows preserved on main.
  The original calculation engine is unchanged; version-1 local backups remain
  compatible. Shared data uses separate storage and never uploads local sessions.
- Real, bundled Tesseract OCR with worker preprocessing, source geometry and
  confidence, exact reconciliation, manual correction, crop/rotation, cancellation,
  local review recovery and an accessible native source-detail bottom sheet.
- Supabase anonymous-auth client, expiring hashed invitations, private presence,
  authenticated room snapshots, RLS and transactional database mutations.
- Independent shared item claims with revision tombstones, member-order cent
  rounding, owner corrections, unallocated-cost prevention and multiple payers.
- Shared equal/group/trip expenses, revisions, manual conversion snapshots,
  immutable activity, recipient-specific notifications and failed-write recovery.
- Debtor-reported partial repayments, recipient confirmation/rejection,
  idempotent actions, pending-payment reservation and exact settled balances.
- Home/Activity/Groups/Trips/Settings navigation, pending confirmation cards,
  QR/WhatsApp/copy/Web Share invitations and existing reports/exports.

## Checks performed

| Check                                | Result                  | Evidence / coverage                                                                                                                                                                                                                               |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest                               | 39 passed               | 25 existing finance/backup tests, 11 receipt parsing/reconciliation tests, 1 React review test, 2 provider cancellation tests                                                                                                                     |
| PostgreSQL migration / authorization | 22 checks passed        | Real PostgreSQL via PGlite: RLS, member/owner/author roles, cross-room denial, direct-write denial, stale/null revisions, tombstones, forged money, revoked access, invitations, payments, notifications, atomic rollback and safe-integer bounds |
| Client/server calculation parity     | 60 cases passed         | Four allocation rules, ordered tax/service, selected discounts, tips, MYR/JPY/KWD precision and stored manual conversion                                                                                                                          |
| Existing browser regressions         | 24 passed               | Desktop/mobile: four local modes, drafts, persistence, revisions, settlements, import/export, PDF/sharing and targeted accessibility                                                                                                              |
| Scanner browser checks               | 8 passed                | Actual image recognition, mandatory review, native source dialog/keyboard dismissal, saved corrections, failure recovery, slow initialization cancellation, reduced motion and narrow layout                                                      |
| Shared integration browser checks    | 6 passed                | Independent guest sessions: member-added expenses, simultaneous shared claims, complete scan-to-confirm journey, partial repayment, recipient confirmation, recovery and retained failed-action errors                                            |
| TypeScript / production build        | Passed                  | Bundled OCR worker/WASM/language assets; each asset below Cloudflare Pages' 25 MiB per-file limit                                                                                                                                                 |
| Production static smoke              | Passed                  | Mobile production preview and actual image recognition with bundled assets; no page errors                                                                                                                                                        |
| Production dependency audit          | 0 known vulnerabilities | `npm audit --omit=dev`, at verification time                                                                                                                                                                                                      |
| Lockfile consistency                 | Passed                  | `npm ci --dry-run --ignore-scripts --offline` with locked dependencies                                                                                                                                                                            |
| Diff whitespace / history            | Passed                  | `git diff --check`; changes continue main from 1c6f612 without rewriting previous work                                                                                                                                                            |

Browser checks were run across desktop Chromium and an emulated iPhone viewport
using Chromium. The full local suite passed; after OCR cancellation changes the
scanner checks were rerun, and the shared suite was rerun against the final SQL.
The test-only bridge executes the production migration and actual database RPCs.
Its auth transport is synthetic and it does not implement Supabase WebSockets.
These results establish covered application/SQL behavior, not hosted transport
or physical-device certification.

A maximum-money boundary test caught PostgreSQL's default floating-point overload
for currency powers. Currency scaling now explicitly uses numeric arithmetic.
The boundary test also proves that unsafe balances caused by expense deletion/
revision after confirmed transfers roll back atomically and retain payment history.

## OCR measurements

See `ocr-benchmark.json` for the exact measured output and timings. A generated
synthetic receipt was recognized by real Tesseract, with original and contrast
preparation. Both runs extracted two correct descriptions, unit prices and
quantities, the correct RM67.28 total and a reconciled bill, with no failures.
This is a reproducible functional check, not a real-receipt accuracy benchmark.
No permission-cleared real photographs or ground truth were supplied. Correction
time and specialized cloud-provider comparison remain unmeasured.

## Required configuration and remaining validation

Set the public Supabase URL/key, enable anonymous sign-ins, apply the migration,
and verify Realtime publication and private-channel policies. Follow
`SUPABASE.md` for the two-browser hosted validation procedure. No Supabase project
was configured in this environment, so no hosted data or schema was modified.

Still required before a production-readiness claim:

- Hosted Supabase Auth, private presence, live notifications, WebSocket reconnect
  and simultaneous operations on independent PostgreSQL connections.
- Permission-cleared Malaysian/café/food-court photographs: long, tilted, blurry,
  faded, repeated-item, SST, service and discount receipts, with verified truth.
- Physical Android/iOS capture, gallery and permission-denial behavior; native
  share sheets, QR scanning and WhatsApp delivery.
- Full assistive-technology review beyond automated targeted WCAG checks.

Automatic deskew/perspective correction, multilingual OCR models, cloud OCR,
push notifications, account linking/recovery, live FX and bank transfers remain
follow-ups. Groups and trips share the room schema and 30-day edit policy. Shared
JSON exports are archival, not identity-restoring database imports. Raw photo
regions are unavailable after closing/reloading a review because photos are not
persisted. OCR source text and corrections remain locally recoverable until
explicit deletion or successful use. The original bundled PDF font covers Latin,
Greek and Cyrillic; use Print / Save as PDF for other scripts.

Next steps are hosted configuration/transport verification, real-device testing
and a cleared real-receipt benchmark. The code, tests, setup and limitations are
reviewable in the repository; this delivery does not claim production readiness.
