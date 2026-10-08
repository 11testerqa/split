import { useEffect, useState } from "react";
import {
  configured,
  backend,
  localRooms,
  rpc,
  cacheSnapshot,
  forgetSnapshot,
} from "./client";
import { format } from "../calculations/engine";
import type { Snapshot } from "./model";
export default function SharedHome({
  onOpen,
}: {
  onOpen: (room: string) => void;
}) {
  const [rooms, setRooms] = useState<Snapshot[]>([]),
    [uid, setUid] = useState(""),
    [status, setStatus] = useState("");
  useEffect(() => {
    let valid = true;
    if (configured)
      void backend()
        .auth.getSession()
        .then(async (result) => {
          const user = result.data.session?.user.id;
          if (!user) return;
          const cached = await localRooms(user);
          if (!valid) return;
          setUid(user);
          setRooms(cached);
          setStatus("Last saved snapshots — open a room to sync.");
        })
        .catch(() => {
          if (valid) setStatus("Shared room history could not be read.");
        });
    return () => {
      valid = false;
    };
  }, []);
  async function refresh() {
    setStatus("Checking shared rooms…");
    let failed = false;
    const latest = await Promise.all(
      rooms.map(async (s) => {
        try {
          const next = await rpc<Snapshot>("room_snapshot", {
            p_room: s.room.id,
          });
          await cacheSnapshot(uid, next);
          return next;
        } catch (e) {
          if (/access denied/i.test((e as Error).message)) {
            await forgetSnapshot(uid, s.room.id);
            return null;
          }
          failed = true;
          return s;
        }
      }),
    );
    setRooms(latest.filter((s): s is Snapshot => s !== null));
    setStatus(
      failed
        ? "Some rooms could not sync. Saved snapshots are shown."
        : "Shared snapshots synced.",
    );
  }
  if (!rooms.length) return null;
  const pending = rooms.flatMap((s) =>
    s.payments
      .filter((p) => p.status === "sent" && p.recipient_id === uid)
      .map((p) => ({ room: s, payment: p })),
  );
  return (
    <section className="card">
      <div className="row">
        <h2>Continue together</h2>
        <button className="text-button" onClick={refresh}>
          Refresh shared snapshots
        </button>
      </div>
      <p role="status" className="hint">
        {status}
      </p>
      {pending.length > 0 && (
        <>
          <h3>Payments awaiting your confirmation</h3>
          {pending.map(({ room, payment }) => (
            <button
              className="card row full"
              key={payment.id}
              onClick={() => onOpen(room.room.id)}
            >
              <span>
                {
                  room.members.find((m) => m.user_id === payment.debtor_id)
                    ?.display_name
                }{" "}
                marked a payment as sent · {room.room.name}
              </span>
              <strong>{format(payment.amount, room.room.currency)} →</strong>
            </button>
          ))}
        </>
      )}
      <div className="session-list">
        {rooms.slice(0, 6).map((s) => (
          <button
            className="card row full"
            key={s.room.id}
            onClick={() => onOpen(s.room.id)}
          >
            <span>
              {s.room.name} ·{" "}
              {s.room.mode === "travel"
                ? "Trip"
                : s.room.mode === "group"
                  ? "Group"
                  : "Bill room"}
            </span>
            <span>{s.members.filter((m) => m.active).length} members →</span>
          </button>
        ))}
      </div>
    </section>
  );
}
