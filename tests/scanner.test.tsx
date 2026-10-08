// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import ReceiptScanner from "../src/ocr/ReceiptScanner";
import { parseReceipt } from "../src/ocr/parser";
const fixture = parseReceipt({
  text: "Cafe\nTea 4.00\nTotal RM5.00",
  confidence: 65,
  lines: [],
});
vi.mock("../src/ocr/drafts", () => ({
  loadReview: vi.fn(async () => structuredClone(fixture)),
  saveReview: vi.fn(async () => {}),
  deleteReview: vi.fn(async () => {}),
}));
vi.mock("../src/ocr/provider", () => ({
  TesseractReceiptProvider: class {
    async dispose() {}
  },
}));
afterEach(cleanup);
it("requires correction and explicit review before confirming a restored receipt draft", async () => {
  const confirm = vi.fn();
  render(
    <ReceiptScanner
      currency="MYR"
      draftKey="test"
      onClose={() => {}}
      onConfirm={confirm}
    />,
  );
  await screen.findByDisplayValue("Tea");
  const button = screen.getByRole("button", { name: "Use reviewed receipt" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Unit price 1"), {
    target: { value: "5.00" },
  });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(confirm.mock.calls[0][0].items[0].originalText).toBe("Tea 4.00");
});
