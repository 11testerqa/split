# SplitPop 2.0 migration

The starting point is main at 1c6f612: React 19, TypeScript, Vite, Tailwind,
Motion, Decimal.js, IndexedDB, 25 financial/backup tests and 24 browser checks.
The four modes already share a reliable integer-minor-unit engine. Keep it and
all existing sessions, drafts, imports, exports and local settlement history.

1. Add a local Tesseract worker provider, image preparation, spatial receipt
   parser, exact reconciliation and an editable review. Bundle OCR resources so
   receipt images never need a remote service. Integrate into every expense editor.
2. Add a separate Supabase collaboration boundary. Local sessions remain local;
   creating/joining a live room is explicit. Anonymous auth creates real identities.
   Invite secrets use URL fragments, expire, and are hashed in the database.
3. Store collaborative facts in relational tables. All mutations go through
   authenticated transactional RPCs, with member RLS for reads. Lock room rows
   to serialize mutations. Revision checks prevent stale expense overwrites;
   individual claim revisions preserve simultaneous shared claims.
4. Only recipient-confirmed repayments affect balances. Retain immutable activity
   and payment actions. Never rewrite existing local transfers as unconfirmed.
5. Cache authorized snapshots and unfinished receipt reviews separately in
   IndexedDB. Shared writes require an acknowledged server result; never queue
   financial actions invisibly. Reconnect by refreshing the authoritative snapshot.
6. Verify existing regressions, real image OCR, parser reconciliation, PostgreSQL
   authorization and concurrent workflows, and desktop/mobile browser journeys.

Hosted project setup and physical-device testing are separate from code delivery.
Do not describe the app as production-validated before they are performed.
