import { useMemo, useState } from "react";
import { Plus, Trash2, ArrowLeft, Check, ReceiptText } from "lucide-react";
import {
  id,
  type Draft,
  type Session,
  type Expense,
  type Currency,
} from "../domain/model";
import {
  allocate,
  bill,
  convert,
  distribute,
  format,
  inputMoney,
  money,
} from "../calculations/engine";
import { Avatar, CurrencySelect, Field } from "../components/ui";
export function newDraft(s: Session, e?: Expense): Draft {
  return {
    sessionId: s.id,
    title: e?.title || "",
    amount: e?.inputAmount ?? (e ? inputMoney(e.amount, e.currency) : ""),
    currency: e?.currency || s.currency,
    rate: e?.exchange?.rate || "",
    date: e?.date || new Date().toISOString().slice(0, 10),
    category: e?.category || "Food",
    notes: e?.notes || "",
    selected:
      e?.participantIds ??
      (e ? Object.keys(e.allocations) : s.people.map((p) => p.id)),
    split: e?.split ?? {
      method: e ? "exact" : "equal",
      values: e
        ? Object.fromEntries(
            Object.entries(e.allocations).map(([p, v]) => [
              p,
              inputMoney(v, s.currency),
            ]),
          )
        : {},
    },
    payer: e?.payments[0]?.personId || s.people[0].id,
    multiple: !!e && e.payments.length > 1,
    contributions: e
      ? Object.fromEntries(
          e.payments.map((p) => [p.personId, inputMoney(p.amount, s.currency)]),
        )
      : {},
    items: e?.items || [],
    charges: e?.charges || [],
    receipt: "",
    editing: e?.id,
  };
}
export function calculateDraft(s: Session, d: Draft) {
  const original = d.currency;
  const own = s.mode === "own";
  const initial = own
    ? undefined
    : allocate(money(d.amount, original), d.selected, d.split, original);
  const result = bill(
    own ? d.items : [],
    d.charges,
    d.selected,
    original,
    initial,
  );
  const total = convert(result.total, original, s.currency, d.rate);
  const allocations =
    original === s.currency
      ? result.shares
      : distribute(
          total,
          Object.entries(result.shares).map(([p, v]) => [p, String(v)]),
        );
  const payments = d.multiple
    ? s.people
        .map((p) => ({
          personId: p.id,
          amount: money(d.contributions[p.id] || "0", s.currency),
        }))
        .filter((p) => p.amount)
    : [{ personId: d.payer, amount: total }];
  return {
    ...result,
    baseTotal: total,
    allocations,
    payments,
    paid: payments.reduce((a, p) => a + p.amount, 0),
  };
}
export default function ExpenseEditor({
  session: s,
  draft: d,
  onChange,
  onSave,
  onBack,
}: {
  session: Session;
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: (e: Expense) => void;
  onBack: () => void;
}) {
  const [error, setError] = useState("");
  const update = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  const calc = useMemo(() => {
    try {
      return { value: calculateDraft(s, d), error: "" };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [s, d]);
  const result = calc.value;
  const receipt = d.receipt
    ? (() => {
        try {
          return money(d.receipt, d.currency);
        } catch {
          return null;
        }
      })()
    : null;
  const mismatch = receipt !== null && result ? receipt - result.total : 0;
  function submit() {
    try {
      const r = calculateDraft(s, d);
      if (!d.title.trim()) throw Error("Give this expense a title.");
      if (!d.date) throw Error("Choose the expense date.");
      if (r.total <= 0)
        throw Error("The expense total must be greater than zero.");
      if (r.paid !== r.baseTotal)
        throw Error("Payment contributions must equal the total.");
      if (mismatch)
        throw Error(
          "Resolve the receipt mismatch or remove the receipt total.",
        );
      if (
        d.editing &&
        s.settlements.length &&
        !confirm(
          "This group has recorded settlements. Editing changes balances but preserves the transfer history. Continue?",
        )
      )
        return;
      const now = new Date().toISOString();
      onSave({
        inputAmount: d.amount,
        split: d.split,
        participantIds: d.selected,
        id: d.editing || id(),
        title: d.title.trim(),
        amount: r.total,
        currency: d.currency,
        baseAmount: r.baseTotal,
        exchange:
          d.currency !== s.currency
            ? {
                rate: d.rate,
                originalCurrency: d.currency,
                baseCurrency: s.currency,
                capturedAt: (() => {
                  const previous = s.expenses.find(
                    (e) => e.id === d.editing,
                  )?.exchange;
                  return previous?.rate === d.rate &&
                    previous.originalCurrency === d.currency
                    ? previous.capturedAt
                    : now;
                })(),
              }
            : undefined,
        date: d.date,
        category: d.category,
        notes: d.notes,
        allocations: r.allocations,
        payments: r.payments,
        items: d.items,
        charges: d.charges,
        createdAt: s.expenses.find((e) => e.id === d.editing)?.createdAt || now,
        updatedAt: now,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section>
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={18} /> Back to {s.name}
      </button>
      <div className="page-title">
        <div>
          <p className="eyebrow">
            {s.mode === "own"
              ? "EVERY BITE, FAIRLY SPLIT"
              : "A LITTLE LESS MATH. A LOT MORE FUN."}
          </p>
          <h1>
            {d.editing
              ? "Edit expense"
              : s.mode === "own"
                ? "Who ordered what?"
                : "Let’s split this."}
          </h1>
          <p>Every share adds up. Every time.</p>
        </div>
        <ReceiptText className="title-icon" size={45} />
      </div>
      <div className="editor-grid">
        <div className="card">
          <h2>1. The expense</h2>
          <div className="form-grid">
            <Field label="Expense title">
              <input
                placeholder="Friday dinner"
                value={d.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            </Field>
            {s.mode !== "own" && (
              <Field label="Bill amount">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={d.amount}
                  onChange={(e) => update({ amount: e.target.value })}
                />
              </Field>
            )}
            <Field label="Expense currency">
              <CurrencySelect
                value={d.currency}
                onChange={(c: Currency) => update({ currency: c })}
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={d.date}
                onChange={(e) => update({ date: e.target.value })}
              />
            </Field>
            <Field label="Category">
              <select
                value={d.category}
                onChange={(e) => update({ category: e.target.value })}
              >
                {[
                  "Food",
                  "Accommodation",
                  "Transport",
                  "Activities",
                  "Shopping",
                  "Tickets",
                  "Groceries",
                  "Other",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          {d.currency !== s.currency && (
            <Field
              label={`Manual rate: 1 ${d.currency} = how many ${s.currency}?`}
            >
              <input
                inputMode="decimal"
                value={d.rate}
                onChange={(e) => update({ rate: e.target.value })}
              />
            </Field>
          )}
          <p className="hint">
            Enter the receipt amount as printed. Add only charges that are not
            already included. Rates are manual, never live.
          </p>
          <Field label="Notes (optional)">
            <textarea
              value={d.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </Field>
          <h2>2. Who’s sharing?</h2>
          <div className="chips">
            {s.people.map((p) => (
              <button
                key={p.id}
                className={`person-chip ${d.selected.includes(p.id) ? "selected" : ""}`}
                aria-pressed={d.selected.includes(p.id)}
                onClick={() =>
                  update({
                    selected: d.selected.includes(p.id)
                      ? d.selected.filter((x) => x !== p.id)
                      : [...d.selected, p.id],
                  })
                }
              >
                <Avatar person={p} />
                {p.name}
                {d.selected.includes(p.id) && <Check size={14} />}
              </button>
            ))}
          </div>
          {s.mode !== "own" && (
            <>
              <Field label="Split method">
                <select
                  value={d.split.method}
                  onChange={(e) =>
                    update({
                      split: {
                        method: e.target.value as Draft["split"]["method"],
                        values: {},
                      },
                    })
                  }
                >
                  <option value="equal">Equal shares</option>
                  <option value="exact">Exact amounts</option>
                  <option value="percent">Percentages</option>
                  <option value="weight">Weighted shares</option>
                </select>
              </Field>
              {d.split.method !== "equal" &&
                d.selected.map((p) => (
                  <Field
                    key={p}
                    label={`${s.people.find((x) => x.id === p)?.name} — ${d.split.method === "percent" ? "%" : d.split.method === "weight" ? "weight" : d.currency}`}
                  >
                    <input
                      inputMode="decimal"
                      value={d.split.values[p] || ""}
                      onChange={(e) =>
                        update({
                          split: {
                            ...d.split,
                            values: { ...d.split.values, [p]: e.target.value },
                          },
                        })
                      }
                    />
                  </Field>
                ))}
            </>
          )}
          {s.mode === "own" && (
            <>
              <h2>3. What’s on the receipt?</h2>
              {d.items.map((item, i) => (
                <div className="item-card" key={item.id}>
                  <div className="row">
                    <strong>Item {i + 1}</strong>
                    <button
                      className="icon-button"
                      aria-label={`Remove item ${i + 1}`}
                      onClick={() =>
                        update({
                          items: d.items.filter((x) => x.id !== item.id),
                        })
                      }
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <Field label="Item name">
                      <input
                        value={item.name}
                        onChange={(e) =>
                          update({
                            items: d.items.map((x) =>
                              x.id === item.id
                                ? { ...x, name: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Unit price">
                      <input
                        inputMode="decimal"
                        value={item.price}
                        onChange={(e) =>
                          update({
                            items: d.items.map((x) =>
                              x.id === item.id
                                ? { ...x, price: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Quantity">
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) =>
                          update({
                            items: d.items.map((x) =>
                              x.id === item.id
                                ? { ...x, quantity: Number(e.target.value) }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Item notes">
                      <input
                        value={item.notes}
                        onChange={(e) =>
                          update({
                            items: d.items.map((x) =>
                              x.id === item.id
                                ? { ...x, notes: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <p className="hint">
                    Tap people to assign. Use weights for custom portions.
                  </p>
                  <div className="chips">
                    {s.people
                      .filter((p) => d.selected.includes(p.id))
                      .map((p) => (
                        <button
                          key={p.id}
                          aria-pressed={item.assignments.some(
                            (a) => a.personId === p.id,
                          )}
                          className={`person-chip ${item.assignments.some((a) => a.personId === p.id) ? "selected" : ""}`}
                          onClick={() =>
                            update({
                              items: d.items.map((x) =>
                                x.id === item.id
                                  ? {
                                      ...x,
                                      assignments: x.assignments.some(
                                        (a) => a.personId === p.id,
                                      )
                                        ? x.assignments.filter(
                                            (a) => a.personId !== p.id,
                                          )
                                        : [
                                            ...x.assignments,
                                            { personId: p.id, weight: "1" },
                                          ],
                                    }
                                  : x,
                              ),
                            })
                          }
                        >
                          <Avatar person={p} />
                          {p.name}
                        </button>
                      ))}
                  </div>
                  {item.assignments.map((a) => (
                    <Field
                      key={a.personId}
                      label={`${s.people.find((p) => p.id === a.personId)?.name} portion weight`}
                    >
                      <input
                        inputMode="decimal"
                        value={a.weight}
                        onChange={(e) =>
                          update({
                            items: d.items.map((x) =>
                              x.id === item.id
                                ? {
                                    ...x,
                                    assignments: x.assignments.map((v) =>
                                      v.personId === a.personId
                                        ? { ...v, weight: e.target.value }
                                        : v,
                                    ),
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              ))}
              <button
                className="secondary"
                onClick={() =>
                  update({
                    items: [
                      ...d.items,
                      {
                        id: id(),
                        name: "",
                        price: "",
                        quantity: 1,
                        notes: "",
                        assignments: [],
                      },
                    ],
                  })
                }
              >
                <Plus size={18} /> Add item
              </button>
            </>
          )}
          <h2>Charges & discounts</h2>
          <p className="hint">
            Applied top to bottom to the running subtotal. Percentage amounts
            round half up. Discounts use consumption proportions to avoid
            negative shares.
          </p>
          {d.charges.map((charge, i) => (
            <div className="item-card" key={charge.id}>
              <div className="row">
                <strong>Step {i + 1}</strong>
                <button
                  className="icon-button"
                  aria-label={`Remove charge ${i + 1}`}
                  onClick={() =>
                    update({
                      charges: d.charges.filter((c) => c.id !== charge.id),
                    })
                  }
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="form-grid">
                <Field label="Charge name">
                  <input
                    value={charge.name}
                    onChange={(e) =>
                      update({
                        charges: d.charges.map((c) =>
                          c.id === charge.id
                            ? { ...c, name: e.target.value }
                            : c,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Type">
                  <select
                    value={`${charge.discount ? "discount" : "charge"}-${charge.kind}`}
                    onChange={(e) => {
                      const [type, kind] = e.target.value.split("-");
                      update({
                        charges: d.charges.map((c) =>
                          c.id === charge.id
                            ? {
                                ...c,
                                discount: type === "discount",
                                kind: kind as "fixed" | "percent",
                              }
                            : c,
                        ),
                      });
                    }}
                  >
                    <option value="charge-percent">Percentage charge</option>
                    <option value="charge-fixed">Fixed charge</option>
                    <option value="discount-percent">
                      Percentage discount
                    </option>
                    <option value="discount-fixed">Fixed discount</option>
                  </select>
                </Field>
                <Field
                  label={charge.kind === "percent" ? "Percentage" : "Amount"}
                >
                  <input
                    inputMode="decimal"
                    value={charge.value}
                    onChange={(e) =>
                      update({
                        charges: d.charges.map((c) =>
                          c.id === charge.id
                            ? { ...c, value: e.target.value }
                            : c,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Allocate charge">
                  <select
                    value={charge.allocation}
                    onChange={(e) =>
                      update({
                        charges: d.charges.map((c) =>
                          c.id === charge.id
                            ? {
                                ...c,
                                allocation: e.target
                                  .value as typeof c.allocation,
                              }
                            : c,
                        ),
                      })
                    }
                  >
                    <option value="proportional">By consumption</option>
                    <option value="equal">Equally</option>
                    <option value="selected">Selected people</option>
                  </select>
                </Field>
              </div>
              {charge.allocation === "selected" && (
                <div className="chips">
                  {s.people
                    .filter((p) => d.selected.includes(p.id))
                    .map((p) => (
                      <button
                        className={`person-chip ${charge.participants.includes(p.id) ? "selected" : ""}`}
                        key={p.id}
                        aria-pressed={charge.participants.includes(p.id)}
                        onClick={() =>
                          update({
                            charges: d.charges.map((c) =>
                              c.id === charge.id
                                ? {
                                    ...c,
                                    participants: c.participants.includes(p.id)
                                      ? c.participants.filter((x) => x !== p.id)
                                      : [...c.participants, p.id],
                                  }
                                : c,
                            ),
                          })
                        }
                      >
                        {p.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          ))}
          <button
            className="secondary"
            onClick={() =>
              update({
                charges: [
                  ...d.charges,
                  {
                    id: id(),
                    name: "Service charge",
                    kind: "percent",
                    value: "",
                    discount: false,
                    allocation: "proportional",
                    participants: [],
                  },
                ],
              })
            }
          >
            <Plus size={18} /> Add charge or discount
          </button>
          <h2>Who paid?</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={d.multiple}
              onChange={(e) => update({ multiple: e.target.checked })}
            />{" "}
            Multiple payers / partial contributions
          </label>
          {d.multiple ? (
            s.people.map((p) => (
              <Field label={`${p.name} paid (${s.currency})`} key={p.id}>
                <input
                  inputMode="decimal"
                  value={d.contributions[p.id] || ""}
                  onChange={(e) =>
                    update({
                      contributions: {
                        ...d.contributions,
                        [p.id]: e.target.value,
                      },
                    })
                  }
                />
              </Field>
            ))
          ) : (
            <Field label="Payer">
              <select
                value={d.payer}
                onChange={(e) => update({ payer: e.target.value })}
              >
                {s.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="hint">
            Payers may be different from participants. An incomplete payment can
            be kept as a draft; saving requires full funding.
          </p>
          <Field label={`Actual receipt total (${d.currency}, optional)`}>
            <input
              inputMode="decimal"
              value={d.receipt}
              onChange={(e) => update({ receipt: e.target.value })}
            />
          </Field>
          {d.receipt && receipt === null && (
            <p className="error">Enter a valid receipt total.</p>
          )}
          {mismatch !== 0 && (
            <div className="notice">
              Receipt difference: {format(mismatch, d.currency)}.{" "}
              <button
                className="text-button"
                onClick={() =>
                  update({
                    charges: [
                      ...d.charges,
                      {
                        id: id(),
                        name: "Receipt adjustment",
                        kind: "fixed",
                        value: inputMoney(Math.abs(mismatch), d.currency),
                        discount: mismatch < 0,
                        allocation: "proportional",
                        participants: [],
                      },
                    ],
                  })
                }
              >
                Add explicit adjustment
              </button>
            </div>
          )}
        </div>
        <aside className="card result-card">
          <p className="eyebrow">THE FAIR SHARE</p>
          <h2>Your split, in real time.</h2>
          {result ? (
            <>
              <div className="big-amount">
                {format(result.total, d.currency)}
              </div>
              {d.currency !== s.currency && (
                <p>
                  {format(result.baseTotal, s.currency)} at manual rate {d.rate}
                </p>
              )}
              <div className="divider" />
              {s.people
                .filter((p) => d.selected.includes(p.id))
                .map((p) => (
                  <div className="share-row" key={p.id}>
                    <span>
                      <Avatar person={p} />
                      {p.name}
                    </span>
                    <strong>
                      {format(result.allocations[p.id] || 0, s.currency)}
                    </strong>
                  </div>
                ))}
              <details>
                <summary>Show calculation breakdown</summary>
                {result.lines.map((l, i) => (
                  <div key={i} className="breakdown">
                    <strong>
                      {l.name}: {format(l.amount, d.currency)}
                    </strong>
                    {Object.entries(l.shares).map(([p, v]) => (
                      <p key={p}>
                        {s.people.find((x) => x.id === p)?.name}:{" "}
                        {format(v, d.currency)}
                      </p>
                    ))}
                  </div>
                ))}
              </details>
              <p
                className={result.paid !== result.baseTotal ? "error" : "hint"}
              >
                Recorded payments: {format(result.paid, s.currency)} /{" "}
                {format(result.baseTotal, s.currency)}
              </p>
            </>
          ) : (
            <div className="empty-state">
              <ReceiptText size={38} />
              <p>{calc.error}</p>
              <small>Your exact shares will appear here.</small>
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            className="primary full"
            onClick={submit}
            disabled={!result || (!!d.receipt && receipt === null)}
          >
            <Check size={18} />{" "}
            {d.editing ? "Save changes" : "Save & see settlements"}
          </button>
          <p className="hint center">
            Saved automatically as a draft on this device.
          </p>
        </aside>
      </div>
    </section>
  );
}
