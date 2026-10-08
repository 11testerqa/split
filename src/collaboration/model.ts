import type { Currency, Expense, Mode, Session } from "../domain/model";
export interface Room {
  id: string;
  owner_id: string;
  name: string;
  mode: Mode;
  currency: Currency;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  locked: boolean;
  expires_at: string;
  created_at: string;
}
export interface Member {
  user_id: string;
  room_id: string;
  display_name: string;
  active: boolean;
  joined_at: string;
}
export interface SharedExpense {
  id: string;
  author_id: string;
  revision: number;
  state: "claiming" | "finalized";
  document: Expense & { printedTotal?: string };
  created_at: string;
}
export interface Claim {
  item_id: string;
  user_id: string;
  weight: number;
  revision: number;
}
export interface SharedItem {
  id: string;
  expense_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  source: Expense["items"][number];
}
export interface Payment {
  id: string;
  debtor_id: string;
  recipient_id: string;
  amount: number;
  status: "outstanding" | "sent" | "confirmed" | "rejected" | "cancelled";
  created_at: string;
  updated_at: string;
}
export interface Activity {
  id: string;
  actor_id: string;
  kind: string;
  entity_id: string;
  created_at: string;
}
export interface Snapshot {
  room: Room;
  members: Member[];
  expenses: SharedExpense[];
  items: SharedItem[];
  claims: Claim[];
  payments: Payment[];
  events: Activity[];
  notifications: { id: string; event_id: string }[];
  balances: Record<string, number>;
}
const colors = ["#dcd4ff", "#c4ebdf", "#ffd5c8", "#d4e3ff", "#ffe6b7"];
export function roomSession(s: Snapshot): Session {
  return {
    id: s.room.id,
    name: s.room.name,
    mode: s.room.mode,
    currency: s.room.currency,
    people: s.members.map((m, i) => ({
      id: m.user_id,
      name: m.display_name,
      color: colors[i % colors.length],
    })),
    expenses: s.expenses
      .filter((e) => e.state === "finalized")
      .map((e) => e.document),
    settlements: s.payments
      .filter((p) => p.status === "confirmed")
      .map((p) => ({
        id: p.id,
        from: p.debtor_id,
        to: p.recipient_id,
        amount: p.amount,
        createdAt: p.updated_at,
      })),
    destination: s.room.destination,
    startDate: s.room.start_date ?? "",
    endDate: s.room.end_date ?? "",
    description: "Shared live room",
    icon: "✦",
    createdAt: s.room.created_at,
    updatedAt: s.room.created_at,
  };
}
