import { ArrowUpRight } from "lucide-react";
import type { Session } from "../domain/model";
import { modes } from "../domain/presentation";
import { format } from "../calculations/engine";
export default function SessionList({
  sessions,
  onOpen,
}: {
  sessions: Session[];
  onOpen: (s: Session) => void;
}) {
  return (
    <div className="session-list">
      {sessions.map((s) => (
        <button
          key={s.id}
          className="card session-list-item"
          onClick={() => onOpen(s)}
        >
          <span
            className={`list-icon ${modes.find((m) => m.id === s.mode)?.color}`}
          >
            {s.icon}
          </span>
          <span>
            <strong>{s.name}</strong>
            <small>
              {s.people.length} people · {s.expenses.length} expenses ·{" "}
              {s.currency}
            </small>
          </span>
          <span className="list-total">
            {format(
              s.expenses.reduce((a, e) => a + e.baseAmount, 0),
              s.currency,
            )}
            <ArrowUpRight size={16} />
          </span>
        </button>
      ))}
    </div>
  );
}
