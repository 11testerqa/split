# SplitPop

**Split bills. Keep the fun.** A mobile-first, local-first bill-splitting app. No account, backend, paid API, or live exchange-rate dependency.

## Run

Requires Node.js 22.12+ (validated with Node 24) and npm.

```sh
npm ci
npm run dev
npm test
npm run test:e2e
npm run build
npm run preview
```

The browser tests use `/usr/bin/chromium` when available. Else run `npx playwright install chromium`; the configuration uses Playwright's installed browser. On Linux you may also need `npx playwright install-deps chromium` with administrator permissions.

## Workflows

- **Equally Split:** create people, enter the bill, choose a payer, and save exact shares. Advanced exact, percentage, and weighted allocations are also available.
- **Pay Your Own:** add named items, quantities, and notes. Tap people to assign each item. Portion weights allow custom item sharing. Add ordered taxes, fees, tips, or discounts, reconcile an optional receipt total, and record one or multiple payers.
- **Group Split:** keep several expenses in a persistent group. Individual expenses may include different people and payers. Review balances, record actual full or partial transfers, and undo transfers.
- **Travel Split:** create a trip with dates, destination, and base currency. Each foreign expense preserves its original currency, manually entered rate, timestamp, and converted base amount. See a timeline and category/participant spending.

All modes share one calculation engine, expense editor, settlement ledger, and persistence layer. Payers can be people who did not participate. Drafts save automatically. Changing to another session's draft requires confirmation. Only one unfinished expense draft is retained at a time.

## Financial rules

- Money is represented in integer minor units. MYR/USD/EUR/GBP/SGD/THB have two decimals, JPY/KRW have zero, and KWD has three. Unsupported currencies cannot be selected.
- Decimal.js handles decimal input, percentage arithmetic, and conversion. Unsafe amounts and invalid precision are rejected.
- Equal, weighted, and percentage splits use largest-remainder allocation; ties follow participant order. RM100/3 becomes RM33.34 + RM33.33 + RM33.33.
- Percentage allocations must total exactly 100; exact allocations must equal the entered amount. Shared item amounts are unit price times positive integer quantity.
- Charges and discounts apply in their displayed order to the running subtotal. Percentage amounts round half up. Discounts always use consumption proportions among the selected scope to avoid negative shares; the scope can be everyone or selected people. Excessive discounts are rejected.
- The entered bill is assumed to already include everything on the receipt. Add only extra charges, or enter a subtotal and explicitly add charges. Receipt mismatches are never silently corrected. An explicit adjustment creates a visible charge/discount line.
- Foreign expenses are converted once, half up, into the base currency. Converted allocations reconcile with largest remainders. Payer contributions are entered in the base currency. Rates are manual and do not refresh in the background.
- Expenses must be fully funded before saving. Partial contributions can remain in a draft. Net balance is paid minus allocated, adjusted for confirmed transfers.
- Settlement suggestions use deterministic greedy matching, without claiming a mathematically minimum transfer count. Record only payments that actually occurred. Partial transfers reduce the remaining balances.
- Editing/deleting expenses preserves the recorded transfer audit trail; a confirmation warns about existing transfers. Undo is available for the latest deleted expense during the current app visit. Recorded transfers can be individually undone.

## Data & privacy

Sessions, groups, trips, participants, expenses, drafts, settlements, and settings are stored in IndexedDB on this device. No automatic cross-device sync. JSON backups include schema version 1 and are validated before replacement, including participant references and financial conservation. Import asks for confirmation. Export a backup before clearing browser storage. A storage failure is shown, and corrupted existing data is not overwritten automatically.

Copy, WhatsApp, Web Share, local PDF, print, and JSON export are available. Sharing sends only the summary you explicitly choose to share. PDF functionality loads on demand. Reports show original currencies and stored manual rates. No invitation links imply collaborative editing.

## Structure

- `src/domain`: typed entities
- `src/calculations`: pure financial engine
- `src/features`: shared bill editor
- `src/storage`: IndexedDB and backup validation
- `src/components`: reusable form fields, avatars, and CSS depth illustration
- `src/app`: application navigation and session dashboards
- `src/utilities`: text/PDF sharing
- `src/styles`: responsive design tokens, dark mode, print styles, reduced motion
- `tests`: unit invariants and desktop/mobile browser journeys

No continuous 3D rendering. The home illustration uses CSS gradients, perspective, and shadows. Motion respects reduced-motion preferences. Settings follows the device theme or a chosen theme. Fonts and visuals are bundled/local with no external font or image calls.

## Deploy to Cloudflare Pages

Choose this repository, build command **`npm run build`**, output directory **`dist`**, and Node version **24**. No environment variables are required. Navigation is in-app and uses no server routes. `public/_headers` sets basic security and privacy headers. Deployment/publication is separate from building or pushing the repository.

## Scope

This version is single-device and has one draft at a time. It intentionally does not provide live rates, receipt OCR, recurring expense automation, online collaboration, cloud backup, payments, or advertising. The current build and automated tests validate covered workflows; a broad production accessibility/security audit and real-device usability testing remain recommended before a public launch.

## Validation performed

A clean `npm ci`, TypeScript/production build, and **25 unit tests** passed. **24 Playwright checks** passed across desktop Chromium and a mobile Chromium viewport, covering all four modes, rounding, multiple payers, charges and reconciliation, edited/deleted expenses, partial settlements, persistence, backup import/export, PDF, clipboard/WhatsApp/share fallback, and targeted WCAG A/AA scans of the home, editor, group creation, dashboard, and settings. A production static-build smoke check also verified bill creation, persistence after reload, and readable local PDF output. The production dependency audit reported zero known vulnerabilities at validation time.

The browser checks emulate mobile viewports; physical Android/iOS device testing and a full manual assistive-technology audit have not been performed. Native OS share sheets and delivery of WhatsApp messages depend on the user's browser/apps; automated tests intercept the encoded WhatsApp navigation without sending messages. The bundled PDF font supports Latin, Greek, and Cyrillic text; for names in other scripts, use the browser's Print / Save as PDF option with its system font fallback.
