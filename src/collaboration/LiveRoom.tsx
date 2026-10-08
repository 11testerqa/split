import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowLeft,
  Copy,
  Share2,
  Plus,
  Check,
  Wifi,
  WifiOff,
  Lock,
  ReceiptText,
} from "lucide-react";
import { motion } from "motion/react";
import { Avatar, Field } from "../components/ui";
import { id, type Draft, type Expense } from "../domain/model";
import {
  bill,
  format,
  inputMoney,
  money,
  transfers,
} from "../calculations/engine";
import { download, pdf, summary, printSummary } from "../utilities/share";
import ReceiptScanner from "../ocr/ReceiptScanner";
import type { ParsedReceipt } from "../ocr/model";
import { reconcileReceipt } from "../ocr/parser";
import ExpenseEditor, { newDraft } from "../features/ExpenseEditor";
import {
  deleteSharedDraft,
  getSharedDraft,
  inviteLink,
  rpc,
  saveSharedDraft,
} from "./client";
import { roomSession, type Claim, type Snapshot } from "./model";
import { useRoom } from "./useRoom";
export default function LiveRoom({
  roomId,
  initialToken,
  onBack,
}: {
  roomId: string;
  initialToken?: string;
  onBack: () => void;
}) {
  const {
    snapshot: s,
    user,
    status,
    error,
    online,
    connected,
    refresh,
    setError,
    setStatus,
  } = useRoom(roomId);
  const [actionError, setActionError] = useState("");
  const [token, setToken] = useState(initialToken ?? ""),
    [qr, setQr] = useState(""),
    [busy, setBusy] = useState(false),
    [scan, setScan] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null),
    [revision, setRevision] = useState(0),
    [amounts, setAmounts] = useState<Record<string, string>>({}),
    [funding, setFunding] = useState<Record<string, Record<string, string>>>(
      {},
    ),
    [notice, setNotice] = useState("");
  const pendingPayment = useRef<Record<string, string>>({}),
    draftQueue = useRef(Promise.resolve());
  const session = s ? roomSession(s) : null;
  const owner = s?.room.owner_id === user;
  useEffect(() => {
    let valid = true;
    if (user)
      getSharedDraft(user, roomId)
        .then((d) => {
          if (valid && d) {
            const saved = d as { draft: Draft; revision: number };
            setDraft(saved.draft);
            setRevision(saved.revision);
          }
        })
        .catch(() => setNotice("Local shared draft could not be read."));
    return () => {
      valid = false;
    };
  }, [user, roomId]);
  useEffect(() => {
    if (token) {
      let valid = true;
      QRCode.toDataURL(inviteLink(token), { width: 240, margin: 2 })
        .then((url) => {
          if (valid) setQr(url);
        })
        .catch(() =>
          setNotice("QR code could not be generated. Copy the link instead."),
        );
      return () => {
        valid = false;
      };
    }
  }, [token]);
  useEffect(() => {
    if (draft && user)
      draftQueue.current = draftQueue.current
        .then(() => saveSharedDraft(user, roomId, { draft, revision }))
        .catch(() =>
          setNotice("Local draft saving failed. Keep this screen open."),
        );
  }, [draft, revision, user, roomId]);
  async function act(fn: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(true);
    setActionError("");
    setStatus("Syncing…");
    try {
      await fn();
      await refresh();
      setNotice("Saved to the room.");
      return true;
    } catch (e) {
      setStatus("Failed to sync — retry");
      setActionError(
        `${(e as Error).message}. Your action has not been confirmed. Refresh before retrying.`,
      );
      await refresh();
      setStatus("Failed to sync — retry");
      setActionError(
        `${(e as Error).message}. Your action has not been confirmed. Refresh before retrying.`,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!s || !session)
    return (
      <section>
        <button className="text-button" onClick={onBack}>
          <ArrowLeft />
          Back
        </button>
        <div className="card empty-state">
          <h2>Opening your live room</h2>
          <p role="status">{status}</p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="secondary" onClick={refresh}>
            Retry connection
          </button>
        </div>
      </section>
    );
  const name = (uid: string) =>
    s.members.find((m) => m.user_id === uid)?.display_name ?? "Member";
  const locked =
    s.room.locked || new Date(s.room.expires_at).getTime() <= Date.now();
  const suggestions = transfers(s.balances);
  async function publish(r: ParsedReceipt) {
    const reconciled = reconcileReceipt(r);
    if (reconciled.status !== "Reconciled")
      throw Error("Review receipt totals first.");
    const now = new Date().toISOString();
    const document = {
      id: r.id,
      title: r.merchant || "Receipt",
      currency: r.currency,
      amount: reconciled.expected,
      baseAmount: reconciled.expected,
      printedTotal: r.printedTotal,
      items: r.items.map((i) => ({ ...i, assignments: [] })),
      charges: r.charges,
      date: r.date || now.slice(0, 10),
      category: "Food",
      notes: "Reviewed receipt",
      createdAt: now,
      updatedAt: now,
    };
    return await act(async () => {
      await rpc("publish_receipt", {
        p_room: roomId,
        p_document: document,
        p_reviewed: true,
      });
      setScan(false);
    });
  }
  const start = (expense?: Snapshot["expenses"][number]) => {
    const next = newDraft(session, expense?.document);
    if (!expense)
      next.selected = s.members.filter((m) => m.active).map((m) => m.user_id);
    setDraft(next);
    setRevision(expense?.revision ?? 0);
  };
  return (
    <section>
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to live rooms
      </button>
      <div className="page-title">
        <div>
          <p className="eyebrow">
            {s.room.mode === "travel"
              ? `TRAVEL • ${s.room.destination}`
              : "YOUR BILL, TOGETHER"}
          </p>
          <h1>{s.room.name}</h1>
          <p>
            {s.room.start_date}
            {s.room.end_date && ` → ${s.room.end_date}`}
          </p>
        </div>
        <span className="pill" role="status">
          {online.length ? <Wifi size={15} /> : <WifiOff size={15} />} {status}
        </span>
      </div>
      {notice && (
        <div role="status" className="notice row">
          <span>{notice}</span>
          <button className="text-button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      {(actionError || error) && (
        <p role="alert" className="error">
          {actionError || error}
        </p>
      )}
      <button className="text-button" disabled={busy} onClick={refresh}>
        Refresh room
      </button>
      <div className="chips">
        {session.people.map((p) => (
          <span className="person-chip" key={p.id}>
            <Avatar person={p} />
            {p.name}
            {p.id === user ? " (you)" : ""}
            {s.members.find((m) => m.user_id === p.id)?.active
              ? ""
              : " (access revoked)"}
            <span
              role="img"
              className={`presence ${online.includes(p.id) ? "present" : ""}`}
              aria-label={
                online.includes(p.id)
                  ? "Active connection"
                  : "Disconnected or presence unavailable"
              }
            />
          </span>
        ))}
      </div>
      <p className="hint">
        {connected
          ? "Live updates connected."
          : "Live updates reconnecting. Refresh is available."}{" "}
        Presence expires after 45 seconds. Online status does not verify
        payment. {locked ? "Room is locked or expired." : ""}
      </p>
      {owner && (
        <details className="card">
          <summary>Invite & room controls</summary>
          <p className="hint">
            The invitation grants access to this room. Share it with your
            intended participants. Creating a new link revokes the old link.
          </p>
          {token ? (
            <>
              <Field label="Shareable room invitation">
                <input readOnly value={inviteLink(token)} />
              </Field>
              <div className="chips">
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteLink(token));
                      setNotice("Invitation copied.");
                    } catch {
                      setError(
                        "Copy failed. Select and copy the invitation above.",
                      );
                    }
                  }}
                >
                  <Copy size={16} />
                  Copy invitation
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    window.open(
                      `https://wa.me/?text=${encodeURIComponent(`Join ${s.room.name} on SplitPop: ${inviteLink(token)}`)}`,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  WhatsApp invite
                </button>
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      if (navigator.share)
                        await navigator.share({
                          title: s.room.name,
                          url: inviteLink(token),
                        });
                      else
                        await navigator.clipboard.writeText(inviteLink(token));
                    } catch (e) {
                      if ((e as Error).name !== "AbortError")
                        setError("Sharing failed. Copy the invitation above.");
                    }
                  }}
                >
                  <Share2 size={16} />
                  Share invitation
                </button>
              </div>
              {qr && (
                <img
                  className="invite-qr"
                  src={qr}
                  alt="QR code for this room invitation"
                />
              )}
            </>
          ) : (
            <p>
              Invitation secrets are only shown when created. Generate a new
              link to share.
            </p>
          )}
          <button
            className="secondary"
            disabled={busy || locked}
            onClick={() =>
              act(async () => {
                const inv = await rpc<{ token: string }>("rotate_invitation", {
                  p_room: roomId,
                });
                setToken(inv.token);
              })
            }
          >
            Generate new invitation
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              act(() =>
                rpc("lock_room", { p_room: roomId, p_locked: !s.room.locked }),
              )
            }
          >
            <Lock size={16} />
            {s.room.locked ? "Unlock room" : "Lock room"}
          </button>
          {s.members
            .filter((m) => m.user_id !== user)
            .map((m) => (
              <div key={m.user_id} className="share-row">
                <span>
                  {m.display_name} · {m.user_id.slice(0, 8)}
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    act(() =>
                      rpc("set_room_access", {
                        p_room: roomId,
                        p_user: m.user_id,
                        p_active: !m.active,
                      }),
                    )
                  }
                >
                  {m.active ? "Revoke access" : "Restore access"}
                </button>
              </div>
            ))}
        </details>
      )}
      {scan && (
        <ReceiptScanner
          draftKey={`room:${user}:${roomId}`}
          currency={s.room.currency}
          onClose={() => setScan(false)}
          onConfirm={publish}
        />
      )}
      {draft && (
        <ExpenseEditor
          session={session}
          draft={draft}
          onChange={setDraft}
          onBack={() => setDraft(null)}
          onSave={(e) =>
            act(async () => {
              await rpc("save_shared_expense", {
                p_room: roomId,
                p_document: e,
                p_revision: revision,
              });
              await draftQueue.current;
              await deleteSharedDraft(user, roomId);
              setDraft(null);
            })
          }
        />
      )}
      {!draft && (
        <>
          <div className="section-heading">
            <h2>
              {s.room.mode === "own" ? "Claim your dishes" : "Shared expenses"}
            </h2>
            {s.room.mode === "own" ? (
              owner && (
                <button
                  className="primary"
                  disabled={locked || busy}
                  onClick={() => setScan(true)}
                >
                  <ReceiptText size={18} />
                  Scan a receipt
                </button>
              )
            ) : (
              <button
                className="primary"
                disabled={locked || busy}
                onClick={() => start()}
              >
                <Plus size={18} />
                Add shared expense
              </button>
            )}
          </div>
          {s.expenses
            .filter((e) => e.state === "claiming")
            .map((ex) => {
              const items = s.items.filter((i) => i.expense_id === ex.id);
              const allClaimed = items.every((i) =>
                s.claims.some(
                  (c) => c.item_id === i.id && Number(c.weight) > 0,
                ),
              );
              let current: ReturnType<typeof bill> | null = null;
              try {
                current = bill(
                  items
                    .filter((i) =>
                      s.claims.some(
                        (c) => c.item_id === i.id && Number(c.weight) > 0,
                      ),
                    )
                    .map((i) => ({
                      ...i.source,
                      assignments: s.claims
                        .filter(
                          (c) => c.item_id === i.id && Number(c.weight) > 0,
                        )
                        .sort(
                          (a, b) =>
                            session.people.findIndex(
                              (p) => p.id === a.user_id,
                            ) -
                            session.people.findIndex((p) => p.id === b.user_id),
                        )
                        .map((c) => ({
                          personId: c.user_id,
                          weight: String(c.weight),
                        })),
                    })),
                  allClaimed ? ex.document.charges : [],
                  session.people.map((p) => p.id),
                  s.room.currency,
                  items.some((i) =>
                    s.claims.some(
                      (c) => c.item_id === i.id && Number(c.weight) > 0,
                    ),
                  )
                    ? undefined
                    : Object.fromEntries(session.people.map((p) => [p.id, 0])),
                );
              } catch {}
              return (
                <div className="card" key={ex.id}>
                  <div className="row">
                    <h3>{ex.document.title}</h3>
                    <strong>
                      {format(ex.document.amount, s.room.currency)}
                    </strong>
                  </div>
                  <p className="hint">
                    {
                      items.filter((i) =>
                        s.claims.some(
                          (c) => c.item_id === i.id && Number(c.weight) > 0,
                        ),
                      ).length
                    }
                    /{items.length} items claimed · Reviewed receipt
                  </p>
                  <div className="claim-grid">
                    {items.map((i) => {
                      const claims = s.claims.filter(
                          (c) => c.item_id === i.id && Number(c.weight) > 0,
                        ),
                        mine = s.claims.find(
                          (c) => c.item_id === i.id && c.user_id === user,
                        );
                      return (
                        <motion.article
                          layout
                          className="item-card claim-card"
                          key={i.id}
                        >
                          <div className="row">
                            <h3>{i.description}</h3>
                            <strong>
                              {format(
                                i.unit_price * i.quantity,
                                s.room.currency,
                              )}
                            </strong>
                          </div>
                          <p className="hint">
                            {i.quantity} ×{" "}
                            {format(i.unit_price, s.room.currency)} ·{" "}
                            {claims.length
                              ? `${claims.length} sharing`
                              : "Unclaimed"}
                          </p>
                          <div className="chips">
                            {claims.map((c) => (
                              <span className="person-chip" key={c.user_id}>
                                {name(c.user_id)} · {c.weight} portions
                              </span>
                            ))}
                          </div>
                          <button
                            className={
                              mine && Number(mine.weight) > 0
                                ? "secondary full"
                                : "primary full"
                            }
                            aria-pressed={!!mine && Number(mine.weight) > 0}
                            disabled={busy || locked}
                            onClick={() =>
                              act(() =>
                                rpc("set_item_claim", {
                                  p_room: roomId,
                                  p_item: i.id,
                                  p_user: user,
                                  p_weight:
                                    mine && Number(mine.weight) > 0 ? 0 : 1,
                                  p_revision: mine?.revision ?? 0,
                                }),
                              )
                            }
                          >
                            {mine && Number(mine.weight) > 0
                              ? "Remove my claim"
                              : "Claim my item"}
                          </button>
                          {mine && Number(mine.weight) > 0 && (
                            <Field label={`My portions of ${i.description}`}>
                              <input
                                type="number"
                                min="0.001"
                                max="1000000"
                                step="any"
                                defaultValue={mine.weight}
                                key={mine.revision}
                                disabled={busy || locked}
                                onBlur={(e) => {
                                  const w = Number(e.target.value);
                                  if (w !== Number(mine.weight) && w > 0)
                                    void act(() =>
                                      rpc("set_item_claim", {
                                        p_room: roomId,
                                        p_item: i.id,
                                        p_user: user,
                                        p_weight: w,
                                        p_revision: mine.revision,
                                      }),
                                    );
                                }}
                              />
                            </Field>
                          )}
                          {owner && (
                            <details>
                              <summary>Correct assignments</summary>
                              {session.people
                                .filter((p) =>
                                  s.members.some(
                                    (m) => m.user_id === p.id && m.active,
                                  ),
                                )
                                .map((p) => {
                                  const c = s.claims.find(
                                    (c) =>
                                      c.item_id === i.id && c.user_id === p.id,
                                  );
                                  return (
                                    <button
                                      key={p.id}
                                      className="person-chip"
                                      disabled={busy || locked}
                                      aria-pressed={!!c && Number(c.weight) > 0}
                                      onClick={() =>
                                        act(() =>
                                          rpc("set_item_claim", {
                                            p_room: roomId,
                                            p_item: i.id,
                                            p_user: p.id,
                                            p_weight:
                                              c && Number(c.weight) > 0 ? 0 : 1,
                                            p_revision: c?.revision ?? 0,
                                          }),
                                        )
                                      }
                                    >
                                      <Avatar person={p} />
                                      {p.name}
                                    </button>
                                  );
                                })}
                            </details>
                          )}
                        </motion.article>
                      );
                    })}
                  </div>
                  {current && (
                    <div className="card">
                      <h3>Current shares</h3>
                      {!allClaimed && (
                        <p className="hint">
                          Item subtotal only. Charges appear once every item is
                          claimed.
                        </p>
                      )}
                      {session.people.map((p) => (
                        <div className="share-row" key={p.id}>
                          <span>
                            <Avatar person={p} />
                            {p.name}
                          </span>
                          <motion.strong
                            key={current!.shares[p.id]}
                            initial={{ opacity: 0.5 }}
                            animate={{ opacity: 1 }}
                          >
                            {format(
                              current!.shares[p.id] ?? 0,
                              s.room.currency,
                            )}
                          </motion.strong>
                        </div>
                      ))}
                    </div>
                  )}
                  {!allClaimed && (
                    <p className="notice">
                      Claim every item before finalizing. Shared items use
                      portion weights.
                    </p>
                  )}
                  {owner && (
                    <details>
                      <summary>Record restaurant payment & finalize</summary>
                      <p className="hint">
                        Record the actual amount each payer contributed to the
                        restaurant. Reimbursements between friends are recorded
                        separately below.
                      </p>
                      {session.people.map((p) => (
                        <Field
                          key={p.id}
                          label={`${p.name} restaurant contribution`}
                        >
                          <input
                            inputMode="decimal"
                            value={funding[ex.id]?.[p.id] ?? ""}
                            onChange={(e) =>
                              setFunding({
                                ...funding,
                                [ex.id]: {
                                  ...funding[ex.id],
                                  [p.id]: e.target.value,
                                },
                              })
                            }
                          />
                        </Field>
                      ))}
                      <button
                        className="primary"
                        disabled={busy || locked || !allClaimed}
                        onClick={() =>
                          act(() =>
                            rpc("finalize_receipt", {
                              p_room: roomId,
                              p_expense: ex.id,
                              p_revision: ex.revision,
                              p_payments: session.people
                                .map((p) => ({
                                  personId: p.id,
                                  amount: money(
                                    funding[ex.id]?.[p.id] || "0",
                                    s.room.currency,
                                  ),
                                }))
                                .filter((p) => p.amount > 0),
                            }),
                          )
                        }
                      >
                        Finalize bill & calculate repayments
                      </button>
                    </details>
                  )}
                </div>
              );
            })}
          {s.expenses.length === 0 && (
            <div className="card friendly-empty">
              <ReceiptText size={32} />
              <h3>Bring the bill. Everyone joins in.</h3>
              <p>
                {owner
                  ? "Scan a receipt or add an expense to start."
                  : "Invite accepted. Your host can scan the receipt while you get comfortable."}
              </p>
            </div>
          )}
          {s.expenses
            .filter((e) => e.state === "finalized")
            .map((e) => (
              <details className="card" key={e.id}>
                <summary>
                  {e.document.title} ·{" "}
                  {format(e.document.baseAmount, s.room.currency)} ·{" "}
                  {e.document.date} · {e.document.category}
                </summary>
                {e.document.exchange && (
                  <p>
                    Original {format(e.document.amount, e.document.currency)} ·
                    Manual rate {e.document.exchange.rate} · Recorded{" "}
                    {e.document.exchange.capturedAt}
                  </p>
                )}
                {Object.entries(e.document.allocations).map(([uid, amount]) => (
                  <div className="share-row" key={uid}>
                    <span>{name(uid)}</span>
                    <strong>{format(amount, s.room.currency)}</strong>
                  </div>
                ))}
                {(owner || e.author_id === user) && s.room.mode !== "own" && (
                  <>
                    <button
                      className="text-button"
                      disabled={locked || busy}
                      onClick={() => start(e)}
                    >
                      Edit shared expense
                    </button>
                    <button
                      className="text-button"
                      disabled={locked || busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Delete this expense? Payment history will remain.",
                          )
                        )
                          void act(() =>
                            rpc("delete_shared_expense", {
                              p_room: roomId,
                              p_expense: e.id,
                              p_revision: e.revision,
                            }),
                          );
                      }}
                    >
                      Delete shared expense
                    </button>
                  </>
                )}
              </details>
            ))}
          <div className="card">
            <h2>Balances & repayments</h2>
            <p className="hint">
              Positive balances are owed money. Only recipient-confirmed
              repayments update these balances. Transfers happen outside
              SplitPop.
            </p>
            {session.people.map((p) => (
              <div className="share-row" key={p.id}>
                <span>
                  <Avatar person={p} />
                  {p.name}
                </span>
                <strong>
                  {format(s.balances[p.id] ?? 0, s.room.currency)}
                </strong>
              </div>
            ))}
            {suggestions.length === 0 &&
              s.expenses.some((e) => e.state === "finalized") && (
                <div role="status" className="notice">
                  Everyone is settled. Keep the fun! ✦
                </div>
              )}
            {suggestions.map((t, index) => {
              const k = `${t.from}:${t.to}`;
              return (
                <article className="item-card" key={k}>
                  <h3>
                    {name(t.from)} → {name(t.to)} ·{" "}
                    {format(t.amount, s.room.currency)}
                  </h3>
                  <span className="pill">Outstanding</span>
                  {t.from === user && (
                    <>
                      <Field
                        label={`Repayment to ${name(t.to)} (optional partial)`}
                      >
                        <input
                          inputMode="decimal"
                          placeholder={inputMoney(t.amount, s.room.currency)}
                          value={amounts[k] ?? ""}
                          onChange={(e) => {
                            setAmounts({ ...amounts, [k]: e.target.value });
                            delete pendingPayment.current[k];
                          }}
                        />
                      </Field>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            const pid = (pendingPayment.current[k] ??= id());
                            await rpc("report_payment", {
                              p_room: roomId,
                              p_id: pid,
                              p_recipient: t.to,
                              p_amount: amounts[k]
                                ? money(amounts[k], s.room.currency)
                                : t.amount,
                            });
                            delete pendingPayment.current[k];
                            setAmounts((a) => ({ ...a, [k]: "" }));
                          })
                        }
                      >
                        I've paid
                      </button>
                    </>
                  )}
                </article>
              );
            })}
            {s.payments.map((p) => (
              <article className="item-card" key={p.id}>
                <div className="row">
                  <strong>
                    {name(p.debtor_id)} → {name(p.recipient_id)}
                  </strong>
                  <strong>{format(p.amount, s.room.currency)}</strong>
                </div>
                <p>
                  {
                    (
                      {
                        outstanding: "Outstanding",
                        sent: "Marked as sent · awaiting recipient confirmation",
                        confirmed: "Confirmed received",
                        rejected: "Rejected / disputed · still unresolved",
                        cancelled: "Cancelled",
                      } as const
                    )[p.status]
                  }
                </p>
                <small>{new Date(p.updated_at).toLocaleString()}</small>
                <div className="chips">
                  {p.status === "sent" && p.recipient_id === user && (
                    <>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            rpc("respond_payment", {
                              p_room: roomId,
                              p_id: p.id,
                              p_action: "confirmed",
                            }),
                          )
                        }
                      >
                        <Check size={16} />
                        Confirm received
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            rpc("respond_payment", {
                              p_room: roomId,
                              p_id: p.id,
                              p_action: "rejected",
                            }),
                          )
                        }
                      >
                        Reject payment
                      </button>
                    </>
                  )}
                  {p.status === "sent" && p.debtor_id === user && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          rpc("respond_payment", {
                            p_room: roomId,
                            p_id: p.id,
                            p_action: "cancelled",
                          }),
                        )
                      }
                    >
                      Cancel reported payment
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <details className="card">
            <summary>
              Activity & notifications{" "}
              {s.notifications.length > 0
                ? `(${s.notifications.length} unread)`
                : ""}
            </summary>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                act(() => rpc("read_notifications", { p_room: roomId }))
              }
            >
              Mark notifications read
            </button>
            {s.events.map((e, i) => {
              const previous = s.events[i - 1];
              if (
                previous &&
                previous.kind === e.kind &&
                previous.actor_id === e.actor_id &&
                new Date(previous.created_at).getTime() -
                  new Date(e.created_at).getTime() <
                  15000
              )
                return null;
              return (
                <div className="share-row" key={e.id}>
                  <span>
                    {name(e.actor_id)} · {e.kind.replaceAll("_", " ")}
                  </span>
                  <small>{new Date(e.created_at).toLocaleString()}</small>
                </div>
              );
            })}
          </details>
          <details className="card">
            <summary>Share & export settlement report</summary>
            <div className="chips">
              <button
                className="secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(summary(session))
                    .then(() => setNotice("Summary copied."))
                    .catch(() => setError("Copy failed. Try downloading."))
                }
              >
                Copy summary
              </button>
              <button
                className="secondary"
                onClick={() =>
                  pdf(session).catch(() =>
                    setError("PDF export failed. Try printing."),
                  )
                }
              >
                Export PDF
              </button>
              <button
                className="secondary"
                onClick={() => printSummary(session)}
              >
                Print report
              </button>
              <button
                className="secondary"
                onClick={() =>
                  download(
                    JSON.stringify(
                      {
                        version: 2,
                        exportedAt: new Date().toISOString(),
                        snapshot: s,
                      },
                      null,
                      2,
                    ),
                    "splitpop-shared-room.json",
                  )
                }
              >
                Export room JSON
              </button>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
