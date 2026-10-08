import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Check,
  ReceiptText,
  Copy,
  Share2,
  Download,
  Printer,
} from "lucide-react";
import { id, type Session, type Expense } from "../domain/model";
import { modes, colors } from "../domain/presentation";
import {
  balances,
  transfers,
  format,
  money,
  inputMoney,
} from "../calculations/engine";
import { Avatar, Field } from "../components/ui";
export default function SessionView({
  session: s,
  onBack,
  onAdd,
  onEdit,
  onDelete,
  onUpdate,
  onShare,
  onNotice,
  onResume,
}: {
  session: Session;
  onBack: () => void;
  onAdd: () => void;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
  onUpdate: (s: Session) => void;
  onShare: (a: string) => void;
  onNotice: (s: string) => void;
  onResume?: () => void;
}) {
  const [partial, setPartial] = useState<Record<string, string>>({});
  const [members, setMembers] = useState(false);
  const net = balances(s);
  const suggested = transfers(net);
  const total = s.expenses.reduce((a, e) => a + e.baseAmount, 0);
  const categories = Object.entries(
    s.expenses.reduce(
      (a, e) => ({ ...a, [e.category]: (a[e.category] || 0) + e.baseAmount }),
      {} as Record<string, number>,
    ),
  );
  const person = (id: string) => s.people.find((p) => p.id === id)!;
  function settle(
    t: { from: string; to: string; amount: number },
    key: string,
  ) {
    try {
      const amount = partial[key] ? money(partial[key], s.currency) : t.amount;
      if (!amount || amount > t.amount)
        throw Error(
          "Enter a positive amount no larger than the suggested transfer.",
        );
      onUpdate({
        ...s,
        settlements: [
          ...s.settlements,
          { ...t, amount, id: id(), createdAt: new Date().toISOString() },
        ],
      });
      setPartial({});
      onNotice(
        "Transfer recorded. Only record payments that actually happened.",
      );
    } catch (e) {
      onNotice((e as Error).message);
    }
  }
  return (
    <section>
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={18} /> Back to your space
      </button>
      <div className="page-title">
        <div>
          <p className="eyebrow">
            {modes.find((m) => m.id === s.mode)?.title.toUpperCase()} ·{" "}
            {s.currency}
          </p>
          <h1>
            {s.icon} {s.name}
          </h1>
          <p>
            {s.destination}
            {s.startDate && ` · ${s.startDate} — ${s.endDate || "ongoing"}`}
            {s.description && ` · ${s.description}`}
          </p>
        </div>
        <button className="primary" onClick={onAdd}>
          <Plus size={18} /> Add expense
        </button>
      </div>
      {onResume && (
        <div className="notice row">
          <span>You have an unfinished expense.</span>
          <button className="secondary" onClick={onResume}>
            Resume draft
          </button>
        </div>
      )}
      <div className="stats-grid">
        <div className="card stat">
          <p>Total shared</p>
          <strong>{format(total, s.currency)}</strong>
          <span>{s.expenses.length} expenses, one clear picture</span>
        </div>
        <div className="card stat mint">
          <p>Still to settle</p>
          <strong>
            {format(
              Object.values(net)
                .filter((n) => n < 0)
                .reduce((a, n) => a - n, 0),
              s.currency,
            )}
          </strong>
          <span>
            {suggested.length
              ? `${suggested.length} suggested transfers`
              : "Everyone is squared up"}
          </span>
        </div>
        <div className="card stat peach">
          <p>Your people</p>
          <div className="chips">
            {s.people.map((p) => (
              <span className="person-chip" key={p.id}>
                <Avatar person={p} />
                {p.name}
              </span>
            ))}
          </div>
          <button className="text-button" onClick={() => setMembers(!members)}>
            Manage people
          </button>
        </div>
      </div>
      {members && (
        <div className="card">
          <h2>People & session details</h2>
          <Field label="Session name">
            <input
              value={s.name}
              onChange={(e) => onUpdate({ ...s, name: e.target.value })}
            />
          </Field>
          {s.people.map((p, i) => {
            const used =
              s.expenses.some(
                (e) =>
                  p.id in e.allocations ||
                  e.payments.some((v) => v.personId === p.id),
              ) || s.settlements.some((t) => t.from === p.id || t.to === p.id);
            return (
              <div className="person-editor" key={p.id}>
                <Avatar person={p} />
                <input
                  aria-label={`Member ${i + 1} name`}
                  value={p.name}
                  onChange={(e) => {
                    if (e.target.value.trim())
                      onUpdate({
                        ...s,
                        people: s.people.map((x) =>
                          x.id === p.id ? { ...x, name: e.target.value } : x,
                        ),
                      });
                  }}
                />
                <select
                  aria-label={`Member ${i + 1} color`}
                  value={p.color}
                  onChange={(e) =>
                    onUpdate({
                      ...s,
                      people: s.people.map((x) =>
                        x.id === p.id ? { ...x, color: e.target.value } : x,
                      ),
                    })
                  }
                >
                  {colors.map((c, i) => (
                    <option key={c} value={c}>
                      {["Lavender", "Mint", "Peach", "Sky", "Sunshine"][i]}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  disabled={used || s.people.length < 2 || !!onResume}
                  title={
                    used
                      ? "This person is referenced by financial records."
                      : ""
                  }
                  aria-label={`Remove ${p.name}`}
                  onClick={() => {
                    if (confirm(`Remove ${p.name}?`))
                      onUpdate({
                        ...s,
                        people: s.people.filter((x) => x.id !== p.id),
                      });
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            );
          })}
          <button
            className="secondary"
            onClick={() => {
              const name = prompt("New participant name");
              if (name?.trim())
                onUpdate({
                  ...s,
                  people: [
                    ...s.people,
                    {
                      id: id(),
                      name: name.trim(),
                      color: colors[s.people.length % colors.length],
                    },
                  ],
                });
            }}
          >
            <Plus size={18} /> Add participant
          </button>
          <p className="hint">
            People with expenses, transfers, or unfinished drafts cannot be
            removed.
          </p>
        </div>
      )}
      <div className="dashboard-grid">
        <div>
          <div className="section-heading">
            <h2>Expense timeline</h2>
            <span className="hint">Every amount has a story</span>
          </div>
          {!s.expenses.length ? (
            <div className="card friendly-empty">
              <ReceiptText size={34} />
              <h3>Ready for your first expense.</h3>
              <p>Add a bill and we’ll take care of the fair shares.</p>
              <button className="secondary" onClick={onAdd}>
                Add expense <Plus size={16} />
              </button>
            </div>
          ) : (
            <div className="expenses">
              {[...s.expenses]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((e) => (
                  <div className="card expense" key={e.id}>
                    <div className="row">
                      <div>
                        <span className="eyebrow">
                          {e.date} · {e.category}
                        </span>
                        <h3>{e.title}</h3>
                      </div>
                      <strong>{format(e.baseAmount, s.currency)}</strong>
                    </div>
                    {e.exchange && (
                      <p className="hint">
                        {format(e.amount, e.currency)} · Manual rate{" "}
                        {e.exchange.rate} · Saved{" "}
                        {e.exchange.capturedAt.slice(0, 10)}
                      </p>
                    )}
                    <p className="hint">
                      Paid by{" "}
                      {e.payments
                        .map(
                          (p) =>
                            `${person(p.personId).name} (${format(p.amount, s.currency)})`,
                        )
                        .join(", ")}
                    </p>
                    <details>
                      <summary>See everyone’s share</summary>
                      {s.people
                        .filter((p) => p.id in e.allocations)
                        .map((p) => (
                          <div className="share-row" key={p.id}>
                            <span>{p.name}</span>
                            <span>
                              {format(e.allocations[p.id], s.currency)}
                            </span>
                          </div>
                        ))}
                      {e.items.map((item) => (
                        <p key={item.id}>
                          {item.quantity} × {item.name} · {item.price}{" "}
                          {e.currency} each ·{" "}
                          {item.assignments
                            .map(
                              (a) =>
                                `${person(a.personId).name} (weight ${a.weight})`,
                            )
                            .join(", ")}
                          {item.notes && ` · ${item.notes}`}
                        </p>
                      ))}
                      {e.charges.map((c) => (
                        <p key={c.id}>
                          {c.name} · {c.discount ? "discount" : "charge"}{" "}
                          {c.value}
                          {c.kind === "percent" ? "%" : ` ${e.currency}`} ·{" "}
                          {c.allocation}
                        </p>
                      ))}
                      {e.notes && <p>{e.notes}</p>}
                    </details>
                    <div className="expense-actions">
                      <button className="text-button" onClick={() => onEdit(e)}>
                        Edit expense
                      </button>
                      <button
                        className="text-button danger"
                        onClick={() => onDelete(e)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
          {s.mode === "travel" && categories.length > 0 && (
            <div className="card spaced">
              <h2>Where the adventure went</h2>
              {categories.map(([c, n]) => (
                <div className="category-row" key={c}>
                  <div className="row">
                    <span>{c}</span>
                    <strong>{format(n, s.currency)}</strong>
                  </div>
                  <div className="bar">
                    <span
                      style={{ width: `${total ? (n / total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
              <h3>Spending by traveler</h3>
              {s.people.map((p) => (
                <div className="share-row" key={p.id}>
                  <span>{p.name}</span>
                  <strong>
                    {format(
                      s.expenses.reduce(
                        (a, e) => a + (e.allocations[p.id] || 0),
                        0,
                      ),
                      s.currency,
                    )}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>
        <aside>
          <div className="card balance-card">
            <p className="eyebrow">ALL SQUARED UP</p>
            <h2>The balance board</h2>
            {s.people.map((p) => (
              <div className="share-row" key={p.id}>
                <span>
                  <Avatar person={p} />
                  {p.name}
                </span>
                <div className="balance-amount">
                  <strong
                    className={
                      net[p.id] > 0
                        ? "positive"
                        : net[p.id] < 0
                          ? "negative"
                          : ""
                    }
                  >
                    {format(Math.abs(net[p.id]), s.currency)}
                  </strong>
                  <small>
                    {net[p.id] > 0
                      ? "gets back"
                      : net[p.id] < 0
                        ? "owes"
                        : "settled"}
                  </small>
                </div>
              </div>
            ))}
            <div className="divider" />
            <h3>Suggested transfers</h3>
            <p className="hint">
              These are suggestions, not completed payments. Greedy matching
              reduces transfers; it does not guarantee the absolute minimum.
            </p>
            <AnimatePresence>
              {suggested.map((t) => {
                const key = t.from + t.to;
                return (
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    key={key}
                    className="transfer"
                  >
                    <p>
                      <strong>{person(t.from).name}</strong> pays{" "}
                      <strong>{person(t.to).name}</strong>
                    </p>
                    <h3>{format(t.amount, s.currency)}</h3>
                    <Field
                      label={`Amount paid by ${person(t.from).name} (optional partial)`}
                    >
                      <input
                        inputMode="decimal"
                        placeholder={inputMoney(t.amount, s.currency)}
                        value={partial[key] || ""}
                        onChange={(e) =>
                          setPartial({ ...partial, [key]: e.target.value })
                        }
                      />
                    </Field>
                    <button
                      className="secondary full"
                      onClick={() => settle(t, key)}
                    >
                      <Check size={16} /> Record actual payment
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {!suggested.length && (
              <div className="settled">
                <span>✦</span>
                <h3>
                  {s.expenses.length
                    ? "Everyone’s all settled!"
                    : "A fresh start."}
                </h3>
                <p className="hint">
                  {s.expenses.length
                    ? "Now, back to the good times."
                    : "Add an expense to calculate balances."}
                </p>
              </div>
            )}
            {s.settlements.length > 0 && (
              <details>
                <summary>
                  Recorded transfer history ({s.settlements.length})
                </summary>
                {s.settlements.map((t) => (
                  <div className="transfer" key={t.id}>
                    <p>
                      {person(t.from).name} → {person(t.to).name}:{" "}
                      {format(t.amount, s.currency)}
                    </p>
                    <small>{new Date(t.createdAt).toLocaleString()}</small>
                    <button
                      className="text-button"
                      onClick={() => {
                        if (
                          confirm(
                            "Undo this recorded payment? Balances will be restored.",
                          )
                        )
                          onUpdate({
                            ...s,
                            settlements: s.settlements.filter(
                              (x) => x.id !== t.id,
                            ),
                          });
                      }}
                    >
                      Undo transfer
                    </button>
                  </div>
                ))}
              </details>
            )}
          </div>
          <div className="card spaced">
            <h3>Share the good math.</h3>
            <p className="hint">
              Summaries only. No live sync or invite links.
            </p>
            <div className="share-buttons">
              <button className="secondary" onClick={() => onShare("copy")}>
                <Copy size={16} /> Copy summary
              </button>
              <button className="secondary" onClick={() => onShare("whatsapp")}>
                <Share2 size={16} /> WhatsApp
              </button>
              <button className="secondary" onClick={() => onShare("native")}>
                <Share2 size={16} /> Share
              </button>
              <button className="secondary" onClick={() => onShare("pdf")}>
                <Download size={16} /> PDF report
              </button>
              <button className="secondary" onClick={() => onShare("print")}>
                <Printer size={16} /> Print
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
