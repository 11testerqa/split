import { useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCw, Trash2, X, Plus } from "lucide-react";
import { id, type Currency } from "../domain/model";
import { format } from "../calculations/engine";
import { Field, CurrencySelect } from "../components/ui";
import { TesseractReceiptProvider } from "./provider";
import { prepareImage, type Crop } from "./preprocess";
import { parseReceipt, reconcileReceipt } from "./parser";
import { loadReview, saveReview, deleteReview } from "./drafts";
import type { ParsedReceipt, ScanStage, ReceiptItem } from "./model";
export default function ReceiptScanner({
  draftKey,
  currency,
  onConfirm,
  onClose,
}: {
  draftKey: string;
  currency: Currency;
  onConfirm: (r: ParsedReceipt) => void | Promise<boolean | void>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  const [rotation, setRotation] = useState(0),
    [crop, setCrop] = useState<Crop>({ left: 0, top: 0, right: 0, bottom: 0 });
  const [variant, setVariant] = useState<"original" | "contrast">("original");
  const [stage, setStage] = useState<ScanStage | null>(null),
    [progress, setProgress] = useState<number | undefined>();
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null),
    [error, setError] = useState(""),
    [quality, setQuality] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [ack, setAck] = useState(false),
    [selected, setSelected] = useState<ReceiptItem | null>(null),
    [size, setSize] = useState({ width: 0, height: 0 });
  const [localStatus, setLocalStatus] = useState("");
  const controller = useRef<AbortController | null>(null),
    provider = useRef(new TesseractReceiptProvider()),
    queue = useRef(Promise.resolve());
  const mounted = useRef(true);
  const sourceDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    mounted.current = true;
    let valid = true;
    loadReview(draftKey)
      .then((r) => {
        if (valid && r) setReceipt(r);
      })
      .catch(() => setLocalStatus("Local review could not be read."));
    return () => {
      valid = false;
      mounted.current = false;
      controller.current?.abort();
      void provider.current.dispose();
    };
  }, [draftKey]);
  useEffect(() => {
    if (!receipt) return;
    setLocalStatus("Saving review locally…");
    queue.current = queue.current
      .then(() => saveReview(draftKey, receipt))
      .then(() => {
        if (mounted.current) setLocalStatus("Review saved locally.");
      })
      .catch(() => {
        if (mounted.current)
          setLocalStatus("Local save failed. Keep this screen open.");
      });
  }, [receipt, draftKey]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const busy = stage !== null && stage !== "Ready for review";
  const reconciliation = receipt ? reconcileReceipt(receipt) : null;
  function patch(p: Partial<ParsedReceipt>) {
    if (receipt) {
      setReceipt({ ...receipt, ...p });
      setAck(false);
    }
  }
  function itemPatch(itemId: string, p: Partial<ReceiptItem>) {
    if (receipt)
      patch({
        items: receipt.items.map((i) => (i.id === itemId ? { ...i, ...p } : i)),
      });
  }
  async function read() {
    if (!file) return;
    setError("");
    setAck(false);
    setProgress(undefined);
    setStage("Preparing image");
    const c = new AbortController();
    controller.current = c;
    try {
      const prepared = await prepareImage(
        file,
        rotation,
        crop,
        variant,
        c.signal,
      );
      setQuality(prepared.warnings);
      setPreview(URL.createObjectURL(prepared.blob));
      setSize({ width: prepared.width, height: prepared.height });
      const recognized = await provider.current.recognize(prepared.blob, {
        signal: c.signal,
        progress: (s, p) => {
          if (mounted.current) {
            setStage(s);
            setProgress(p);
          }
        },
      });
      setStage("Extracting items");
      const parsed = parseReceipt(recognized, currency);
      setStage("Checking totals");
      reconcileReceipt(parsed);
      setReceipt(parsed);
      setStage("Ready for review");
    } catch (e) {
      if (mounted.current) {
        setStage(null);
        if ((e as Error).name !== "AbortError")
          setError(
            `Receipt could not be read: ${(e as Error).message}. Try another photo or add items manually.`,
          );
      }
    } finally {
      controller.current = null;
    }
  }
  return (
    <section className="scanner card" aria-label="Receipt scanner">
      <dialog
        ref={sourceDialog}
        className="source-sheet"
        aria-labelledby="source-sheet-title"
        onClose={() => setSelected(null)}
      >
        <div className="row">
          <h3 id="source-sheet-title">Receipt source</h3>
          <button
            className="icon-button"
            aria-label="Close receipt source"
            onClick={() => sourceDialog.current?.close()}
          >
            <X />
          </button>
        </div>
        <p>{selected?.name}</p>
        <blockquote>{selected?.originalText}</blockquote>
        {preview ? (
          <div className="receipt-preview">
            <img
              src={preview}
              alt="Original receipt region for the selected item"
            />
            {selected?.bbox && size.width > 0 && (
              <div
                className="receipt-region"
                style={{
                  left: `${(selected.bbox.x0 / size.width) * 100}%`,
                  top: `${(selected.bbox.y0 / size.height) * 100}%`,
                  width: `${((selected.bbox.x1 - selected.bbox.x0) / size.width) * 100}%`,
                  height: `${((selected.bbox.y1 - selected.bbox.y0) / size.height) * 100}%`,
                }}
              />
            )}
          </div>
        ) : (
          <p className="hint">
            The source text was saved. The photo was released for privacy;
            reselect it to inspect image regions.
          </p>
        )}
      </dialog>
      <div className="row">
        <div>
          <p className="eyebrow">SCAN • CHECK • SPLIT</p>
          <h2>Let the receipt do the typing.</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close receipt scanner"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <p className="hint">
        OCR runs on this device. Photos are kept in memory only and are never
        uploaded. Use bright, even light, sharp focus, and show the whole
        receipt.
      </p>
      {!receipt && (
        <>
          <Field label="Receipt photo">
            <input
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (
                  !["image/jpeg", "image/png"].includes(f.type) ||
                  f.size > 20 * 1024 * 1024
                ) {
                  setError("Choose a JPEG or PNG under 20 MB.");
                  return;
                }
                setFile(f);
                setPreview(URL.createObjectURL(f));
                setRotation(0);
                setCrop({ left: 0, top: 0, right: 0, bottom: 0 });
                setError("");
              }}
            />
          </Field>
          <p className="hint">
            Your browser may offer the camera or gallery. If camera access is
            denied, choose an existing photo.
          </p>
        </>
      )}
      {!receipt && !busy && (
        <button
          className="text-button"
          onClick={() => {
            const manual = parseReceipt(
              { text: "", confidence: 0, lines: [] },
              currency,
            );
            setReceipt({
              ...manual,
              currencyIdentified: true,
              warnings: [
                "Entered manually. Copy the items, charges and total from your receipt.",
              ],
            });
            setStage("Ready for review");
          }}
        >
          Enter receipt manually
        </button>
      )}
      {preview && (
        <div className="receipt-preview">
          <img
            src={preview}
            alt="Receipt to verify"
            style={
              !receipt ? { transform: `rotate(${rotation}deg)` } : undefined
            }
          />
          {selected?.bbox && size.width > 0 && (
            <div
              className="receipt-region"
              style={{
                left: `${(selected.bbox.x0 / size.width) * 100}%`,
                top: `${(selected.bbox.y0 / size.height) * 100}%`,
                width: `${((selected.bbox.x1 - selected.bbox.x0) / size.width) * 100}%`,
                height: `${((selected.bbox.y1 - selected.bbox.y0) / size.height) * 100}%`,
              }}
            />
          )}
        </div>
      )}
      {file && !receipt && (
        <>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setRotation((r) => (r + 90) % 360)}
          >
            <RotateCw size={16} /> Rotate 90°
          </button>
          <details>
            <summary>Crop and image preparation</summary>
            <div className="form-grid">
              {(["left", "top", "right", "bottom"] as const).map((side) => (
                <Field key={side} label={`Crop ${side} (%)`}>
                  <input
                    type="number"
                    min="0"
                    max="45"
                    value={crop[side]}
                    disabled={busy}
                    onChange={(e) =>
                      setCrop({
                        ...crop,
                        [side]: Math.max(
                          0,
                          Math.min(45, Number(e.target.value)),
                        ),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <Field label="Preparation">
              <select
                value={variant}
                disabled={busy}
                onChange={(e) => setVariant(e.target.value as typeof variant)}
              >
                <option value="original">Original color (default)</option>
                <option value="contrast">Grayscale + contrast</option>
              </select>
            </Field>
            <p className="hint">
              Contrast can hurt some receipts. Try the original first.
            </p>
          </details>
          <button className="primary" disabled={busy} onClick={read}>
            <Camera size={18} />
            Read this receipt
          </button>
        </>
      )}
      {busy && (
        <div role="status" className="scan-progress">
          <strong>{stage}</strong>
          {progress !== undefined && (
            <progress
              max="1"
              value={progress}
              aria-label="OCR recognition progress"
            />
          )}
          <button
            className="text-button"
            onClick={() => controller.current?.abort()}
          >
            Cancel scan
          </button>
        </div>
      )}
      {quality.map((q) => (
        <p className="notice" key={q}>
          {q}
        </p>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {receipt && (
        <fieldset disabled={confirming} className="review-fields">
          <div className="form-grid">
            <Field label="Merchant">
              <input
                value={receipt.merchant}
                onChange={(e) => patch({ merchant: e.target.value })}
              />
            </Field>
            <Field label="Receipt date">
              <input
                type="date"
                value={receipt.date}
                onChange={(e) => patch({ date: e.target.value })}
              />
            </Field>
            <Field label="Receipt currency">
              <CurrencySelect
                value={receipt.currency}
                onChange={(c) =>
                  patch({ currency: c, currencyIdentified: true })
                }
              />
            </Field>
            <Field label="Printed grand total">
              <input
                inputMode="decimal"
                value={receipt.printedTotal}
                onChange={(e) => patch({ printedTotal: e.target.value })}
              />
            </Field>
            <Field label="Printed subtotal (optional)">
              <input
                inputMode="decimal"
                value={receipt.subtotal}
                onChange={(e) => patch({ subtotal: e.target.value })}
              />
            </Field>
          </div>
          <div className="notice" role="status">
            <strong>{reconciliation?.status}</strong>
            {reconciliation?.expected !== null && (
              <>
                {" "}
                · Calculated{" "}
                {format(reconciliation!.expected!, receipt.currency)}
              </>
            )}
            {reconciliation?.difference !== null && (
              <>
                {" "}
                · Difference{" "}
                {format(reconciliation!.difference!, receipt.currency)}
              </>
            )}
          </div>
          {[...receipt.warnings, ...(reconciliation?.warnings ?? [])].map(
            (w, i) => (
              <p className="hint" key={i}>
                {w}
              </p>
            ),
          )}
          {receipt.items.map((i, index) => (
            <article className="item-card" key={i.id}>
              <div className="row">
                <button
                  className="text-button"
                  onClick={() => {
                    setSelected(i);
                    sourceDialog.current?.showModal();
                  }}
                >
                  Item {index + 1} · See source
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete extracted item ${index + 1}`}
                  onClick={() =>
                    patch({ items: receipt.items.filter((x) => x.id !== i.id) })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="form-grid">
                <Field label={`Description ${index + 1}`}>
                  <input
                    value={i.name}
                    onChange={(e) => itemPatch(i.id, { name: e.target.value })}
                  />
                </Field>
                <Field label={`Unit price ${index + 1}`}>
                  <input
                    inputMode="decimal"
                    value={i.price}
                    onChange={(e) => itemPatch(i.id, { price: e.target.value })}
                  />
                </Field>
                <Field label={`Quantity ${index + 1}`}>
                  <input
                    type="number"
                    min="1"
                    value={i.quantity}
                    onChange={(e) =>
                      itemPatch(i.id, { quantity: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
              <small>
                OCR confidence {Math.round(i.ocrConfidence)}% · Parser
                confidence {i.parserConfidence}%
              </small>
              {i.warnings.map((w, n) => (
                <p className="hint" key={n}>
                  {w}
                </p>
              ))}
              {index > 0 && (
                <button
                  className="text-button"
                  onClick={() => {
                    const prev = receipt.items[index - 1];
                    patch({
                      items: receipt.items
                        .filter((x) => x.id !== i.id)
                        .map((x) =>
                          x.id === prev.id
                            ? {
                                ...x,
                                name: `${prev.name} ${i.name}`,
                                originalText: `${prev.originalText}\n${i.originalText}`,
                                warnings: [
                                  ...prev.warnings,
                                  "Merged descriptions: verify the retained price and quantity.",
                                ],
                              }
                            : x,
                        ),
                    });
                  }}
                >
                  Merge description with previous item
                </button>
              )}
              {selected?.id === i.id && (
                <blockquote>
                  {i.originalText} · Printed line total: {i.lineTotal}
                </blockquote>
              )}
            </article>
          ))}
          <button
            className="secondary"
            onClick={() =>
              patch({
                items: [
                  ...receipt.items,
                  {
                    id: id(),
                    name: "",
                    price: "",
                    quantity: 1,
                    notes: "",
                    assignments: [],
                    lineTotal: "",
                    originalText: "Added during review",
                    ocrConfidence: 0,
                    parserConfidence: 0,
                    warnings: [],
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            Add missing item
          </button>
          <h3>Charges & discounts</h3>
          {receipt.charges.map((c, index) => (
            <div className="item-card" key={c.id}>
              <div className="form-grid">
                <Field label={`Charge description ${index + 1}`}>
                  <input
                    value={c.name}
                    onChange={(e) =>
                      patch({
                        charges: receipt.charges.map((x) =>
                          x.id === c.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label={`Charge amount ${index + 1}`}>
                  <input
                    inputMode="decimal"
                    value={c.value}
                    onChange={(e) =>
                      patch({
                        charges: receipt.charges.map((x) =>
                          x.id === c.id ? { ...x, value: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label={`Charge type ${index + 1}`}>
                  <select
                    value={c.discount ? "discount" : "charge"}
                    onChange={(e) =>
                      patch({
                        charges: receipt.charges.map((x) =>
                          x.id === c.id
                            ? { ...x, discount: e.target.value === "discount" }
                            : x,
                        ),
                      })
                    }
                  >
                    <option value="charge">Charge</option>
                    <option value="discount">
                      Discount / negative rounding
                    </option>
                  </select>
                </Field>
              </div>
              <button
                className="text-button"
                onClick={() =>
                  patch({
                    charges: receipt.charges.filter((x) => x.id !== c.id),
                  })
                }
              >
                Delete charge
              </button>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() =>
              patch({
                charges: [
                  ...receipt.charges,
                  {
                    id: id(),
                    name: "",
                    kind: "fixed",
                    value: "",
                    discount: false,
                    allocation: "proportional",
                    participants: [],
                  },
                ],
              })
            }
          >
            Add missing charge
          </button>
          <details>
            <summary>Original recognized text</summary>
            <pre className="ocr-text">{receipt.rawText}</pre>
          </details>
          <label className="check">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I checked the items, quantities, charges and total against the
            receipt.
          </label>
          <p className="hint" role="status">
            {localStatus}
          </p>
          <div className="chips">
            <button
              className="primary"
              disabled={
                confirming || !ack || reconciliation?.status !== "Reconciled"
              }
              onClick={async () => {
                setConfirming(true);
                try {
                  await queue.current;
                  const accepted = await onConfirm(receipt);
                  if (accepted !== false) await deleteReview(draftKey);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  if (mounted.current) setConfirming(false);
                }
              }}
            >
              <Check size={18} />
              Use reviewed receipt
            </button>
            <button
              className="secondary"
              onClick={async () => {
                await queue.current;
                await deleteReview(draftKey);
                setReceipt(null);
                setFile(null);
                setPreview("");
                setStage(null);
                setSelected(null);
              }}
            >
              Delete review & retake
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
