import type { Mode } from "./model";
export const modes = [
  {
    id: "own" as Mode,
    title: "Pay Your Own",
    text: "Your order. Your share.",
    detail: "Everyone pays for what they ordered.",
    color: "violet",
    emoji: "🧾",
  },
  {
    id: "equal" as Mode,
    title: "Equally Split",
    text: "Good times, equal shares.",
    detail: "One bill, divided fairly in seconds.",
    color: "mint",
    emoji: "🍕",
  },
  {
    id: "group" as Mode,
    title: "Group Split",
    text: "Together, all squared up.",
    detail: "Keep everyday shared expenses in balance.",
    color: "peach",
    emoji: "👥",
  },
  {
    id: "travel" as Mode,
    title: "Travel Split",
    text: "More adventures. Less math.",
    detail: "One trip. Many currencies. Zero confusion.",
    color: "blue",
    emoji: "🧳",
  },
];
export const colors = ["#e5dcff", "#c5eedc", "#ffdbcd", "#cfe4fa", "#ffe8aa"];
