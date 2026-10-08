import { openDB } from "idb";
import {
  convert,
  balances,
  bill,
  allocate,
  distribute,
  money as importMoney,
} from "../calculations/engine";
import { z } from "zod";
import { currencies, type Data } from "../domain/model";
const currency = z.enum(
  Object.keys(currencies) as [
    keyof typeof currencies,
    ...(keyof typeof currencies)[],
  ],
);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const person = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string(),
});
const item = z.object({
  id: z.string(),
  name: z.string(),
  price: z.string(),
  quantity: z.number().int().positive(),
  notes: z.string(),
  assignments: z.array(z.object({ personId: z.string(), weight: z.string() })),
});
const charge = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["fixed", "percent"]),
  value: z.string(),
  discount: z.boolean(),
  allocation: z.enum(["equal", "proportional", "selected"]),
  participants: z.array(z.string()),
});
const expense = z.object({
  inputAmount: z.string().optional(),
  split: z
    .object({
      method: z.enum(["equal", "exact", "percent", "weight"]),
      values: z.record(z.string(), z.string()),
    })
    .optional(),
  participantIds: z.array(z.string()).optional(),
  id: z.string(),
  title: z.string(),
  amount,
  currency,
  baseAmount: amount,
  exchange: z
    .object({
      rate: z.string(),
      originalCurrency: currency,
      baseCurrency: currency,
      capturedAt: z.string(),
    })
    .optional(),
  date: z.string(),
  category: z.string(),
  notes: z.string(),
  allocations: z.record(z.string(), amount),
  payments: z.array(z.object({ personId: z.string(), amount })),
  items: z.array(item),
  charges: z.array(charge),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const session = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(["own", "equal", "group", "travel"]),
  currency,
  people: z.array(person).min(1),
  expenses: z.array(expense),
  settlements: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      amount: amount.positive(),
      createdAt: z.string(),
    }),
  ),
  destination: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  description: z.string(),
  icon: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const draft = z.object({
  sessionId: z.string(),
  title: z.string(),
  amount: z.string(),
  currency,
  rate: z.string(),
  date: z.string(),
  category: z.string(),
  notes: z.string(),
  selected: z.array(z.string()),
  split: z.object({
    method: z.enum(["equal", "exact", "percent", "weight"]),
    values: z.record(z.string(), z.string()),
  }),
  payer: z.string(),
  multiple: z.boolean(),
  contributions: z.record(z.string(), z.string()),
  items: z.array(item),
  charges: z.array(charge),
  receipt: z.string(),
  editing: z.string().optional(),
});
const schema = z.object({
  version: z.literal(1),
  sessions: z.array(session),
  draft: draft.nullable(),
  theme: z.enum(["light", "dark", "system"]),
  currency,
});
export const empty: Data = {
  version: 1,
  sessions: [],
  draft: null,
  theme: "system",
  currency: "MYR",
};
export function parseBackup(raw: unknown): Data {
  const d = schema.parse(raw);
  if (new Set(d.sessions.map((s) => s.id)).size !== d.sessions.length)
    throw Error("Duplicate sessions.");
  for (const s of d.sessions) {
    const ids = s.people.map((p) => p.id);
    if (new Set(ids).size !== ids.length) throw Error("Duplicate people.");
    if (new Set(s.expenses.map((e) => e.id)).size !== s.expenses.length)
      throw Error("Duplicate expenses.");
    for (const e of s.expenses) {
      if (e.currency !== s.currency) {
        if (
          !e.exchange ||
          e.exchange.originalCurrency !== e.currency ||
          e.exchange.baseCurrency !== s.currency ||
          convert(e.amount, e.currency, s.currency, e.exchange.rate) !==
            e.baseAmount
        )
          throw Error("Invalid exchange-rate snapshot.");
      } else if (e.amount !== e.baseAmount)
        throw Error("Incorrect base amount.");
      if (e.inputAmount !== undefined && e.split && e.participantIds) {
        if (e.participantIds.some((p) => !ids.includes(p)))
          throw Error("Unknown participant.");
        const initial =
          s.mode === "own"
            ? undefined
            : allocate(
                importMoney(e.inputAmount, e.currency),
                e.participantIds,
                e.split,
                e.currency,
              );
        const result = bill(
          e.items,
          e.charges,
          e.participantIds,
          e.currency,
          initial,
        );
        const allocations =
          e.currency === s.currency
            ? result.shares
            : distribute(
                e.baseAmount,
                Object.entries(result.shares).map(([p, v]) => [p, String(v)]),
              );
        if (
          result.total !== e.amount ||
          Object.keys(allocations).length !==
            Object.keys(e.allocations).length ||
          Object.entries(allocations).some(([p, v]) => e.allocations[p] !== v)
        )
          throw Error("Expense inputs do not reconcile.");
      }
      if (
        Object.values(e.allocations).reduce((a, b) => a + b, 0) !==
          e.baseAmount ||
        e.payments.reduce((a, p) => a + p.amount, 0) !== e.baseAmount
      )
        throw Error("Unbalanced expense.");
      if (
        [
          ...Object.keys(e.allocations),
          ...e.payments.map((p) => p.personId),
        ].some((p) => !ids.includes(p))
      )
        throw Error("Unknown participant.");
    }
    if (new Set(s.settlements.map((t) => t.id)).size !== s.settlements.length)
      throw Error("Duplicate settlements.");
    for (const t of s.settlements)
      if (!ids.includes(t.from) || !ids.includes(t.to) || t.from === t.to)
        throw Error("Invalid settlement.");
    balances(s);
  }
  if (d.draft && !d.sessions.some((s) => s.id === d.draft?.sessionId))
    throw Error("Unknown draft session.");
  return d;
}
let connection: ReturnType<typeof openDB> | undefined;
const db = () =>
  (connection ??= openDB("splitpop", 1, {
    upgrade(d) {
      d.createObjectStore("state");
    },
  }));
export async function rawBackup() {
  return (await db()).get("state", "app");
}
export async function load() {
  const raw = await (await db()).get("state", "app");
  return raw ? parseBackup(raw) : empty;
}
export async function save(data: Data) {
  await (await db()).put("state", data, "app");
}
export async function clear() {
  await (await db()).clear("state");
}
