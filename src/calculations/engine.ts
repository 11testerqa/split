import Decimal from "decimal.js";
Decimal.set({ precision: 60 });
import {
  currencies,
  type Currency,
  type ExpenseItem,
  type Charge,
  type SplitRule,
  type Session,
} from "../domain/model";
const integer = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0)
    throw Error("Enter a valid non-negative amount.");
  return n;
};
export function decimal(s: string) {
  if (s.length > 40 || !/^\d+(\.\d+)?$/.test(s))
    throw Error("Enter a valid number.");
  return new Decimal(s);
}
export function money(s: string, c: Currency): number {
  const n = decimal(s).mul(10 ** currencies[c]);
  if (!n.isInteger())
    throw Error(`${c} supports ${currencies[c]} decimal places.`);
  return integer(n.toNumber());
}
export function format(n: number, c: Currency) {
  if (!Number.isSafeInteger(n))
    throw Error("Amount exceeds the supported limit.");
  const units = BigInt(10 ** currencies[c]);
  const minor = BigInt(Math.abs(n));
  const fraction = (minor % units).toString().padStart(currencies[c], "0");
  return (
    (n < 0 ? "-" : "") +
    new Intl.NumberFormat("en", { style: "currency", currency: c })
      .formatToParts(minor / units)
      .map((part) => (part.type === "fraction" ? fraction : part.value))
      .join("")
  );
}
const safeAdd = (a: number, b: number) => {
  const sum = a + b;
  if (!Number.isSafeInteger(sum))
    throw Error("Total exceeds the supported amount limit.");
  return sum;
};
export const inputMoney = (n: number, c: Currency) =>
  new Decimal(n).div(10 ** currencies[c]).toFixed(currencies[c]);
