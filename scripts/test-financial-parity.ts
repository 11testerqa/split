import assert from "node:assert/strict";
import { createHarness } from "./database-harness.mjs";
import {
  allocate,
  bill,
  convert,
  distribute,
  money,
  inputMoney,
} from "../src/calculations/engine";
import { randomUUID } from "node:crypto";
import type {
  Charge,
  Currency,
  ExpenseItem,
  SplitRule,
} from "../src/domain/model";
const { db, run } = await createHarness();
const people = [randomUUID(), randomUUID(), randomUUID()];
for (const person of people)
  await db.query("insert into auth.users values ($1)", [person]);
async function rpc(user: string, name: string, args: unknown[]) {
  return run(
    user,
    async () =>
      (
        await db.query(
          `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
          args,
        )
      ).rows[0].result,
  );
}
const room = await rpc(people[0], "create_room", [
  "Parity",
  "Host",
  "travel",
  "MYR",
]);
for (let i = 1; i < people.length; i++)
  await rpc(people[i], "join_room", [room.token, `Person ${i}`]);
let cases = 0;
for (const currency of ["MYR", "JPY", "KWD"] as Currency[]) {
  for (const method of [
    "equal",
    "exact",
    "percent",
    "weight",
  ] as SplitRule["method"][]) {
    for (let seed = 1; seed <= 5; seed++) {
      const input = inputMoney(10000 + seed, currency),
        initialAmount = money(input, currency);
      const equal = distribute(
        initialAmount,
        people.map((p) => [p, "1"]),
      );
      const rule: SplitRule = {
        method,
        values: Object.fromEntries(
          people.map((p, i) => [
            p,
            method === "exact"
              ? inputMoney(equal[p], currency)
              : method === "percent"
                ? String([20, 30, 50][i])
                : String(i + seed),
          ]),
        ),
      };
      const charges: Charge[] = [
        {
          id: randomUUID(),
          name: "Service",
          kind: "percent",
          value: "10",
          discount: false,
          allocation: "proportional",
          participants: [],
        },
        {
          id: randomUUID(),
          name: "Discount",
          kind: "fixed",
          value: inputMoney(2, currency),
          discount: true,
          allocation: "selected",
          participants: people.slice(1),
        },
        {
          id: randomUUID(),
          name: "Tip",
          kind: "fixed",
          value: inputMoney(3, currency),
          discount: false,
          allocation: "equal",
          participants: [],
        },
      ];
      const result = bill(
        [],
        charges,
        people,
        currency,
        allocate(initialAmount, people, rule, currency),
      );
      const rate = currency === "JPY" ? "0.03" : "15.25";
      const baseAmount = convert(result.total, currency, "MYR", rate);
      const allocations =
        currency === "MYR"
          ? result.shares
          : distribute(
              baseAmount,
              Object.entries(result.shares).map(([p, n]) => [p, String(n)]),
            );
      const now = new Date().toISOString();
      const document = {
        id: randomUUID(),
        title: "Parity",
        currency,
        inputAmount: input,
        split: rule,
        participantIds: people,
        amount: result.total,
        baseAmount,
        allocations,
        charges,
        items: [],
        payments: [{ personId: people[0], amount: baseAmount }],
        exchange:
          currency === "MYR"
            ? undefined
            : {
                rate,
                originalCurrency: currency,
                baseCurrency: "MYR",
                capturedAt: now,
              },
        date: "2026-10-08",
      };
      const eid = await rpc(people[seed % 3], "save_shared_expense", [
        room.roomId,
        document,
        0,
      ]);
      assert.equal(eid, document.id);
      const snapshot = await rpc(people[0], "room_snapshot", [room.roomId]);
      assert.deepEqual(
        snapshot.expenses.find((e: any) => e.id === eid).document.allocations,
        allocations,
      );
      cases++;
    }
  }
}
console.log(
  `${cases} server/client financial parity cases passed: all split rules, ordered charges, selected discounts, tips and currency precision.`,
);
await db.close();
