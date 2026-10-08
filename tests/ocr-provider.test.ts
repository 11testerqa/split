import { it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => ({
  createWorker: mocks.createWorker,
  OEM: { LSTM_ONLY: 1 },
}));
import { TesseractReceiptProvider } from "../src/ocr/provider";
it("cancels a running recognition immediately and permits a fresh worker on retry", async () => {
  const terminate = vi.fn(async () => {}),
    recognize = vi.fn(() => new Promise(() => {}));
  mocks.createWorker.mockResolvedValueOnce({
    terminate,
    recognize,
    setParameters: vi.fn(async () => {}),
  });
  const provider = new TesseractReceiptProvider(),
    controller = new AbortController();
  const result = provider.recognize(new Blob(), {
    signal: controller.signal,
    progress: () => {},
  });
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(recognize).toHaveBeenCalledOnce());
  controller.abort();
  await rejected;
  expect(terminate).toHaveBeenCalledOnce();
  mocks.createWorker.mockResolvedValueOnce({
    terminate: vi.fn(async () => {}),
    setParameters: vi.fn(async () => {}),
    recognize: vi.fn(async () => ({
      data: { text: "actual response", confidence: 90, blocks: [] },
    })),
  });
  const retried = await provider.recognize(new Blob(), {
    signal: new AbortController().signal,
    progress: () => {},
  });
  expect(retried.text).toBe("actual response");
  await provider.dispose();
});
it("cancels initialization without waiting for language loading and releases its late worker", async () => {
  let ready!: (worker: unknown) => void;
  const terminate = vi.fn(async () => {});
  mocks.createWorker.mockReturnValueOnce(
    new Promise((resolve) => {
      ready = resolve;
    }),
  );
  const controller = new AbortController(),
    provider = new TesseractReceiptProvider();
  const pending = provider.recognize(new Blob(), {
    signal: controller.signal,
    progress: () => {},
  });
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  ready({ terminate });
  await vi.waitFor(() => expect(terminate).toHaveBeenCalledOnce());
});
