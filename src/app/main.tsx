import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { motion, MotionConfig } from "motion/react";
import {
  Home,
  History,
  Users,
  Settings,
  Plus,
  ArrowUpRight,
  ReceiptText,
  ArrowRight,
  Sun,
  Moon,
  Sparkles,
} from "lucide-react";
import type { Data, Session, Mode, Expense } from "../domain/model";
import { modes } from "../domain/presentation";
import {
  empty,
  load,
  parseBackup,
  save,
  clear,
  rawBackup,
} from "../storage/store";
import { Illustration } from "../components/ui";
import { format, balances } from "../calculations/engine";
import SessionList from "../components/SessionList";
import CreateSession from "../features/CreateSession";
import SessionView from "../features/SessionView";
import SettingsView from "../features/SettingsView";
import ExpenseEditor, { newDraft } from "../features/ExpenseEditor";
import { download, pdf, summary, printSummary } from "../utilities/share";
import "../styles/app.css";
function App() {
  const [data, setData] = useState<Data>(empty);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!celebrate) return;
    const timer = setTimeout(() => setCelebrate(false), 2800);
    return () => clearTimeout(timer);
  }, [celebrate]);
  const [page, setPage] = useState("Home");
  const [active, setActive] = useState<string | null>(null);
  const [creating, setCreating] = useState<Mode | null>(null);
  const [editing, setEditing] = useState(false);
  const [undo, setUndo] = useState<{
    sessionId: string;
    expense: Expense;
  } | null>(null);
  const writeQueue = useRef(Promise.resolve());
  useEffect(() => {
    load()
      .then((d) => {
        setData(d);
        setLoaded(true);
      })
      .catch(() => {
        setStorageError(true);
        setLoaded(true);
        setNotice(
          "Saved data could not be read. Export or recover your backup before replacing local data. New changes will not overwrite it.",
        );
      });
  }, []);
  useEffect(() => {
    if (loaded && !storageError)
      writeQueue.current = writeQueue.current
        .then(() => save(data))
        .catch(() => {
          setStorageError(true);
          setNotice(
            "Local saving failed. Download a backup to keep your work.",
          );
        });
  }, [data, loaded, storageError]);
  useEffect(() => {
    const dark =
      data.theme === "dark" ||
      (data.theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const m = matchMedia("(prefers-color-scheme: dark)");
    const f = () => {
      if (data.theme === "system")
        document.documentElement.dataset.theme = m.matches ? "dark" : "light";
    };
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [data.theme]);
  const s = data.sessions.find((s) => s.id === active);
  const updateSession = (s: Session) =>
    setData((d) => ({
      ...d,
      sessions: d.sessions.map((x) =>
        x.id === s.id ? { ...s, updatedAt: new Date().toISOString() } : x,
      ),
    }));
  function openSession(s: Session) {
    setActive(s.id);
    setEditing(false);
    setCreating(null);
  }
  function startExpense(s: Session, e?: Expense) {
    if (
      data.draft &&
      data.draft.sessionId !== s.id &&
      !confirm(
        "Another expense has a saved draft. Replace that unfinished draft?",
      )
    )
      return;
    setData((d) => ({ ...d, draft: newDraft(s, e) }));
    setEditing(true);
  }
  function removeExpense(e: Expense) {
    if (
      !s ||
      !confirm(
        `Delete “${e.title}”? ${s.settlements.length ? "Recorded settlements will stay in the audit trail." : ""}`,
      )
    )
      return;
    setUndo({ sessionId: s.id, expense: e });
    updateSession({ ...s, expenses: s.expenses.filter((x) => x.id !== e.id) });
  }
  async function share(action: string) {
    if (!s) return;
    try {
      const text = summary(s);
      if (action === "copy") {
        await navigator.clipboard.writeText(text);
        setNotice("Summary copied.");
      } else if (action === "pdf") await pdf(s);
      else if (action === "native") {
        if (navigator.share) await navigator.share({ title: s.name, text });
        else {
          download(text, "splitpop-summary.txt", "text/plain");
          setNotice(
            "Sharing is unavailable here. A text report was downloaded.",
          );
        }
      } else if (action === "print") printSummary(s);
      else if (action === "whatsapp")
        window.open(
          `https://wa.me/?text=${encodeURIComponent(text)}`,
          "_blank",
          "noopener,noreferrer",
        );
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setNotice("Sharing could not complete. Try downloading a report.");
    }
  }
  function nav(p: string) {
    setPage(p);
    setActive(null);
    setCreating(null);
    setEditing(false);
  }
  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <header className="site-header">
          <button
            className="brand"
            onClick={() => nav("Home")}
            aria-label="SplitPop home"
          >
            <span className="brand-icon">✦</span>Split<span>Pop</span>
            <span className="brand-dot">.</span>
          </button>
          <nav className="desktop-nav" aria-label="Main navigation">
            {[Home, History, Users, Settings].map((Icon, i) => {
              const p = ["Home", "History", "Groups", "Settings"][i];
              return (
                <button
                  key={p}
                  className={page === p && !active ? "active" : ""}
                  onClick={() => nav(p)}
                >
                  <Icon size={17} />
                  {p}
                </button>
              );
            })}
          </nav>
          <div className="header-end">
            <span className="local-badge">
              <span /> Local & private
            </span>
            <button
              className="icon-button"
              aria-label="Toggle dark mode"
              onClick={() =>
                setData((d) => ({
                  ...d,
                  theme:
                    document.documentElement.dataset.theme === "dark"
                      ? "light"
                      : "dark",
                }))
              }
            >
              {document.documentElement.dataset.theme === "dark" ? (
                <Sun size={19} />
              ) : (
                <Moon size={19} />
              )}
            </button>
          </div>
        </header>
        {celebrate && (
          <div className="success-burst" role="status">
            <div className="burst-coins" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  initial={{ y: -15, opacity: 0, rotate: -20 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.35 }}
                >
                  ✦
                </motion.span>
              ))}
            </div>
            <strong>Fair shares. Good vibes.</strong>
            <button
              className="text-button"
              aria-label="Dismiss split celebration"
              onClick={() => setCelebrate(false)}
            >
              ×
            </button>
          </div>
        )}
        <main>
          {storageError && (
            <div className="notice">
              <p>
                Local saving is unavailable. Your current changes are in memory
                only.
              </p>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    const raw = await rawBackup();
                    download(
                      JSON.stringify(raw ?? data, null, 2),
                      "splitpop-recovery.json",
                    );
                    setNotice(
                      "Recovery file downloaded. Keep it before resetting or importing a backup.",
                    );
                  } catch {
                    download(
                      JSON.stringify(data, null, 2),
                      "splitpop-current-work.json",
                    );
                    setNotice(
                      "Current work downloaded. The existing browser data could not be read.",
                    );
                  }
                }}
              >
                Download stored recovery data
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice row">
              <span>{notice}</span>
              <button className="text-button" onClick={() => setNotice("")}>
                Dismiss
              </button>
            </div>
          )}
          {undo && (
            <div className="notice row">
              <span>Expense deleted.</span>
              <button
                className="text-button"
                onClick={() => {
                  const target = data.sessions.find(
                    (x) => x.id === undo.sessionId,
                  );
                  if (target)
                    updateSession({
                      ...target,
                      expenses: [...target.expenses, undo.expense],
                    });
                  setUndo(null);
                }}
              >
                Undo
              </button>
            </div>
          )}
          {!loaded ? (
            <div className="empty-state">Opening your local space…</div>
          ) : creating ? (
            <CreateSession
              mode={creating}
              data={data}
              onBack={() => setCreating(null)}
              onCreate={(session) => {
                setData((d) => ({ ...d, sessions: [session, ...d.sessions] }));
                setCreating(null);
                setActive(session.id);
                if (session.mode === "equal" || session.mode === "own") {
                  setData((d) => ({ ...d, draft: newDraft(session) }));
                  setEditing(true);
                }
              }}
            />
          ) : s ? (
            editing && data.draft?.sessionId === s.id ? (
              <ExpenseEditor
                session={s}
                draft={data.draft}
                onChange={(draft) => setData((d) => ({ ...d, draft }))}
                onBack={() => setEditing(false)}
                onSave={(expense) => {
                  balances({
                    ...s,
                    expenses: [
                      ...s.expenses.filter((e) => e.id !== expense.id),
                      expense,
                    ],
                  });
                  setData((d) => ({
                    ...d,
                    draft: null,
                    sessions: d.sessions.map((x) =>
                      x.id === s.id
                        ? {
                            ...x,
                            expenses: [
                              ...x.expenses.filter((e) => e.id !== expense.id),
                              expense,
                            ],
                            updatedAt: new Date().toISOString(),
                          }
                        : x,
                    ),
                  }));
                  setEditing(false);
                  setCelebrate(true);
                  setNotice("Expense saved. Your shares are all squared up.");
                }}
              />
            ) : (
              <SessionView
                session={s}
                onBack={() => setActive(null)}
                onAdd={() => startExpense(s)}
                onEdit={(e) => startExpense(s, e)}
                onDelete={removeExpense}
                onUpdate={updateSession}
                onShare={share}
                onNotice={setNotice}
                onResume={
                  data.draft?.sessionId === s.id
                    ? () => setEditing(true)
                    : undefined
                }
              />
            )
          ) : page === "Home" ? (
            <>
              <div className="greeting">
                <span>YOUR PEOPLE. YOUR PLANS. YOUR FAIR SHARE.</span>
                <span>✦ Less math, more memories</span>
              </div>
              <section className="hero">
                <div className="hero-copy">
                  <div className="pill">
                    <Sparkles size={15} /> A little fairness goes a long way
                  </div>
                  <h1>
                    Split bills.
                    <br />
                    Keep the <span>fun.</span>
                  </h1>
                  <p>
                    Dinner with friends, a weekend away, the everyday.
                    <br className="desktop-only" /> Make sharing expenses feel
                    effortless.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setCreating("equal")}
                  >
                    Split a bill <ArrowUpRight size={19} />
                  </button>
                  <div className="hero-foot">
                    <span className="mini-avatars">A B C</span>
                    <span>No sign-up. No awkward math.</span>
                  </div>
                </div>
                <Illustration />
                <span className="hero-note">
                  Good times look better together ↗
                </span>
              </section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">FOUR WAYS TO KEEP IT FAIR</p>
                  <h2>What are we splitting?</h2>
                </div>
                <span className="hint">
                  Pick your plan. We’ll handle the numbers.
                </span>
              </div>
              <div className="mode-grid">
                {modes.map((m, i) => (
                  <motion.button
                    className={`mode-card ${m.color}`}
                    aria-label={m.title}
                    key={m.id}
                    whileHover={{ y: -5 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setCreating(m.id)}
                  >
                    <div className="row">
                      <span className="mode-art" aria-hidden="true">
                        {m.emoji}
                      </span>
                      <span className="round-arrow">
                        <ArrowUpRight size={19} />
                      </span>
                    </div>
                    <span className="mode-number">0{i + 1}</span>
                    <h3>{m.title}</h3>
                    <p>{m.text}</p>
                    <small>{m.detail}</small>
                  </motion.button>
                ))}
              </div>
              {data.draft && (
                <div className="resume card row">
                  <div>
                    <p className="eyebrow">RIGHT WHERE YOU LEFT OFF</p>
                    <h3>{data.draft.title || "Your unfinished split"}</h3>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      setActive(data.draft!.sessionId);
                      setEditing(true);
                    }}
                  >
                    Continue <ArrowRight size={16} />
                  </button>
                </div>
              )}
              <div className="home-bottom">
                <section>
                  <div className="section-heading">
                    <h2>Recent activity</h2>
                    <button
                      className="text-button"
                      onClick={() => nav("History")}
                    >
                      View all <ArrowRight size={16} />
                    </button>
                  </div>
                  {data.sessions.filter((s) => s.expenses.length).length ? (
                    <SessionList
                      sessions={data.sessions
                        .filter((s) => s.expenses.length)
                        .slice(0, 3)}
                      onOpen={openSession}
                    />
                  ) : (
                    <div className="card friendly-empty">
                      <span className="empty-icon">
                        <ReceiptText size={26} />
                      </span>
                      <h3>Your first split starts a story.</h3>
                      <p>Your saved bills and adventures will live here.</p>
                      <button
                        className="text-button"
                        onClick={() => setCreating("own")}
                      >
                        Make your first split <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </section>
                <section>
                  <div className="section-heading">
                    <h2>Your circles</h2>
                    <button
                      className="text-button"
                      onClick={() => nav("Groups")}
                    >
                      View all
                    </button>
                  </div>
                  {data.sessions.some((s) =>
                    ["group", "travel"].includes(s.mode),
                  ) ? (
                    <SessionList
                      sessions={data.sessions
                        .filter((s) => ["group", "travel"].includes(s.mode))
                        .slice(0, 3)}
                      onOpen={openSession}
                    />
                  ) : (
                    <div className="card circles-empty">
                      <div className="avatar-stack">
                        <span>A</span>
                        <span>B</span>
                        <span>+</span>
                      </div>
                      <h3>Good company. Clear balances.</h3>
                      <p>Create a circle for your favorite people.</p>
                      <button
                        className="secondary"
                        onClick={() => setCreating("group")}
                      >
                        <Plus size={16} /> Create a group
                      </button>
                    </div>
                  )}
                </section>
              </div>
              <div className="privacy-footer">
                <span>♧ Your money stories stay yours.</span>
                <span>Saved on this device. No account needed.</span>
              </div>
            </>
          ) : page === "Settings" ? (
            <SettingsView
              data={data}
              onChange={setData}
              onNotice={setNotice}
              onReset={async () => {
                if (
                  !confirm(
                    "Delete all SplitPop data on this device? Download a backup first.",
                  )
                )
                  return;
                await writeQueue.current;
                await clear();
                setStorageError(false);
                setData({ ...empty });
                setNotice("All local data deleted.");
              }}
              onImport={async (raw) => {
                try {
                  const next = parseBackup(raw);
                  if (
                    !confirm(
                      "Replace local data with this backup? Export your current data first.",
                    )
                  )
                    return;
                  await writeQueue.current;
                  await save(next);
                  setStorageError(false);
                  setData(next);
                  setNotice("Backup restored.");
                } catch {
                  setNotice(
                    "This backup is invalid or contains unbalanced financial data. Nothing was replaced.",
                  );
                }
              }}
            />
          ) : (
            <section>
              <div className="page-title">
                <div>
                  <p className="eyebrow">
                    {page === "Groups"
                      ? "YOUR PEOPLE, ALL TOGETHER"
                      : "EVERY MEMORY, EVERY SPLIT"}
                  </p>
                  <h1>
                    {page === "Groups" ? "Your circles." : "Your history."}
                  </h1>
                </div>
                <button
                  className="primary"
                  onClick={() =>
                    setCreating(page === "Groups" ? "group" : "equal")
                  }
                >
                  <Plus size={18} /> New {page === "Groups" ? "group" : "split"}
                </button>
              </div>
              <SessionList
                sessions={data.sessions.filter(
                  (s) =>
                    page !== "Groups" || ["group", "travel"].includes(s.mode),
                )}
                onOpen={openSession}
              />
              {!data.sessions.length && (
                <div className="card friendly-empty">
                  <Illustration />
                  <h2>Start something together.</h2>
                  <p>Your local sessions will appear here.</p>
                </div>
              )}
            </section>
          )}
        </main>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {[Home, History, Users, Settings].map((Icon, i) => {
            const p = ["Home", "History", "Groups", "Settings"][i];
            return (
              <button
                key={p}
                className={page === p && !active ? "active" : ""}
                onClick={() => nav(p)}
              >
                <Icon size={21} />
                {p}
              </button>
            );
          })}
        </nav>
        <footer className="site-footer">
          <span>SplitPop · Split bills. Keep the fun.</span>
          <span>Made for moments, big & small.</span>
        </footer>
      </div>
    </MotionConfig>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
