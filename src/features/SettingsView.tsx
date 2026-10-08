import { Download, Trash2 } from "lucide-react";
import type { Data } from "../domain/model";
import { CurrencySelect, Field } from "../components/ui";
import { download } from "../utilities/share";
export default function SettingsView({
  data,
  onChange,
  onNotice,
  onReset,
  onImport,
}: {
  data: Data;
  onChange: (d: Data) => void;
  onNotice: (s: string) => void;
  onReset: () => Promise<void>;
  onImport: (raw: unknown) => Promise<void>;
}) {
  return (
    <section className="narrow">
      <div className="page-title">
        <div>
          <p className="eyebrow">MAKE YOURSELF AT HOME</p>
          <h1>Your space, your way.</h1>
          <p>Private by design. Yours to keep.</p>
        </div>
      </div>
      <div className="card">
        <h2>Look & feel</h2>
        <Field label="Theme">
          <select
            value={data.theme}
            onChange={(e) =>
              onChange({ ...data, theme: e.target.value as Data["theme"] })
            }
          >
            <option value="system">Follow device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>
        <Field label="Default currency">
          <CurrencySelect
            value={data.currency}
            onChange={(currency) => onChange({ ...data, currency })}
          />
        </Field>
        <div className="divider" />
        <h2>Your data stays with you.</h2>
        <p>
          SplitPop stores your sessions, people, expenses, and settings in this
          browser’s IndexedDB. Nothing is sent to a server. Data does not sync
          between devices. Clearing browser storage can delete it; keep a
          backup.
        </p>
        <div className="share-buttons">
          <button
            className="secondary"
            onClick={() =>
              download(JSON.stringify(data, null, 2), "splitpop-backup.json")
            }
          >
            <Download size={17} /> Export JSON backup
          </button>
          <label className="secondary import-label">
            Import JSON backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 10_000_000) {
                  onNotice("Choose a backup smaller than 10 MB.");
                  return;
                }
                try {
                  await onImport(JSON.parse(await file.text()));
                } catch {
                  onNotice("That file is not a valid JSON backup.");
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="divider" />
        <h2>Fresh start</h2>
        <p>
          Deleting local data removes every saved bill, group, trip, and draft
          from this browser.
        </p>
        <button
          className="secondary danger"
          onClick={() =>
            onReset().catch(() =>
              onNotice("Local data could not be deleted. Try again."),
            )
          }
        >
          <Trash2 size={17} /> Delete all local data
        </button>
      </div>
      <div className="card spaced">
        <h3>A few fair-share rules</h3>
        <p>
          Remainder units go to the largest fractional shares, with participant
          order breaking ties. Charges apply in listed order; percentage charges
          use the running subtotal. Exchange rates are manual snapshots.
          Expenses must be fully funded before saving. Transfers are recorded
          only when you confirm payment.
        </p>
      </div>
    </section>
  );
}
