import Decimal from "decimal.js";
import { id, currencies, type Currency } from "../domain/model";
import { money, inputMoney } from "../calculations/engine";
import type {
  OCRResult,
  OCRLine,
  ParsedReceipt,
  ReceiptItem,
  Reconciliation,
} from "./model";

// Use line geometry to reconstruct right-aligned price columns, retaining the source.
export function layoutLines(result: OCRResult): OCRLine[] {
  if (!result.lines.length)
    return result.text
      .split(/\r?\n/)
      .filter((s) => s.trim())
      .map((text) => ({ text, confidence: result.confidence }));
  const sorted = [...result.lines].sort((a, b) =>
    a.bbox && b.bbox ? a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0 : 0,
  );
  const rows: OCRLine[][] = [];
  for (const line of sorted) {
    const row = rows.at(-1),
      anchor = row?.[0];
    if (
      anchor?.bbox &&
      line.bbox &&
      Math.abs(
        (anchor.bbox.y0 + anchor.bbox.y1) / 2 -
          (line.bbox.y0 + line.bbox.y1) / 2,
      ) <
        Math.min(anchor.bbox.y1 - anchor.bbox.y0, line.bbox.y1 - line.bbox.y0) *
          0.55
    )
      row!.push(line);
    else rows.push([line]);
  }
  return rows.map((row) => {
    const ordered = row.sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0));
    if (ordered.length === 1) return ordered[0];
    return {
      text: ordered.map((l) => l.text.trim()).join(" "),
      confidence: Math.min(...ordered.map((l) => l.confidence)),
      bbox: {
        x0: Math.min(...ordered.map((l) => l.bbox!.x0)),
        y0: Math.min(...ordered.map((l) => l.bbox!.y0)),
        x1: Math.max(...ordered.map((l) => l.bbox!.x1)),
        y1: Math.max(...ordered.map((l) => l.bbox!.y1)),
      },
    };
  });
}
const amountPattern = /(?:RM\s*|MYR\s*|\$\s*)?(-?\d[\d,]*\.\d{2,3}|-?\d+)\s*$/i;
const tender =
  /^(cash|change|balance|tendered|visa|mastercard|credit card|debit card|amount paid|payment|paid|rounding change)\b/i;
const meta =
  /^(tel|phone|fax|address|table|pax|cashier|receipt|invoice|bill no|order no|gst no|sst no|tax id|thank|www\.|https?:|reg no|business|registration)\b/i;
