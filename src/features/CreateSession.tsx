import { useState } from "react";
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import {
  id,
  type Mode,
  type Data,
  type Person,
  type Session,
} from "../domain/model";
import { modes, colors } from "../domain/presentation";
import { Avatar, CurrencySelect, Field } from "../components/ui";
export default function CreateSession({
  mode,
  data,
  onCreate,
  onBack,
}: {
  mode: Mode;
  data: Data;
  onCreate: (s: Session) => void;
  onBack: () => void;
}) {
  const config = modes.find((m) => m.id === mode)!;
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState(data.currency);
  const [people, setPeople] = useState<Person[]>([
    { id: id(), name: "You", color: colors[0] },
    { id: id(), name: "", color: colors[1] },
  ]);
  const [destination, setDestination] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(config.emoji);
  const [error, setError] = useState("");
  const recent = Array.from(
    new Map(
      data.sessions.flatMap((s) => s.people).map((p) => [p.name, p]),
    ).values(),
  )
    .filter((p) => p.name !== "You")
    .slice(0, 8);
  return (
    <section className="narrow">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={18} /> Back
      </button>
      <div className="page-title">
        <div>
          <p className="eyebrow">{config.title.toUpperCase()}</p>
          <h1>Bring your people.</h1>
          <p>{config.detail}</p>
        </div>
        <span className="mode-art">{icon}</span>
      </div>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (people.some((p) => !p.name.trim())) {
            setError("Give every participant a name.");
            return;
          }
          if (people.length < 1) {
            setError("Add at least one person.");
            return;
          }
          if (
            new Set(people.map((p) => p.name.trim().toLowerCase())).size !==
            people.length
          ) {
            setError("Use different names so everyone is easy to identify.");
            return;
          }
          if (mode === "travel" && start && end && start > end) {
            setError("The end date must be after the start date.");
            return;
          }
          const now = new Date().toISOString();
          onCreate({
            id: id(),
            name:
              name.trim() ||
              `${config.title} · ${new Date().toLocaleDateString()}`,
            mode,
            currency,
            people: people.map((p) => ({ ...p, name: p.name.trim() })),
            expenses: [],
            settlements: [],
            destination,
            startDate: start,
            endDate: end,
            description,
            icon,
            createdAt: now,
            updatedAt: now,
          });
        }}
      >
        <div className="form-grid">
          <Field
            label={
              mode === "travel"
                ? "Trip name"
                : mode === "group"
                  ? "Group name"
                  : "Session name"
            }
          >
            <input
              value={name}
              placeholder={
                mode === "travel"
                  ? "A weekend in Kyoto"
                  : mode === "group"
                    ? "The dinner crew"
                    : "Friday dinner"
              }
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Base currency">
            <CurrencySelect value={currency} onChange={setCurrency} />
          </Field>
        </div>
        {(mode === "group" || mode === "travel") && (
          <>
            <Field label="Group icon">
              <select value={icon} onChange={(e) => setIcon(e.target.value)}>
                {["👥", "🧳", "🍕", "🏡", "🌴", "✨", "☕", "🎉"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Description (optional)">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </>
        )}
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
        <div className="section-heading">
          <h2>Who’s in?</h2>
          <span className="hint">{people.length} people</span>
        </div>
        {people.map((p, i) => (
          <div className="person-editor" key={p.id}>
            <Avatar person={p} />
            <input
              aria-label={`Participant ${i + 1} name`}
              placeholder="Friend’s name"
              value={p.name}
              onChange={(e) =>
                setPeople(
                  people.map((x) =>
                    x.id === p.id ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
            <select
              aria-label={`Participant ${i + 1} color`}
              value={p.color}
              onChange={(e) =>
                setPeople(
                  people.map((x) =>
                    x.id === p.id ? { ...x, color: e.target.value } : x,
                  ),
                )
              }
            >
              {colors.map((c, i) => (
                <option key={c} value={c}>
                  {["Lavender", "Mint", "Peach", "Sky", "Sunshine"][i]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove participant ${i + 1}`}
              onClick={() => setPeople(people.filter((x) => x.id !== p.id))}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
        <button
          className="secondary"
          type="button"
          onClick={() =>
            setPeople([
              ...people,
              {
                id: id(),
                name: "",
                color: colors[people.length % colors.length],
              },
            ])
          }
        >
          <Plus size={17} /> Add person
        </button>
        {recent.length > 0 && (
          <>
            <p className="hint">Or reuse a recent participant</p>
            <div className="chips">
              {recent.map((p) => (
                <button
                  className="person-chip"
                  type="button"
                  key={p.id}
                  onClick={() => setPeople([...people, { ...p, id: id() }])}
                >
                  <Avatar person={p} />
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary full spaced">
          {mode === "group" || mode === "travel"
            ? "Create & start tracking"
            : "Continue to bill"}
          <ArrowRight size={18} />
        </button>
        <p className="hint center">
          No accounts. Just your people and a fair split.
        </p>
      </form>
    </section>
  );
}
