# SplitPop 2.0

**Split bills. Keep the fun.** Scan a receipt, review it, invite friends, claim
items, record who paid the restaurant, and confirm repayments together.

The original four local modes, exact-money engine, IndexedDB sessions, draft
recovery, version-1 backup import/export, settlement history and reports remain
available. Existing local data is not uploaded or replaced. Live collaboration
is a separate, explicit workflow.

## Run and verify

Requires Node.js 22.12+ (validated with Node 24).

```sh
npm ci
npm run dev
npm test
npm run test:db
npm run test:parity
npm run test:e2e
npm run test:live
npm run benchmark:ocr
npm run build
```

Build/dev bundle the Tesseract worker, WASM cores and English language data from
installed packages into `public/ocr`. No OCR CDN or paid API is required. Generated
assets are ignored by Git. Playwright uses `/usr/bin/chromium` when available;
otherwise run `npx playwright install --with-deps chromium`.

## Receipt scanning

Home prioritizes **Scan a receipt**. Every expense editor supports scanning.
JPEG/PNG capture uses the browser's camera/gallery picker. Review the preview,
rotate by 90°, crop margins, and choose original color or grayscale/contrast.
Pixel processing and quality checks run in a separate worker; recognition uses a
reused Tesseract worker. Cancel, retake and manual entry are available.

The parser retains source lines, OCR confidence, separate parser confidence and
available bounding boxes. It recognizes quantities, wrapped descriptions,
printed unit prices, SST, service charges, discounts, tips and signed rounding.
Cash, change, totals and tender are excluded from items. Repeated lines and
ambiguous prices are flagged. Integer-minor-unit reconciliation shows the
actual difference; confirmation requires a matching total and explicit review.
Edit cards, inspect source regions, merge descriptions, delete incorrect lines
or add missing items/charges. Unfinished corrections save to a separate IndexedDB
store. Raw photos stay in memory and are released on close or retake. No image is
uploaded to Supabase, including when opening the scanner.

## Supabase setup

See [docs/SUPABASE.md](docs/SUPABASE.md) for full setup and hosted verification.

1. Create a Supabase project. Enable **anonymous sign-ins** in Authentication.
2. Apply `supabase/migrations/202610080001_splitpop.sql` using the Supabase SQL
   editor or `supabase db push` against the intended project.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env.example`.
   These are public connection settings. Never put a service-role key in Vite.
4. Restart Vite or rebuild. Enable Realtime for the published activity table and
   allow private presence channels using the migration's authorization policies.

Without these settings, local modes and real OCR work; live-room creation/joining
is explicitly unavailable. The app never substitutes simulated collaboration.

Anonymous sessions use Supabase Auth UUIDs. Display names are presentation only
and may repeat. Clearing a guest's browser session may lose access; permanent
account linking/recovery is a follow-up. Invitation tokens contain 256 random
bits, use URL fragments, are stored hashed server-side, and expire in seven days.
Generating another link revokes the previous token. Rooms accept financial edits
for 30 days; read access and repayment confirmation remain available afterward.

## Live rooms, groups and trips

Create or join rooms from Home, Activity, Groups or Trips. Invitations support QR,
copy, WhatsApp and Web Share. Authorized snapshots sync through Supabase Realtime
with reconnect refresh and a 15-second refresh fallback. Presence expires after
45 seconds; unavailable connections are never shown as online. Current sync and
connection status remain visible. Financial writes require a server response;
failed writes show errors and retain local drafts for explicit retry.

**Pay Your Own:** the owner scans and reviews a receipt, then publishes item
cards. Members claim their own items; shared dishes use positive portion weights.
The owner can correct assignments. Independent claims survive competing updates;
revision checks reject stale changes. Finalization requires every item allocated
and actual restaurant contributions fully funded. Multiple payers are supported.

**Equally Split / Group Split / Travel Split:** every member can add expenses
using the existing editor, including receipt scanning, selected participants,
equal/exact/percentage/weighted splits, charges and multiple payers. Authors and
owners can revise/delete expenses with revision checks and immutable audit
history. Trips retain destination, dates, categories and individual expense
chronology. Original foreign amounts, manual rates, timestamps and converted
amounts are stored without refreshing historical rates.

Reports support copy, print, local PDF and a JSON room export. Local JSON backups
keep their existing version-1 import contract; shared room exports are archival
and do not restore database identities or overwrite shared financial records.

## Financial and authorization rules

Money uses integer minor units. Decimal.js calculates client input and conversion;
PostgreSQL numeric arithmetic independently validates shared writes. Supported
currencies: MYR/USD/EUR/GBP/SGD/THB (2 decimals), JPY/KRW (0), KWD (3).
Largest-remainder allocation conserves totals deterministically. RM100/3 becomes
RM33.34 + RM33.33 + RM33.33. Charges apply in displayed order; discounts use
consumption proportions and cannot make a share negative. Foreign expenses
convert once with a stored manual rate, half up. Payer contributions must equal
the expense total. Suggested transfers use deterministic greedy matching,
without claiming a globally minimum transfer count.

Restaurant funding and reimbursements are different records. Suggested payments
are outstanding. Only the debtor can report a repayment as sent or cancel it;
only the recipient can confirm or reject it. Only confirmed receipts change net
balances. Partial payments, pending-payment reservation, duplicate-action
protection, timestamps and audit events are enforced by the database. Reports
are self-reported transfers outside the app, never bank-verified payments.

Member RLS protects reads across all shared tables. Browser table writes are
revoked; transactional authenticated RPCs enforce ownership, membership,
financial conservation, revisions and row locking. Notification records are
user-specific. Repetitive activity entries are grouped visually. The owner can
lock the room and manage access. The schema and threat boundaries are documented
in [docs/SUPABASE.md](docs/SUPABASE.md).

## Validation and limits

[docs/VALIDATION.md](docs/VALIDATION.md) records the actual checks and known limits.
[docs/ocr-benchmark.json](docs/ocr-benchmark.json) contains measured results from
an explicitly synthetic receipt, using real Tesseract recognition. They are not
real-world receipt accuracy claims. Add permission-cleared real images and
verified ground truth to a manifest, then run:

```sh
npm run benchmark:ocr -- path/to/manifest.json path/to/results.json
```

The benchmark compares original and contrast preprocessing, measuring extraction,
prices, quantities, total accuracy, reconciliation, failure rate and time. Human
correction time and a cloud-provider comparison remain unmeasured. Perspective
correction, arbitrary deskew, push notifications, live exchange rates, bank
transfers and account linking are not implemented. OCR currently loads English.

Database tests use real PostgreSQL via PGlite. Multi-browser integration tests
execute the same SQL through a **test-only** HTTP bridge; guest authentication
transport and WebSocket delivery are not Supabase-hosted in that harness. Hosted
Supabase Auth/Realtime, independent database-connection races, physical Android/
iOS capture, long/faded/tilted real receipts, and full assistive-technology review
still need validation. This delivery does not claim production readiness.

## Deploy to Cloudflare Pages

Build command **`npm run build`**, output **`dist`**, Node **24**. Set the two public
Supabase variables when enabling live rooms. OCR assets are generated during the
build. The largest individual WASM/language assets fit Pages' 25 MiB per-file
limit. `public/_headers` supplies basic security/privacy headers and allows
same-origin camera use. HTTPS is required for native camera/share capabilities.
Publication is separate from building and pushing this repository.
