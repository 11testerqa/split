import { openDB } from "idb";
import type { ParsedReceipt } from "./model";
const db = () =>
  openDB("splitpop-receipt-drafts", 1, {
    upgrade(d) {
      d.createObjectStore("reviews");
    },
  });
export async function saveReview(key: string, receipt: ParsedReceipt) {
  await (await db()).put("reviews", receipt, key);
}
export async function loadReview(
  key: string,
): Promise<ParsedReceipt | undefined> {
  return (await db()).get("reviews", key);
}
export async function deleteReview(key: string) {
  await (await db()).delete("reviews", key);
}
