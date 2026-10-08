import { createWorker, OEM } from "tesseract.js";
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { parseReceipt, reconcileReceipt } from "../src/ocr/parser";
import type { Currency } from "../src/domain/model";
const manifestPath = process.argv[2] ?? "tests/fixtures/ocr-manifest.json";
const output = process.argv[3] ?? "docs/ocr-benchmark.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const worker = await createWorker("eng", OEM.LSTM_ONLY, {
  langPath: "node_modules/@tesseract.js-data/eng/4.0.0_best_int",
  cachePath: "work",
  logger: () => {},
});
await worker.setParameters({ preserve_interword_spaces: "1" });
const results: Record<string, unknown>[] = [];
try {
  for (const receipt of manifest.receipts) {
    if (!receipt.permission || !["synthetic", "real"].includes(receipt.kind))
      throw Error(
        "Every image needs an explicit permission statement and dataset kind.",
      );
    for (const variant of ["original", "contrast"]) {
      const start = performance.now();
      try {
        const image =
          variant === "contrast"
            ? await sharp(receipt.image)
                .grayscale()
                .linear(1.35, -44.8)
                .png()
                .toBuffer()
            : await readFile(receipt.image);
        const { data } = await worker.recognize(
          image,
          {},
          { text: true, blocks: true },
        );
        const parsed = parseReceipt(
          {
            text: data.text,
            confidence: data.confidence,
            lines: (data.blocks ?? []).flatMap((b) =>
              b.paragraphs.flatMap((p) =>
                p.lines.map((l) => ({
                  text: l.text,
                  confidence: l.confidence,
                  bbox: l.bbox,
                })),
              ),
            ),
          },
          receipt.currency as Currency,
        );
        const expected = receipt.items as {
          description: string;
          quantity: number;
          unitPrice: string;
        }[];
        const normalized = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const matching = expected.map((e) => ({
          truth: e,
          found: parsed.items.find(
            (i) => normalized(i.name) === normalized(e.description),
          ),
        }));
        results.push({
          id: receipt.id,
          kind: receipt.kind,
          variant,
          permission: receipt.permission,
          itemRecall: matching.filter((m) => m.found).length / expected.length,
          itemPrecision: parsed.items.length
            ? matching.filter((m) => m.found).length / parsed.items.length
            : 0,
          priceAccuracy:
            matching.filter((m) => m.found?.price === m.truth.unitPrice)
              .length / expected.length,
          quantityAccuracy:
            matching.filter((m) => m.found?.quantity === m.truth.quantity)
              .length / expected.length,
          totalCorrect: parsed.printedTotal === receipt.total,
          reconciled: reconcileReceipt(parsed).status === "Reconciled",
          processingMs: Math.round(performance.now() - start),
          correctionTimeMs: null,
          failed: false,
          estimatedAPICostUSD: 0,
          recognizedText: receipt.kind === "synthetic" ? data.text : undefined,
        });
      } catch (e) {
        results.push({
          id: receipt.id,
          kind: receipt.kind,
          variant,
          failed: true,
          processingMs: Math.round(performance.now() - start),
          error: (e as Error).message,
        });
      }
    }
  }
} finally {
  await worker.terminate();
}
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      dataset: manifest.dataset,
      generatedAt: new Date().toISOString(),
      engine: "Tesseract.js local English LSTM",
      results,
      limitations: [
        "Synthetic results do not measure real receipt performance.",
        "Correction time requires observed human review and was not measured.",
        "No cloud adapter or paid API was configured.",
        "Processing time includes recognition and parsing, excludes worker startup.",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${results.length} measured results to ${output}`);
