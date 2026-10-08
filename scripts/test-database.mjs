import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(
  `create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
);
await db.exec(
  await readFile("supabase/migrations/202610080001_splitpop.sql", "utf8"),
);
const host = "00000000-0000-4000-8000-000000000001",
  alice = "00000000-0000-4000-8000-000000000002",
  bob = "00000000-0000-4000-8000-000000000003",
  stranger = "00000000-0000-4000-8000-000000000004";
await db.query("insert into auth.users values ($1),($2),($3),($4)", [
  host,
  alice,
  bob,
  stranger,
]);
let actorQueue = Promise.resolve();
function as(user, fn) {
  const job = actorQueue.then(() => runAs(user, fn));
  actorQueue = job.catch(() => {});
  return job;
}
async function runAs(user, fn) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function rpc(name, args = []) {
  return (
    await db.query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
}
async function denied(user, name, args, pattern) {
  await assert.rejects(
    as(user, () => rpc(name, args)),
    pattern,
  );
}
let passed = 0;
function pass(s) {
  passed++;
  console.log("PASS", s);
}
const created = await as(host, () =>
  rpc("create_room", ["Dinner", "Same Name", "own", "MYR"]),
);
const room = created.roomId;
await as(alice, () => rpc("join_room", [created.token, "Same Name"]));
await as(bob, () => rpc("join_room", [created.token, "Bob"]));
const snapshot = await as(alice, () => rpc("room_snapshot", [room]));
assert.equal(snapshot.members.length, 3);
assert.notEqual(snapshot.members[0].user_id, snapshot.members[1].user_id);
pass("Authenticated joining and duplicate display names");
await denied(stranger, "room_snapshot", [room], /access denied/i);
assert.equal(
  (await as(stranger, () => db.query("select * from public.rooms"))).rows
    .length,
  0,
);
pass("Cross-room reads denied by RPC and RLS");
await assert.rejects(
  as(alice, () =>
    db.query("update public.rooms set locked=true where id=$1", [room]),
  ),
  /permission denied/,
);
await denied(alice, "rotate_invitation", [room], /Owner/);
pass("Direct writes and non-owner management denied");
const eid = "10000000-0000-4000-8000-000000000001",
  itemid = "20000000-0000-4000-8000-000000000001";
const receipt = {
  id: eid,
  title: "Dinner",
  currency: "MYR",
  amount: 4400,
  baseAmount: 4400,
  printedTotal: "44.00",
  items: [
    {
      id: itemid,
      name: "Shared rice",
      quantity: 2,
      price: "20.00",
      assignments: [],
      notes: "",
    },
  ],
  charges: [
    {
      id: "service",
      name: "Service charge",
      kind: "fixed",
      value: "4.00",
      discount: false,
      allocation: "proportional",
      participants: [],
    },
  ],
  date: "2026-10-08",
};
await denied(alice, "publish_receipt", [room, receipt, true], /Owner/);
await denied(
  host,
  "publish_receipt",
  [room, { ...receipt, printedTotal: "45.00" }, true],
  /mismatch/i,
);
await as(host, () => rpc("publish_receipt", [room, receipt, true]));
pass("Receipt review and total enforced server-side");
await denied(
  host,
  "finalize_receipt",
  [room, eid, 1, [{ personId: host, amount: 4400 }]],
  /Unallocated/,
);
await denied(alice, "set_item_claim", [room, itemid, bob, 1, 0], /own claim/);
await Promise.all([
  as(alice, () => rpc("set_item_claim", [room, itemid, alice, 1, 0])),
  as(bob, () => rpc("set_item_claim", [room, itemid, bob, 1, 0])),
]);
const claimed = await as(host, () => rpc("room_snapshot", [room]));
assert.equal(claimed.claims.length, 2);
pass("Independent shared claims preserved and impersonation denied");
await denied(alice, "set_item_claim", [room, itemid, alice, 2, 0], /changed/);
pass("Stale claim update rejected");
await as(alice, () => rpc("set_item_claim", [room, itemid, alice, 0, 1]));
await denied(alice, "set_item_claim", [room, itemid, alice, 1, 1], /changed/);
await as(alice, () => rpc("set_item_claim", [room, itemid, alice, 1, 2]));
pass("Removed claims retain revisions and reject stale recreation");
await as(host, () =>
  rpc("finalize_receipt", [room, eid, 1, [{ personId: host, amount: 4400 }]]),
);
let snap = await as(host, () => rpc("room_snapshot", [room]));
assert.equal(snap.balances[host], 4400);
assert.equal(snap.balances[alice], -2200);
assert.equal(snap.balances[bob], -2200);
pass("Finalization conserves allocations and funding");
await denied(alice, "set_item_claim", [room, itemid, alice, 2, 1], /finalized/);
const pid = "30000000-0000-4000-8000-000000000001";
await as(alice, () => rpc("report_payment", [room, pid, host, 1000]));
await as(alice, () => rpc("report_payment", [room, pid, host, 1000]));
snap = await as(host, () => rpc("room_snapshot", [room]));
assert.equal(snap.balances[alice], -2200);
assert.equal(snap.payments.length, 1);
pass("Reported payments are idempotent and do not settle balances");
await denied(alice, "respond_payment", [room, pid, "confirmed"], /recipient/);
await denied(bob, "respond_payment", [room, pid, "confirmed"], /recipient/);
await as(host, () => rpc("respond_payment", [room, pid, "confirmed"]));
await as(host, () => rpc("respond_payment", [room, pid, "confirmed"]));
snap = await as(alice, () => rpc("room_snapshot", [room]));
assert.equal(snap.balances[alice], -1200);
assert.equal(snap.balances[host], 3400);
assert.equal(
  snap.events.filter((e) => e.kind === "payment_confirmed").length,
  1,
);
pass("Only recipient confirms; duplicate confirmation has one effect");
await denied(
  alice,
  "report_payment",
  [room, "30000000-0000-4000-8000-000000000002", host, 1300],
  /exceeds/,
);
pass("Overpayments rejected");
const rejected = "30000000-0000-4000-8000-000000000003";
await as(bob, () => rpc("report_payment", [room, rejected, host, 500]));
await as(host, () => rpc("respond_payment", [room, rejected, "rejected"]));
snap = await as(bob, () => rpc("room_snapshot", [room]));
assert.equal(snap.balances[bob], -2200);
assert(snap.notifications.length > 0);
await as(bob, () => rpc("read_notifications", [room]));
assert.equal(
  (await as(bob, () => rpc("room_snapshot", [room]))).notifications.length,
  0,
);
pass("Rejected payments unresolved; notifications authorized and readable");
await db.query(
  "update splitpop_private.invitations set expires_at=now()-interval '1 day' where room_id=$1",
  [room],
);
await denied(stranger, "join_room", [created.token, "Guest"], /expired/);
pass("Expired invitations denied");
await as(host, () => rpc("lock_room", [room, true]));
await denied(alice, "set_item_claim", [room, itemid, alice, 1, 1], /locked/);
pass("Room lock enforced");
const group = await as(host, () =>
  rpc("create_room", ["Shared", "Host", "group", "MYR"]),
);
await as(alice, () => rpc("join_room", [group.token, "Alice"]));
await as(bob, () => rpc("join_room", [group.token, "Bob"]));
const expense = {
  id: "40000000-0000-4000-8000-000000000001",
  title: "Groceries",
  date: "2026-10-08",
  currency: "MYR",
  inputAmount: "100",
  split: { method: "equal", values: {} },
  participantIds: [host, alice, bob],
  amount: 10000,
  baseAmount: 10000,
  allocations: { [host]: 3334, [alice]: 3333, [bob]: 3333 },
  items: [],
  charges: [],
  payments: [{ personId: host, amount: 10000 }],
};
await as(alice, () => rpc("save_shared_expense", [group.roomId, expense, 0]));
await as(alice, () => rpc("save_shared_expense", [group.roomId, expense, 0]));
assert.equal(
  (await as(host, () => rpc("room_snapshot", [group.roomId]))).expenses.length,
  1,
);
pass("Shared expense retry is idempotent");
await denied(
  bob,
  "save_shared_expense",
  [group.roomId, expense, 1],
  /unauthorized/,
);
await denied(
  stranger,
  "save_shared_expense",
  [group.roomId, expense, 1],
  /denied/,
);
await as(host, () =>
  rpc("save_shared_expense", [
    group.roomId,
    { ...expense, title: "Revised groceries" },
    1,
  ]),
);
await denied(alice, "save_shared_expense", [group.roomId, expense, 1], /Stale/);
pass(
  "Authors and owners can revise; other members and stale revisions rejected",
);
await denied(
  host,
  "save_shared_expense",
  [
    group.roomId,
    {
      ...expense,
      id: "40000000-0000-4000-8000-000000000002",
      allocations: { [host]: 10000 },
    },
    0,
  ],
  /Allocations/,
);
await denied(
  host,
  "save_shared_expense",
  [
    group.roomId,
    {
      ...expense,
      id: "40000000-0000-4000-8000-000000000002",
      payments: [{ personId: host, amount: 9000 }],
    },
    0,
  ],
  /funded/,
);
pass("Forged allocations and unbalanced contributions rejected");
await assert.rejects(
  as(alice, () =>
    db.query("select splitpop_private.compute($1,$2,false)", [
      group.roomId,
      expense,
    ]),
  ),
  /permission denied/,
);
pass("Private financial helpers cannot bypass public authorization");
await as(host, () => rpc("set_room_access", [group.roomId, alice, false]));
await denied(alice, "room_snapshot", [group.roomId], /denied/);
const revoked = await as(host, () => rpc("room_snapshot", [group.roomId]));
assert.equal(revoked.expenses.length, 1);
assert.equal(
  Object.values(revoked.balances).reduce((a, b) => a + b, 0),
  0,
);
await denied(alice, "join_room", [group.token, "Alice"], /revoked/);
pass("Membership revocation denies access and preserves financial history");
await denied(
  host,
  "save_shared_expense",
  [group.roomId, { ...expense, title: "Null revision" }, null],
  /revision required/,
);
await denied(
  host,
  "save_shared_expense",
  [
    group.roomId,
    {
      ...expense,
      id: "40000000-0000-4000-8000-000000000003",
      title: { invalid: "shape" },
    },
    0,
  ],
  /Malformed/,
);
pass("Null revisions and malformed shared documents rejected");
const oddRoom = await as(host, () =>
  rpc("create_room", ["Odd cents", "Host", "own", "MYR"]),
);
await as(alice, () => rpc("join_room", [oddRoom.token, "Alice"]));
await as(bob, () => rpc("join_room", [oddRoom.token, "Bob"]));
const oddId = "50000000-0000-4000-8000-000000000001",
  oddItem = "50000000-0000-4000-8000-000000000002";
const oddReceipt = {
  ...receipt,
  id: oddId,
  amount: 10001,
  baseAmount: 10001,
  printedTotal: "100.01",
  charges: [],
  items: [
    {
      id: oddItem,
      name: "Shared meal",
      quantity: 1,
      price: "100.01",
      notes: "",
      assignments: [],
    },
  ],
};
await as(host, () =>
  rpc("publish_receipt", [oddRoom.roomId, oddReceipt, true]),
);
await as(host, () =>
  rpc("publish_receipt", [oddRoom.roomId, oddReceipt, true]),
);
for (const person of [bob, host, alice])
  await as(person, () =>
    rpc("set_item_claim", [oddRoom.roomId, oddItem, person, 1, 0]),
  );
await denied(
  host,
  "finalize_receipt",
  [oddRoom.roomId, oddId, null, [{ personId: host, amount: 10001 }]],
  /revision required/,
);
await as(host, () =>
  rpc("finalize_receipt", [
    oddRoom.roomId,
    oddId,
    1,
    [{ personId: host, amount: 10001 }],
  ]),
);
await as(host, () =>
  rpc("finalize_receipt", [
    oddRoom.roomId,
    oddId,
    1,
    [{ personId: host, amount: 10001 }],
  ]),
);
const oddSnap = await as(host, () => rpc("room_snapshot", [oddRoom.roomId]));
assert.deepEqual(oddSnap.expenses[0].document.allocations, {
  [host]: 3334,
  [alice]: 3334,
  [bob]: 3333,
});
assert.equal(
  oddSnap.events.filter((e) => e.kind === "receipt_ready").length,
  1,
);
assert.equal(
  oddSnap.events.filter((e) => e.kind === "receipt_finalized").length,
  1,
);
pass(
  "Claim rounding uses membership order; publish/finalize retries have one effect",
);
const large = await as(host, () =>
  rpc("create_room", ["Large balance", "Host", "group", "MYR"]),
);
await as(alice, () => rpc("join_room", [large.token, "Alice"]));
await as(bob, () => rpc("join_room", [large.token, "Bob"]));
const max = Number.MAX_SAFE_INTEGER,
  largeId = "60000000-0000-4000-8000-000000000001";
const largeExpense = {
  ...expense,
  id: largeId,
  participantIds: [alice],
  inputAmount: "90071992547409.91",
  amount: max,
  baseAmount: max,
  allocations: { [alice]: max },
  payments: [{ personId: bob, amount: max }],
};
await as(host, () =>
  rpc("save_shared_expense", [large.roomId, largeExpense, 0]),
);
const largePayment = "60000000-0000-4000-8000-000000000002";
await as(alice, () =>
  rpc("report_payment", [large.roomId, largePayment, bob, max]),
);
await as(bob, () =>
  rpc("respond_payment", [large.roomId, largePayment, "confirmed"]),
);
await as(host, () => rpc("delete_shared_expense", [large.roomId, largeId, 1]));
await denied(
  bob,
  "save_shared_expense",
  [
    large.roomId,
    {
      ...expense,
      id: "60000000-0000-4000-8000-000000000003",
      participantIds: [bob],
      inputAmount: "0.01",
      amount: 1,
      baseAmount: 1,
      allocations: { [bob]: 1 },
      payments: [{ personId: alice, amount: 1 }],
    },
    0,
  ],
  /Balance exceeds/,
);
const afterBound = await as(host, () => rpc("room_snapshot", [large.roomId]));
assert.equal(afterBound.expenses.length, 0);
assert.equal(afterBound.balances[alice], max);
assert.equal(afterBound.balances[bob], -max);
pass(
  "Unsafe balances after revisions are rejected atomically without losing payment history",
);
console.log(`${passed} database checks passed (real PostgreSQL via PGlite).`);
await db.close();
