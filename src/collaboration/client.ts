import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { openDB } from "idb";
import type { Snapshot } from "./model";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = !!url && !!key && !url.includes("YOUR-PROJECT");
let instance: SupabaseClient | undefined;
export function backend() {
  if (!configured)
    throw Error(
      "Live rooms require Supabase configuration. Local splits and scanning are available.",
    );
  return (instance ??= createClient(url, key));
}
let identityTask: Promise<string> | undefined;
export function identity(): Promise<string> {
  return (identityTask ??= (async () => {
    const { data, error } = await backend().auth.getSession();
    if (error) throw error;
    if (data.session) return data.session.user.id;
    const result = await backend().auth.signInAnonymously();
    if (result.error) throw result.error;
    if (!result.data.user) throw Error("Guest authentication failed.");
    return result.data.user.id;
  })().finally(() => {
    identityTask = undefined;
  }));
}
export async function rpc<T>(
  name: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await backend().rpc(name, params);
  if (error) throw Error(error.message);
  return data as T;
}
const cache = () =>
  openDB("splitpop-shared-cache", 1, {
    upgrade(d) {
      d.createObjectStore("snapshots");
      d.createObjectStore("drafts");
    },
  });
export async function cacheSnapshot(user: string, s: Snapshot) {
  await (await cache()).put("snapshots", s, `${user}:${s.room.id}`);
}
export async function cachedSnapshot(
  user: string,
  room: string,
): Promise<Snapshot | undefined> {
  return (await cache()).get("snapshots", `${user}:${room}`);
}
export async function forgetSnapshot(user: string, room: string) {
  await (await cache()).delete("snapshots", `${user}:${room}`);
}
export async function localRooms(user: string): Promise<Snapshot[]> {
  const db = await cache();
  const keys = await db.getAllKeys("snapshots");
  const result = await Promise.all(
    keys
      .filter((k) => String(k).startsWith(user + ":"))
      .map((k) => db.get("snapshots", k)),
  );
  return result;
}
export async function saveSharedDraft(
  user: string,
  room: string,
  value: unknown,
) {
  await (await cache()).put("drafts", value, `${user}:${room}`);
}
export async function getSharedDraft(user: string, room: string) {
  return (await cache()).get("drafts", `${user}:${room}`);
}
export async function deleteSharedDraft(user: string, room: string) {
  await (await cache()).delete("drafts", `${user}:${room}`);
}
export function inviteLink(token: string) {
  return `${location.origin}${import.meta.env.BASE_URL}#invite=${token}`;
}
export function inviteToken(value: string) {
  try {
    const fragment = value.startsWith("#")
      ? value.slice(1)
      : value.includes("#")
        ? new URL(value).hash.slice(1)
        : value;
    return (
      new URLSearchParams(fragment).get("invite") ??
      (/^[a-f0-9]{64}$/.test(value) ? value : "")
    );
  } catch {
    return "";
  }
}
