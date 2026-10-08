import { describe, it, expect } from "vitest";
import { parseReceipt, reconcileReceipt, layoutLines } from "../src/ocr/parser";
const parse = (text: string, confidence = 95) =>
  parseReceipt({ text, confidence, lines: [] });
describe("Malaysian receipt parsing and reconciliation", () => {
  it("extracts quantity, printed unit price, SST and service while ignoring tender", () => {
    const r = parse(
      "KOPI HOUSE\n08/10/2026\n12:34\n2 x Chicken Rice 18.00 36.00\nNoodles 22.00\nSubtotal 58.00\nS/C 10% 5.80\nSST 6% 3.48\nGrand Total RM67.28\nCash 100.00\nChange 32.72\nBalance 0.00",
    );
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({
      name: "Chicken Rice",
      quantity: 2,
      price: "18.00",
      lineTotal: "36.00",
    });
    expect(r.charges).toHaveLength(2);
    expect(r.date).toBe("2026-10-08");
    expect(reconcileReceipt(r)).toMatchObject({
      status: "Reconciled",
      expected: 6728,
      difference: 0,
    });
  });
  it("does not invent missing amounts or force mismatched totals", () => {
    const r = parse("Cafe\nTea 4.00\nTotal RM10.00");
    expect(reconcileReceipt(r)).toMatchObject({
      status: "Needs review",
      difference: 600,
    });
    expect(r.items[0].price).toBe("4.00");
  });
  it("marks receipts without totals incomplete", () => {
    expect(reconcileReceipt(parse("Cafe\nTea 4.00")).status).toBe("Incomplete");
  });
  it("handles wrapped descriptions and repeated lines with explicit warnings", () => {
    const r = parse(
      "Cafe\nSpecial Chicken\nRice 18.00\nTea 4.00\nTea 4.00\nTotal RM26.00",
    );
    expect(r.items[0].name).toBe("Special Chicken Rice");
    expect(r.items[1].warnings.join()).toMatch(/Repeated/);
    expect(r.items).toHaveLength(3);
  });
  it("keeps recognition and parser confidence separate", () => {
    const r = parse("Cafe\nTea 4.00\nTotal RM4.00", 40);
    expect(r.items[0].ocrConfidence).toBe(40);
    expect(r.items[0].parserConfidence).toBe(55);
    expect(r.items[0].warnings.join()).toMatch(/Low OCR/);
  });
  it("supports fixed discounts, tips and negative rounding exactly", () => {
    const r = parse(
      "Cafe\nCake 10.00\nDisc 1.00\nTip 0.50\nRounding -0.01\nGrand Total RM9.49",
    );
    expect(reconcileReceipt(r)).toMatchObject({
      status: "Reconciled",
      expected: 949,
    });
  });
  it("flags nondivisible unit prices and inconsistent explicit prices", () => {
    const r = parse("Cafe\n3 x Tea 10.00\n2 x Cake 4.00 9.00\nTotal RM19.00");
    expect(r.items[0].price).toBe("");
    expect(r.items[1].warnings.join()).toMatch(/differs/);
    expect(reconcileReceipt(r).status).toBe("Incomplete");
  });
  it("preserves positional metadata and orders spatial lines", () => {
    const r = parseReceipt({
      text: "Cafe\nTea 4.00\nTotal RM4.00",
      confidence: 90,
      lines: [
        {
          text: "Total RM4.00",
          confidence: 90,
          bbox: { x0: 0, y0: 40, x1: 100, y1: 50 },
        },
        {
          text: "Cafe",
          confidence: 90,
          bbox: { x0: 0, y0: 0, x1: 100, y1: 10 },
        },
        {
          text: "Tea 4.00",
          confidence: 80,
          bbox: { x0: 0, y0: 20, x1: 100, y1: 30 },
        },
      ],
    });
    expect(r.items[0].bbox?.y0).toBe(20);
    expect(r.items[0].originalText).toBe("Tea 4.00");
    expect(layoutLines({ text: "", confidence: 0, lines: [] })).toEqual([]);
  });
  it("never permits silent subtotal mismatches", () => {
    const r = parse("Cafe\nTea 4.00\nSubtotal 5.00\nTotal RM4.00");
    expect(reconcileReceipt(r).status).toBe("Needs review");
  });
  it("reconciles corrected values without mutating source text", () => {
    const r = parse("Cafe\nTea 9.00\nTotal RM4.00");
    r.items[0].price = "4.00";
    expect(reconcileReceipt(r).status).toBe("Reconciled");
    expect(r.items[0].originalText).toBe("Tea 9.00");
  });
});
it("reconstructs separate description and price columns by geometry", () => {
  const r = parseReceipt({
    text: "Cafe\nTea 4.00\nTotal RM4.00",
    confidence: 90,
    lines: [
      { text: "Cafe", confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 10 } },
      {
        text: "4.00",
        confidence: 91,
        bbox: { x0: 180, y0: 21, x1: 240, y1: 31 },
      },
      { text: "Tea", confidence: 85, bbox: { x0: 0, y0: 20, x1: 80, y1: 30 } },
      {
        text: "Total RM4.00",
        confidence: 90,
        bbox: { x0: 0, y0: 50, x1: 240, y1: 60 },
      },
    ],
  });
  expect(r.items[0]).toMatchObject({
    name: "Tea",
    price: "4.00",
    ocrConfidence: 85,
  });
  expect(reconcileReceipt(r).status).toBe("Reconciled");
});
