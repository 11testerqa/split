import type { Currency, Charge, ExpenseItem } from "../domain/model";
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OCRLine {
  text: string;
  confidence: number;
  bbox?: Box;
}
export interface OCRResult {
  text: string;
  confidence: number;
  lines: OCRLine[];
}
export type ScanStage =
  | "Preparing image"
  | "Reading receipt"
  | "Extracting items"
  | "Checking totals"
  | "Ready for review";
export interface ReceiptOCRProvider {
  recognize(
    image: Blob,
    options: {
      signal: AbortSignal;
      progress: (stage: ScanStage, progress?: number) => void;
    },
  ): Promise<OCRResult>;
  dispose(): Promise<void>;
}
export interface ReceiptItem extends ExpenseItem {
  originalText: string;
  lineTotal: string;
  ocrConfidence: number;
  parserConfidence: number;
  bbox?: Box;
  warnings: string[];
}
export interface ParsedReceipt {
  id: string;
  merchant: string;
  date: string;
  time: string;
  currency: Currency;
  currencyIdentified: boolean;
  items: ReceiptItem[];
  charges: Charge[];
  subtotal: string;
  printedTotal: string;
  rawText: string;
  warnings: string[];
}
export interface Reconciliation {
  status: "Reconciled" | "Needs review" | "Incomplete";
  expected: number | null;
  difference: number | null;
  warnings: string[];
}
