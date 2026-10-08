import { useCallback, useEffect, useRef, useState } from "react";
import {
  backend,
  cacheSnapshot,
  cachedSnapshot,
  forgetSnapshot,
  identity,
  rpc,
} from "./client";
import type { Snapshot } from "./model";
export function useRoom(roomId: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [user, setUser] = useState(""),
    [status, setStatus] = useState("Loading shared room…"),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [online, setOnline] = useState<string[]>([]);
  const alive = useRef(true),
    fetching = useRef(false),
    again = useRef(false),
    currentUser = useRef("");
  const refresh = useCallback(async () => {
    if (fetching.current) {
      again.current = true;
      return;
    }
    fetching.current = true;
    try {
      do {
        again.current = false;
        const s = await rpc<Snapshot>("room_snapshot", { p_room: roomId });
        if (!alive.current) return;
        setSnapshot(s);
        setStatus("Synced");
        setError("");
        await cacheSnapshot(currentUser.current, s).catch(() => {
          if (alive.current)
            setError("Synced, but the local cache could not be saved.");
        });
      } while (again.current);
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        setStatus("Failed to sync — retry");
        if (/access denied/i.test((e as Error).message)) {
          setSnapshot(null);
          void forgetSnapshot(currentUser.current, roomId);
        }
      }
    } finally {
      fetching.current = false;
    }
  }, [roomId]);
  useEffect(() => {
    alive.current = true;
    let valid = true;
    let channel: ReturnType<ReturnType<typeof backend>["channel"]> | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    async function open() {
      try {
        const uid = await identity();
        if (!valid || !alive.current) return;
        currentUser.current = uid;
        setUser(uid);
        const cached = await cachedSnapshot(uid, roomId);
        if (!valid || !alive.current) return;
        if (cached) {
          setSnapshot(cached);
          setStatus("Saved locally — checking server");
        }
        await refresh();
        if (!valid || !alive.current) return;
        let presence: Record<string, { user: string; at: number }[]> = {};
        const updatePresence = () => {
          if (valid && alive.current)
            setOnline(
              Object.values(presence)
                .flat()
                .filter((p) => Date.now() - p.at < 45000)
                .map((p) => p.user),
            );
        };
        channel = backend()
          .channel(`room:${roomId}`, {
            config: { private: true, presence: { key: uid } },
          })
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "activity_events",
              filter: `room_id=eq.${roomId}`,
            },
            () => {
              void refresh();
            },
          )
          .on("presence", { event: "sync" }, () => {
            presence = channel!.presenceState() as typeof presence;
            updatePresence();
          })
          .subscribe((state) => {
            if (!valid || !alive.current) return;
            setConnected(state === "SUBSCRIBED");
            if (state === "SUBSCRIBED") {
              void channel!.track({ user: uid, at: Date.now() });
              void refresh();
            } else {
              setOnline([]);
              if (state !== "CLOSED")
                setStatus("Reconnecting — server confirmation required");
            }
          });
        timer = setInterval(() => {
          if (!valid || !alive.current) return;
          void refresh();
          updatePresence();
          if (channel) void channel.track({ user: uid, at: Date.now() });
        }, 15000);
      } catch (e) {
        if (valid && alive.current) {
          setError((e as Error).message);
          setStatus("Connection failed");
        }
      }
    }
    const offline = () => {
      setConnected(false);
      setOnline([]);
      setStatus("Offline — changes are not synced");
    };
    const reconnect = () => {
      void refresh();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", reconnect);
    void open();
    return () => {
      valid = false;
      alive.current = false;
      if (timer) clearInterval(timer);
      if (channel) void backend().removeChannel(channel);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", reconnect);
    };
  }, [roomId, refresh]);
  return {
    snapshot,
    user,
    status,
    error,
    online: connected ? online : [],
    connected,
    refresh,
    setStatus,
    setError,
  };
}