export function distribute(
  total: number,
  entries: [string, string][],
): Record<string, number> {
  integer(total);
  if (!entries.length) throw Error("Select at least one participant.");
  if (new Set(entries.map((e) => e[0])).size !== entries.length)
    throw Error("Duplicate participants.");
  const weights = entries.map(([key, w], i) => ({ key, w: decimal(w), i }));
  const sum = weights.reduce((a, e) => a.add(e.w), new Decimal(0));
  if (sum.lte(0)) throw Error("Shares must total more than zero.");
  const rows = weights.map((e) => {
    const exact = new Decimal(total).mul(e.w).div(sum);
    return {
      ...e,
      n: exact.floor().toNumber(),
      remainder: exact.minus(exact.floor()),
    };
  });
  let remaining = total - rows.reduce((a, e) => a + e.n, 0);
  for (const row of [...rows].sort(
    (a, b) => b.remainder.comparedTo(a.remainder) || a.i - b.i,
  )) {
    if (remaining-- > 0) row.n++;
  }
  return Object.fromEntries(rows.map((r) => [r.key, r.n]));
}
export function allocate(
  total: number,
  people: string[],
  rule: SplitRule,
  c: Currency,
) {
  integer(total);
  if (!people.length || new Set(people).size !== people.length)
    throw Error("Select valid participants.");
  if (rule.method === "equal")
    return distribute(
      total,
      people.map((p) => [p, "1"]),
    );
  if (rule.method === "exact") {
    const a = Object.fromEntries(
      people.map((p) => [p, money(rule.values[p] || "0", c)]),
    );
    if (Object.values(a).reduce((a, b) => a + b, 0) !== total)
      throw Error("Exact shares must equal the total.");
    return a;
  }
  const entries: [string, string][] = people.map((p) => [
    p,
    rule.values[p] || "0",
  ]);
  if (
    rule.method === "percent" &&
    !entries.reduce((a, e) => a.add(decimal(e[1])), new Decimal(0)).eq(100)
  )
    throw Error("Percentages must add up to 100%.");
  return distribute(total, entries);
}
export function bill(
  items: ExpenseItem[],
  charges: Charge[],
  people: string[],
  c: Currency,
  base?: Record<string, number>,
) {
  let shares: Record<string, number> = Object.fromEntries(
    people.map((p) => [p, base?.[p] || 0]),
  );
  const lines: {
    name: string;
    amount: number;
    shares: Record<string, number>;
  }[] = [];
  if (!base) {
    if (!items.length) throw Error("Add at least one item.");
    for (const item of items) {
      if (!item.name.trim()) throw Error("Give every item a name.");
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1)
        throw Error("Quantity must be a positive whole number.");
      if (item.assignments.some((a) => !people.includes(a.personId)))
        throw Error("An item has an unknown participant.");
      const amount = integer(money(item.price, c) * item.quantity);
      const s = distribute(
        amount,
        item.assignments.map((a) => [a.personId, a.weight]),
      );
      for (const p of people) shares[p] += s[p] || 0;
      lines.push({ name: item.name, amount, shares: s });
    }
  }
  for (const charge of charges) {
    const current = Object.values(shares).reduce((a, b) => a + b, 0);
    let amount =
      charge.kind === "fixed"
        ? money(charge.value, c)
        : integer(
            new Decimal(current)
              .mul(decimal(charge.value))
              .div(100)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toNumber(),
          );
    if (charge.discount && amount > current)
      throw Error("Discount cannot exceed the running subtotal.");
    let participants =
      charge.allocation === "selected" ? charge.participants : people;
    if (!participants.length || participants.some((p) => !people.includes(p)))
      throw Error("Select valid charge participants.");
    const weights: [string, string][] = participants.map((p) => [
      p,
      charge.allocation === "proportional" || charge.discount
        ? String(shares[p])
        : "1",
    ]);
    if (weights.every((e) => e[1] === "0"))
      weights.forEach((e) => (e[1] = "1"));
    const s = distribute(amount, weights);
    if (charge.discount) amount = -amount;
    for (const p of people) {
      shares[p] += (charge.discount ? -1 : 1) * (s[p] || 0);
      if (shares[p] < 0)
        throw Error("A discount exceeds a participant’s share.");
    }
    lines.push({
      name: charge.name,
      amount,
      shares: Object.fromEntries(
        Object.entries(s).map(([p, v]) => [p, charge.discount ? -v : v]),
      ),
    });
  }
  return {
    shares,
    total: integer(Object.values(shares).reduce((a, b) => a + b, 0)),
    lines,
  };
}
export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  rate: string,
) {
  if (from === to) return integer(amount);
  if (decimal(rate).lte(0))
    throw Error("Enter a positive manual exchange rate.");
  return integer(
    new Decimal(amount)
      .div(10 ** currencies[from])
      .mul(decimal(rate))
      .mul(10 ** currencies[to])
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber(),
  );
}
export function balances(s: Session) {
  s.expenses.reduce((total, e) => safeAdd(total, e.baseAmount), 0);
  const out: Record<string, number> = Object.fromEntries(
    s.people.map((p) => [p.id, 0]),
  );
  for (const e of s.expenses) {
    integer(e.baseAmount);
    if (
      Object.values(e.allocations).reduce((a, v) => a + integer(v), 0) !==
      e.baseAmount
    )
      throw Error("Allocations must equal the expense total.");
    if (e.payments.reduce((a, p) => a + p.amount, 0) !== e.baseAmount)
      throw Error(
        "Payments must equal the expense total before calculating settlements.",
      );
    for (const [p, v] of Object.entries(e.allocations)) {
      if (!(p in out)) throw Error("Unknown expense participant.");
      out[p] = safeAdd(out[p], -v);
    }
    for (const p of e.payments) {
      if (!(p.personId in out)) throw Error("Unknown payer.");
      out[p.personId] = safeAdd(out[p.personId], integer(p.amount));
    }
  }
  for (const t of s.settlements) {
    if (
      !(t.from in out) ||
      !(t.to in out) ||
      t.from === t.to ||
      integer(t.amount) === 0
    )
      throw Error("Invalid settlement.");
    out[t.from] = safeAdd(out[t.from], t.amount);
    out[t.to] = safeAdd(out[t.to], -t.amount);
  }
  if (
    Object.values(out).some((n) => !Number.isSafeInteger(n)) ||
    Object.values(out).reduce((a, b) => a + BigInt(b), 0n) !== 0n
  )
    throw Error("The balances do not reconcile.");
  return out;
}
export function transfers(net: Record<string, number>) {
  if (
    Object.values(net).some((n) => !Number.isSafeInteger(n)) ||
    Object.values(net).reduce((a, b) => a + BigInt(b), 0n) !== 0n
  )
    throw Error("Balances must sum to zero.");
  const debt = Object.entries(net)
    .filter((e) => e[1] < 0)
    .map(([p, n]) => ({ p, n: -n }));
  const credit = Object.entries(net)
    .filter((e) => e[1] > 0)
    .map(([p, n]) => ({ p, n }));
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0,
    j = 0;
  while (i < debt.length && j < credit.length) {
    const amount = Math.min(debt[i].n, credit[j].n);
    out.push({ from: debt[i].p, to: credit[j].p, amount });
    debt[i].n -= amount;
    credit[j].n -= amount;
    if (!debt[i].n) i++;
    if (!credit[j].n) j++;
  }
  return out;
}