export function parseReceipt(
  result: OCRResult,
  fallback: Currency = "MYR",
): ParsedReceipt {
  const lines = layoutLines(result);
  const detected = Object.keys(currencies).find((c) =>
    new RegExp(`\\b${c}\\b`).test(result.text.toUpperCase()),
  ) as Currency | undefined;
  const currency =
    detected ??
    (/\bRM\s*\d|RM\b/.test(result.text.toUpperCase()) ? "MYR" : fallback);
  const out: ParsedReceipt = {
    id: id(),
    merchant: "",
    date: "",
    time: "",
    currency,
    currencyIdentified: !!detected || /\bRM\b/.test(result.text),
    items: [],
    charges: [],
    subtotal: "",
    printedTotal: "",
    rawText: result.text,
    warnings: [],
  };
  let wrapped: OCRLine | null = null;
  for (const line of lines) {
    const text = line.text.trim().replace(/\s+/g, " ");
    if (!text) continue;
    const date = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (date || iso) {
      out.date = iso
        ? iso[0]
        : `${date![3]}-${date![2].padStart(2, "0")}-${date![1].padStart(2, "0")}`;
      wrapped = null;
      continue;
    }
    const time = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?\b/i);
    if (time) {
      out.time = time[0];
      wrapped = null;
      continue;
    }
    if (
      tender.test(text) ||
      meta.test(text) ||
      /^[\d\s+()\-]+$/.test(text) ||
      /^[-=*_.]+$/.test(text)
    ) {
      wrapped = null;
      continue;
    }
    const matched = text.match(amountPattern);
    if (!matched) {
      if (!out.merchant && /[a-z]/i.test(text)) out.merchant = text;
      else if (
        /[a-z]/i.test(text) &&
        !/subtotal|total|tax|discount|service/i.test(text)
      )
        wrapped = line;
      continue;
    }
    const rawAmount = matched[1].replace(/,/g, "");
    let label = text
      .slice(0, matched.index)
      .trim()
      .replace(/[:.]+$/, "");
    if (!label) {
      out.warnings.push(`Amount without a description: ${text}`);
      continue;
    }
    // A printed percentage is descriptive; the final printed amount is authoritative.
    if (
      /^(grand\s*total|total\s*(amount|due|payable)?|amount\s*due|nett?\s*total)\b/i.test(
        label,
      )
    ) {
      out.printedTotal = rawAmount;
      wrapped = null;
      continue;
    }
    if (/^sub\s*-?\s*total\b/i.test(label)) {
      out.subtotal = rawAmount;
      wrapped = null;
      continue;
    }
    if (
      /^(sst|gst|service\s*tax|tax|service\s*charge|s\/?c|discount|disc\.?|tip|rounding|round\s*off)\b/i.test(
        label,
      )
    ) {
      const negative =
        rawAmount.startsWith("-") || /^(discount|disc)/i.test(label);
      out.charges.push({
        id: id(),
        name: label,
        kind: "fixed",
        value: rawAmount.replace(/^-/, ""),
        discount: negative,
        allocation: "proportional",
        participants: [],
      });
      wrapped = null;
      continue;
    }
    if (rawAmount.startsWith("-")) {
      out.warnings.push(`Unclassified negative line: ${text}`);
      continue;
    }
    let quantity = 1;
    const leading = label.match(/^(\d+)\s*(?:[xX×]\s*|\s+)(.+)$/);
    const trailing = label.match(/^(.*?)\s+[xX×]\s*(\d+)$/);
    if (leading) {
      quantity = Number(leading[1]);
      label = leading[2];
    } else if (trailing) {
      label = trailing[1];
      quantity = Number(trailing[2]);
    }
    if (wrapped) {
      label = `${wrapped.text.trim()} ${label}`;
      wrapped = null;
    }
    const warnings: string[] = [];
    let price = rawAmount;
    try {
      const total = money(rawAmount, currency);
      if (!Number.isSafeInteger(quantity) || quantity < 1)
        throw Error("Unclear quantity");
      const precedingPrice = label.match(/\s+(?:@\s*)?(\d+\.\d{2,3})$/);
      if (precedingPrice) {
        price = precedingPrice[1];
        label = label.slice(0, precedingPrice.index).trim();
        if (money(price, currency) * quantity !== total)
          warnings.push(
            "Unit price × quantity differs from the printed line total.",
          );
      } else if (total % quantity === 0)
        price = inputMoney(total / quantity, currency);
      else {
        price = "";
        warnings.push(
          "Line total cannot be divided into exact unit prices. Review quantity and price.",
        );
      }
    } catch (e) {
      warnings.push((e as Error).message);
      price = "";
    }
    if (line.confidence < 75)
      warnings.push("Low OCR confidence. Check against the receipt.");
    if (!/\.\d{2,3}$/.test(rawAmount) && currencies[currency] > 0)
      warnings.push("Amount has no decimal separator. Check the price.");
    const item: ReceiptItem = {
      id: id(),
      name: label,
      quantity,
      price,
      notes: "",
      assignments: [],
      lineTotal: rawAmount,
      originalText: text,
      ocrConfidence: line.confidence,
      parserConfidence: warnings.length ? 55 : 90,
      bbox: line.bbox,
      warnings,
    };
    out.items.push(item);
  }
  for (const item of out.items)
    if (
      out.items.filter(
        (x) => x.name === item.name && x.lineTotal === item.lineTotal,
      ).length > 1
    )
      item.warnings.push(
        "Repeated item: keep it only if it appears separately on the receipt.",
      );
  if (!out.currencyIdentified)
    out.warnings.push(`Currency was not identified. Verify ${currency}.`);
  if (!out.printedTotal)
    out.warnings.push(
      "Printed grand total was not found. Enter it from the receipt.",
    );
  if (!out.items.length)
    out.warnings.push(
      "No priced items were found. Add missing items from the receipt.",
    );
  return out;
}
export function reconcileReceipt(r: ParsedReceipt): Reconciliation {
  const warnings: string[] = [];
  try {
    if (!r.items.length || !r.printedTotal)
      return {
        status: "Incomplete",
        expected: null,
        difference: null,
        warnings: ["Items and a printed total are required."],
      };
    let subtotal = 0;
    for (const i of r.items) {
      if (!i.name.trim() || !Number.isSafeInteger(i.quantity) || i.quantity < 1)
        throw Error("Check item names and quantities.");
      subtotal += money(i.price, r.currency) * i.quantity;
      if (!Number.isSafeInteger(subtotal))
        throw Error("Receipt amount is too large.");
    }
    if (r.subtotal && money(r.subtotal, r.currency) !== subtotal)
      warnings.push("Printed subtotal differs from item subtotal.");
    let expected = subtotal;
    for (const c of r.charges) {
      const amount =
        c.kind === "fixed"
          ? money(c.value, r.currency)
          : new Decimal(expected)
              .mul(c.value)
              .div(100)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toNumber();
      expected += c.discount ? -amount : amount;
      if (expected < 0 || !Number.isSafeInteger(expected))
        throw Error("Invalid charges or discount.");
    }
    const difference = money(r.printedTotal, r.currency) - expected;
    return {
      status:
        difference === 0 && !warnings.length ? "Reconciled" : "Needs review",
      expected,
      difference,
      warnings,
    };
  } catch (e) {
    return {
      status: "Incomplete",
      expected: null,
      difference: null,
      warnings: [(e as Error).message],
    };
  }
}
