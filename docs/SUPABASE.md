# Supabase deployment and security

## Configure the intended project

- Enable anonymous sign-ins. Configure signup rate limits and abuse controls
  appropriate to the public deployment. If CAPTCHA is enabled, wire its challenge
  into the guest-auth UI before exposing room creation publicly.
- Apply the SQL migration once to an existing Supabase project. It depends on
  Supabase's `auth.users`, `auth.uid()`, `anon` and `authenticated` roles. Use a
  project-scoped administrator/CLI connection; never expose that connection to
  the frontend. The migration creates pgcrypto in `extensions` when needed.
- Set the public URL and publishable/anon key in `.env` locally and Cloudflare's
  build environment. Only these two public values use Vite's `VITE_` prefix.
- The migration publishes `activity_events` to `supabase_realtime` when that
  publication exists. Check it is enabled in the Realtime dashboard. RLS applies
  to postgres_changes reads. Private `room:<uuid>` presence channels require the
  included policies on `realtime.messages`.
- Test on HTTPS with two independent browsers. Supabase projects can differ in
  anonymous-auth limits and Realtime settings; migration success alone is not
  transport verification.

## Schema boundaries

`rooms` holds owner, mode, currency, destination/dates, lock and expiration.
`room_members` links authenticated UUIDs to display names. Groups and trips are
room modes and inherit the same authorization, rather than duplicating membership
in separate tables. Auth identities remain in Supabase's `auth.users`.

`expenses` holds revisions, authors and immutable document inputs for audit.
`expense_items`, `item_claims`, `expense_allocations` and `payer_contributions`
store relational financial facts. Claims use an item/user unique key and retain
revision tombstones when removed. A room-row transaction lock serializes
mutations, while per-claim/expense revisions reject stale edits.

`payment_confirmations` separates reported, confirmed, rejected and cancelled
transfers. Pending reports reserve remaining debt/credit capacity. Confirmation
is recipient-only and has one financial effect. `activity_events` retains actors,
timestamps and expense before/after revisions. `notifications` contains only the
recipient's authorized unread records.

Invitation hashes live in `splitpop_private.invitations` with no client reads.
All helper functions fix `search_path`, have PUBLIC execution revoked, and are
inaccessible to authenticated clients except the RLS membership predicate. Shared
table mutation privileges are revoked. Public security-definer RPCs check the
caller's auth UUID, room membership, owner/author permissions and values; they
never accept a display name as an authorization credential. Do not grant clients
service-role privileges or relax RLS to make a failing client request work.

Receipt images are never stored remotely. Authorized room members can read
reviewed item source text; raw photos exist only in the scanner's memory.

## Hosted verification checklist

Run with two independent guest sessions and a third unauthorized session:

1. Create a room, join with an invitation, and repeat names. Confirm UUIDs differ.
2. Read and mutate another room directly through its RPCs; expect rejection.
   Attempt direct inserts/updates on each shared table; expect permission denial.
3. Claim the same item simultaneously from different database connections; both
   independent claims must survive. Repeat with stale own-claim revisions; reject.
4. Finalize an unclaimed or underfunded receipt; reject. Confirm correct funding
   and compare balances and allocations with the local exact-money engine.
5. Add expenses concurrently; both IDs must persist. Edit the same revision
   concurrently; one succeeds, the other receives a conflict.
6. Report a partial transfer; balances stay unchanged until its recipient
   confirms. Try confirmation as debtor, unrelated member, and nonmember; reject.
   Repeat the recipient confirmation; one ledger effect and event only.
7. Inspect notification privacy and live delivery. Disable the connection,
   expire presence, reconnect, and verify an authoritative snapshot refresh.
8. Expire/rotate an invitation and revoke membership; deny subsequent access.
9. Confirm frontend build contains no privileged credentials and raw receipt
   images produce no outbound request.

The local test harness verifies SQL and application integration. It does not
replace these checks against hosted Supabase Auth and Realtime or independent
production database connections.
