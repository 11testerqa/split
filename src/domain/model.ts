export const currencies = {
  MYR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  SGD: 2,
  THB: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
} as const;
export type Currency = keyof typeof currencies;
export type Mode = "own" | "equal" | "group" | "travel";
export interface Person {
  id: string;
  name: string;
  color: string;
}
export interface SplitRule {
  method: "equal" | "exact" | "percent" | "weight";
  values: Record<string, string>;
}
export interface ItemAssignment {
  personId: string;
  weight: string;
}
export interface ExpenseItem {
  id: string;
  name: string;
  price: string;
  quantity: number;
  notes: string;
  assignments: ItemAssignment[];
}
export interface PaymentContribution {
  personId: string;
  amount: number;
}
export interface Charge {
  id: string;
  name: string;
  kind: "fixed" | "percent";
  value: string;
  discount: boolean;
  allocation: "proportional" | "equal" | "selected";
  participants: string[];
}
export type Discount = Charge & { discount: true };
export interface ExchangeRateSnapshot {
  rate: string;
  originalCurrency: Currency;
  baseCurrency: Currency;
  capturedAt: string;
}
export interface Expense {
  inputAmount?: string;
  split?: SplitRule;
  participantIds?: string[];
  id: string;
  title: string;
  amount: number;
  currency: Currency;
  baseAmount: number;
  exchange?: ExchangeRateSnapshot;
  date: string;
  category: string;
  notes: string;
  allocations: Record<string, number>;
  payments: PaymentContribution[];
  items: ExpenseItem[];
  charges: Charge[];
  createdAt: string;
  updatedAt: string;
}
export interface Settlement {
  id: string;
  from: string;
  to: string;
  amount: number;
  createdAt: string;
}
export interface Session {
  id: string;
  name: string;
  mode: Mode;
  currency: Currency;
  people: Person[];
  expenses: Expense[];
  settlements: Settlement[];
  destination: string;
  startDate: string;
  endDate: string;
  description: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}
export type Group = Session & { mode: "group" };
export type Trip = Session & { mode: "travel" };
export interface Draft {
  expenseId?: string;
  sessionId: string;
  title: string;
  amount: string;
  currency: Currency;
  rate: string;
  date: string;
  category: string;
  notes: string;
  selected: string[];
  split: SplitRule;
  payer: string;
  multiple: boolean;
  contributions: Record<string, string>;
  items: ExpenseItem[];
  charges: Charge[];
  receipt: string;
  editing?: string;
}
export interface Data {
  version: 1;
  sessions: Session[];
  draft: Draft | null;
  theme: "light" | "dark" | "system";
  currency: Currency;
}
export const id = () => crypto.randomUUID();
