import { useEffect, useState } from "react";
import { Plus, LogIn, Users, ArrowLeft } from "lucide-react";
import { Field, CurrencySelect } from "../components/ui";
import { currencies, type Currency, type Mode } from "../domain/model";
import {
  configured,
  backend,
  identity,
  inviteToken,
  localRooms,
  rpc,
} from "./client";
import type { Snapshot } from "./model";
export default function LiveLobby({
  onOpen,
  onBack,
  initialInvite = "",
  filter,
}: {
  onOpen: (room: string, token?: string) => void;
  onBack: () => void;
  initialInvite?: string;
  filter?: "group" | "travel";
}) {
  const [name, setName] = useState(""),
    [display, setDisplay] = useState(""),
    [mode, setMode] = useState<Mode>(filter ?? "own"),
    [currency, setCurrency] = useState<Currency>("MYR"),
    [link, setLink] = useState(initialInvite),
    [destination, setDestination] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [rooms, setRooms] = useState<Snapshot[]>([]);
  useEffect(() => {
    if (configured)
      void backend()
        .auth.getSession()
        .then(async (r) => {
          if (r.data.session)
            setRooms(await localRooms(r.data.session.user.id));
        })
        .catch(() => {});
  }, []);
  async function submit(join: boolean) {
    setError("");
    setBusy(true);
    try {
      if (!display.trim()) throw Error("Choose your display name.");
      await identity();
      if (join) {
        const token = inviteToken(link);
        if (!token) throw Error("Paste a valid invitation link.");
        const room = await rpc<string>("join_room", {
          p_token: token,
          p_display_name: display.trim(),
        });
        history.replaceState(null, "", location.pathname);
        onOpen(room);
      } else {
        if (!name.trim()) throw Error("Give your room a name.");
        if (mode === "travel" && start && end && end < start)
          throw Error("Trip end must be after its start.");
        const created = await rpc<{ roomId: string; token: string }>(
          "create_room",
          {
            p_name: name.trim(),
            p_display_name: display.trim(),
            p_mode: mode,
            p_currency: currency,
            p_destination: destination,
            p_start: start || null,
            p_end: end || null,
          },
        );
        onOpen(created.roomId, created.token);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={16} />
        Back
      </button>
      <div className="page-title">
        <div>
          <p className="eyebrow">EVERYONE GETS A SEAT</p>
          <h1>Split together.</h1>
          <p>Create a room, invite your people, and claim your share.</p>
        </div>
      </div>
      {!configured && (
        <div className="notice" role="status">
          Live rooms are not configured on this installation. Set the public
          Supabase URL and publishable key, apply the migration, and enable
          anonymous sign-ins. Local splits and receipt scanning are ready to
          use.
        </div>
      )}
      <div className="card">
        <Field label="Your display name">
          <input
            maxLength={60}
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            autoComplete="nickname"
          />
        </Field>
        <p className="hint">
          A secure guest session identifies you. Names can repeat. Keep your
          browser session to access your rooms; clearing it may lose guest
          access.
        </p>
      </div>
      <div className="home-bottom">
        <section className="card">
          <h2>
            <Plus size={20} />
            Create a bill room
          </h2>
          <Field label="Room name">
            <input
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Room mode">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="own">Pay Your Own · claim dishes</option>
              <option value="equal">Equally Split</option>
              <option value="group">Group Split</option>
              <option value="travel">Travel Split</option>
            </select>
          </Field>
          <Field label="Room currency">
            <CurrencySelect value={currency} onChange={setCurrency} />
          </Field>
          {mode === "travel" && (
            <>
              <Field label="Destination">
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="Start date">
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </Field>
                <Field label="End date">
                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </Field>
              </div>
            </>
          )}
          <p className="hint">
            Invitations expire after 7 days. Rooms accept expenses for 30 days.
            Repayment confirmation remains available afterward.
          </p>
          <button
            className="primary"
            disabled={!configured || busy}
            onClick={() => submit(false)}
          >
            Create live room
          </button>
        </section>
        <section className="card">
          <h2>
            <LogIn size={20} />
            Join a bill room
          </h2>
          <Field label="Invitation link">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <button
            className="secondary"
            disabled={!configured || busy}
            onClick={() => submit(true)}
          >
            Join live room
          </button>
          <p className="hint">
            An invitation grants room membership. Only authorized members can
            read expenses.
          </p>
        </section>
      </div>
      {busy && <p role="status">Opening your room…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {rooms.filter((s) => !filter || s.room.mode === filter).length > 0 && (
        <>
          <h2>Continue together</h2>
          <div className="session-list">
            {rooms
              .filter((s) => !filter || s.room.mode === filter)
              .map((s) => (
                <button
                  key={s.room.id}
                  className="card row"
                  onClick={() => onOpen(s.room.id)}
                >
                  <span>
                    <Users size={18} /> {s.room.name}
                  </span>
                  <span>{s.members.length} members →</span>
                </button>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
