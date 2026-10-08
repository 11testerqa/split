import { describe, it, expect } from "vitest";
import {
  allocate,
  format,
  balances,
  bill,
  convert,
  distribute,
  money,
  transfers,
} from "../src/calculations/engine";
import { parseBackup, empty } from "../src/storage/store";
import type {
  Expense,
  Session,
  Charge,
  ExpenseItem,
} from "../src/domain/model";
const people = ["a", "b", "c"];
const session = (
  expenses: Expense[] = [],
  settlements: Session["settlements"] = [],
): Session => ({
  id: "s",
  name: "Dinner",
  mode: "group",
  currency: "MYR",
  people: people.map((id) => ({ id, name: id, color: "#e5dcff" })),
  expenses,
  settlements,
  destination: "",
  startDate: "",
  endDate: "",
  description: "",
  icon: "👥",
  createdAt: "2026-10-08",
  updatedAt: "2026-10-08",
});
const expense = (patch: Partial<Expense> = {}): Expense => ({
  id: "e",
  title: "Dinner",
  amount: 10000,
  baseAmount: 10000,
  currency: "MYR",
  date: "2026-10-08",
  category: "Food",
  notes: "",
  allocations: { a: 3334, b: 3333, c: 3333 },
  payments: [{ personId: "a", amount: 10000 }],
  items: [],
  charges: [],
  createdAt: "2026-10-08",
  updatedAt: "2026-10-08",
  ...patch,
});
const charge = (patch: Partial<Charge>): Charge => ({
  id: "charge",
  name: "Charge",
  value: "10",
  kind: "fixed",
  discount: false,
  allocation: "proportional",
  participants: [],
  ...patch,
});
const item: ExpenseItem = {
  id: "i",
  name: "Pizza",
  price: "40",
  quantity: 2,
  notes: "",
  assignments: [
    { personId: "a", weight: "1" },
    { personId: "b", weight: "3" },
  ],
};
describe("exact allocation", () => {
  it("splits RM100 among three people without losing a cent", () =>
    expect(
      distribute(
        10000,
        people.map((p) => [p, "1"]),
      ),
    ).toEqual({ a: 3334, b: 3333, c: 3333 }));
  it("splits one cent deterministically", () =>
    expect(
      distribute(
        1,
        people.map((p) => [p, "1"]),
      ),
    ).toEqual({ a: 1, b: 0, c: 0 }));
  it("allocates unequal weights", () =>
    expect(
      distribute(11, [
        ["a", "1"],
        ["b", "2"],
      ]),
    ).toEqual({ a: 4, b: 7 }));
  it("validates percentages", () => {
    expect(
      allocate(
        10000,
        ["a", "b"],
        { method: "percent", values: { a: "25", b: "75" } },
        "MYR",
      ),
    ).toEqual({ a: 2500, b: 7500 });
    expect(() =>
      allocate(
        10000,
        people,
        { method: "percent", values: { a: "50" } },
        "MYR",
      ),
    ).toThrow("100%");
  });
  it("validates exact amounts", () => {
    expect(
      allocate(
        100,
        ["a", "b"],
        { method: "exact", values: { a: "0.4", b: "0.6" } },
        "MYR",
      ),
    ).toEqual({ a: 40, b: 60 });
    expect(() =>
      allocate(100, ["a"], { method: "exact", values: { a: "2" } }, "MYR"),
    ).toThrow();
  });
  it("supports weighted sharing and quantity for a subset", () =>
    expect(bill([item], [], people, "MYR").shares).toEqual({
      a: 2000,
      b: 6000,
      c: 0,
    }));
  it("rejects unassigned items", () =>
    expect(() =>
      bill([{ ...item, assignments: [] }], [], people, "MYR"),
    ).toThrow());
  it("validates invalid money and weights", () => {
    for (const s of ["-1", "NaN", "1e3", "1.001", ""])
      expect(() => money(s, "MYR")).toThrow();
    expect(() => distribute(100, [["a", "0"]])).toThrow();
    expect(() =>
      distribute(100, [
        ["a", "1"],
        ["a", "1"],
      ]),
    ).toThrow();
  });
  it("supports zero and three decimal currencies", () => {
    expect(money("100", "JPY")).toBe(100);
    expect(() => money("1.1", "JPY")).toThrow();
    expect(money("1.234", "KWD")).toBe(1234);
  });
  it("preserves sums over many remainder patterns", () => {
    for (let n = 0; n < 600; n++)
      for (let count = 1; count < 8; count++) {
        const entries: Array<[string, string]> = Array.from(
          { length: count },
          (_, i) => [String(i), String(i + 1)],
        );
        expect(
          Object.values(distribute(n, entries)).reduce((a, b) => a + b, 0),
        ).toBe(n);
      }
  });
});
describe("bill calculation order", () => {
  it("applies fixed discounts proportionally", () =>
    expect(
      bill([item], [charge({ discount: true, value: "20" })], people, "MYR")
        .shares,
    ).toEqual({ a: 1500, b: 4500, c: 0 }));
  it("applies percentage discount before ordered service and tax", () => {
    const r = bill(
      [item],
      [
        charge({ discount: true, kind: "percent", value: "25" }),
        charge({ kind: "percent", value: "10" }),
        charge({ kind: "percent", value: "6" }),
      ],
      people,
      "MYR",
    );
    expect(r.total).toBe(6996);
    expect(r.lines.map((l) => l.amount)).toEqual([8000, -2000, 600, 396]);
  });
  it("supports equal charges and selected fixed fees", () => {
    expect(
      bill([item], [charge({ value: "3", allocation: "equal" })], people, "MYR")
        .shares,
    ).toEqual({ a: 2100, b: 6100, c: 100 });
    expect(
      bill(
        [item],
        [charge({ value: "3", allocation: "selected", participants: ["c"] })],
        people,
        "MYR",
      ).shares.c,
    ).toBe(300);
  });
  it("rejects excessive discounts", () =>
    expect(() =>
      bill([item], [charge({ discount: true, value: "81" })], people, "MYR"),
    ).toThrow("Discount"));
  it("rounds percentage charges half up", () =>
    expect(
      bill([], [charge({ kind: "percent", value: "50" })], ["a"], "MYR", {
        a: 1,
      }).total,
    ).toBe(2));
});
describe("balances and settlements", () => {
  it("handles a non-consuming payer and two unequal payers", () => {
    const e = expense({
      allocations: { b: 5000, c: 5000 },
      payments: [
        { personId: "a", amount: 7000 },
        { personId: "b", amount: 3000 },
      ],
    });
    expect(balances(session([e]))).toEqual({ a: 7000, b: -2000, c: -5000 });
  });
  it("adjusts for partial settlements and undo", () => {
    const t = { id: "t", from: "b", to: "a", amount: 1000, createdAt: "now" };
    expect(balances(session([expense()], [t]))).toEqual({
      a: 5666,
      b: -2333,
      c: -3333,
    });
    expect(balances(session([expense()]))).toEqual({
      a: 6666,
      b: -3333,
      c: -3333,
    });
  });
  it("retains settlements when expense is edited or deleted", () => {
    const t = { id: "t", from: "b", to: "a", amount: 1000, createdAt: "now" };
    expect(
      balances(
        session([expense({ allocations: { a: 4000, b: 3000, c: 3000 } })], [t]),
      ),
    ).toEqual({ a: 5000, b: -2000, c: -3000 });
    expect(balances(session([], [t]))).toEqual({ a: -1000, b: 1000, c: 0 });
  });
  it("rejects unfunded bills", () =>
    expect(() => balances(session([expense({ payments: [] })]))).toThrow(
      "Payments",
    ));
  it("resolves multiple creditors exactly without self or zero payments", () => {
    const net = { a: 30, b: 70, c: -45, d: -55, e: 0 };
    for (const t of transfers(net)) {
      expect(t.amount).toBeGreaterThan(0);
      expect(t.from).not.toBe(t.to);
      net[t.from as keyof typeof net] += t.amount;
      net[t.to as keyof typeof net] -= t.amount;
    }
    expect(Object.values(net)).toEqual([0, 0, 0, 0, 0]);
  });
});
describe("travel and backups", () => {
  it("converts using original and destination currency minor units", () => {
    expect(convert(1000, "JPY", "MYR", "0.03")).toBe(3000);
    expect(convert(1234, "KWD", "USD", "3.25")).toBe(401);
  });
  it("rejects invalid or missing exchange rates", () => {
    for (const r of ["", "0", "-1", "oops"])
      expect(() => convert(100, "USD", "MYR", r)).toThrow();
  });
  it("preserves snapshots and data through export/import", () => {
    const data = { ...empty, sessions: [session([expense()])] };
    expect(parseBackup(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
  it("rejects corrupted and unbalanced backups", () => {
    expect(() => parseBackup({ version: 2 })).toThrow();
    expect(() =>
      parseBackup({
        ...empty,
        sessions: [session([expense({ allocations: { a: 1 } })])],
      }),
    ).toThrow();
    expect(() =>
      parseBackup({
        ...empty,
        sessions: [
          session([
            expense({ payments: [{ personId: "unknown", amount: 10000 }] }),
          ]),
        ],
      }),
    ).toThrow();
  });
});

it("formats the largest safe amount without losing its last cent", () =>
  expect(format(Number.MAX_SAFE_INTEGER, "MYR").replace(/\s/g, " ")).toBe(
    "MYR 90,071,992,547,409.91",
  ));
