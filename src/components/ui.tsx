import {
  cloneElement,
  isValidElement,
  useId,
  type ReactNode,
  type ReactElement,
} from "react";
import type { Currency, Person } from "../domain/model";
import { currencies } from "../domain/model";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const fieldId = useId();
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, {
            id: fieldId,
          })
        : children}
    </div>
  );
}
export function CurrencySelect({
  value,
  onChange,
  id,
}: {
  id?: string;
  value: Currency;
  onChange: (c: Currency) => void;
}) {
  return (
    <select
      id={id}
      aria-label={id ? undefined : "Currency"}
      value={value}
      onChange={(e) => onChange(e.target.value as Currency)}
    >
      {Object.keys(currencies).map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}
export function Avatar({ person }: { person: Person }) {
  return (
    <span
      aria-hidden="true"
      className="avatar"
      style={{ background: person.color }}
    >
      {person.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
export function Illustration({ kind = "coins" }: { kind?: string }) {
  return (
    <div className={`illustration ${kind}`} aria-hidden="true">
      <div className="orb" />
      <div className="receipt">
        <span>SplitPop</span>
        <i />
        <i />
        <i />
        <b>✓</b>
      </div>
      <div className="coin one">✦</div>
      <div className="coin two">✦</div>
      <div className="coin three">✦</div>
      <div className="spark s1">✦</div>
      <div className="spark s2">✧</div>
    </div>
  );
}
