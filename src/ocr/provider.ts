import { createWorker, OEM, type Worker } from "tesseract.js";
import type { OCRResult, ReceiptOCRProvider } from "./model";

export class TesseractReceiptProvider implements ReceiptOCRProvider {
  private worker: Worker | null = null;
  private busy = false;
  private cancelCurrent: (() => void) | undefined;
  private async terminate() {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
  async recognize(
    image: Blob,
    { signal, progress }: Parameters<ReceiptOCRProvider["recognize"]>[1],
  ): Promise<OCRResult> {
    if (this.busy) throw Error("A receipt is already being read.");
    this.busy = true;
    let cancelled = false;
    let rejectAbort!: (reason: Error) => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const abort = () => {
      if (cancelled) return;
      cancelled = true;
      rejectAbort(new DOMException("Cancelled", "AbortError"));
      void this.terminate();
    };
    this.cancelCurrent = abort;
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      progress("Reading receipt");
      if (!this.worker) {
        const initializing = createWorker("eng", OEM.LSTM_ONLY, {
          workerPath: `${import.meta.env.BASE_URL}ocr/worker.min.js`,
          corePath: `${import.meta.env.BASE_URL}ocr/`,
          langPath: `${import.meta.env.BASE_URL}ocr/`,
          workerBlobURL: false,
          // Job rejections are handled below; avoid Tesseract's default global throw.
          errorHandler: () => {},
          logger: (m) => {
            if (!cancelled && m.status === "recognizing text")
              progress("Reading receipt", m.progress);
          },
        }).then(async (worker) => {
          // createWorker exposes its handle after initialization. A cancelled
          // initialization is terminated as soon as that handle becomes available.
          if (cancelled) await worker.terminate();
          return worker;
        });
        const worker = await Promise.race([initializing, interrupted]);
        this.worker = worker;
        await Promise.race([
          worker.setParameters({ preserve_interword_spaces: "1" }),
          interrupted,
        ]);
      }
      const { data } = await Promise.race([
        this.worker.recognize(image, {}, { text: true, blocks: true }),
        interrupted,
      ]);
      signal.throwIfAborted();
      return {
        text: data.text,
        confidence: data.confidence,
        lines: (data.blocks ?? []).flatMap((block) =>
          block.paragraphs.flatMap((p) =>
            p.lines.map((line) => ({
              text: line.text,
              confidence: line.confidence,
              bbox: line.bbox,
            })),
          ),
        ),
      };
    } catch (e) {
      await this.terminate();
      throw e instanceof Error
        ? e
        : Error(typeof e === "string" ? e : "OCR recognition failed.");
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.cancelCurrent === abort) this.cancelCurrent = undefined;
      this.busy = false;
    }
  }
  async dispose() {
    this.cancelCurrent?.();
    await this.terminate();
  }
}
