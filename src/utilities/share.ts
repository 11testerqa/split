import {
  allocate,
  balances,
  bill,
  format,
  money,
  transfers,
} from "../calculations/engine";
import type { Session, Expense } from "../domain/model";

function expenseReport(e: Expense, s: Session) {
  const name = (id: string) =>
    s.people.find((p) => p.id === id)?.name || "Unknown";
  const lines = [
    `${e.date} · ${e.category} · ${e.title}: ${format(e.amount, e.currency)}`,
  ];
  if (e.exchange)
    lines.push(
      `Converted: ${format(e.baseAmount, s.currency)} · manual rate ${e.exchange.rate} · snapshot ${e.exchange.capturedAt}`,
    );
  if (e.inputAmount)
    lines.push(`Entered amount: ${e.inputAmount} ${e.currency}`);
  if (e.split)
    lines.push(
      `Split: ${e.split.method}${
        Object.keys(e.split.values).length
          ? " · " +
            Object.entries(e.split.values)
              .map(([p, v]) => `${name(p)}: ${v}`)
              .join(", ")
          : ""
      }`,
    );
  for (const item of e.items)
    lines.push(
      `${item.quantity} x ${item.name}: ${item.price} ${e.currency} each · ${item.assignments.map((a) => `${name(a.personId)} weight ${a.weight}`).join(", ")}${item.notes ? " · " + item.notes : ""}`,
    );
  if (e.participantIds && e.split && e.inputAmount !== undefined) {
    const initial =
      s.mode === "own"
        ? undefined
        : allocate(
            money(e.inputAmount, e.currency),
            e.participantIds,
            e.split,
            e.currency,
          );
    for (const line of bill(
      e.items,
      e.charges,
      e.participantIds,
      e.currency,
      initial,
    ).lines)
      lines.push(
        `${line.name}: ${format(line.amount, e.currency)} · ${Object.entries(
          line.shares,
        )
          .map(([p, v]) => `${name(p)} ${format(v, e.currency)}`)
          .join(", ")}`,
      );
  }
  lines.push(
    "Final shares: " +
      Object.entries(e.allocations)
        .map(([p, v]) => `${name(p)} ${format(v, s.currency)}`)
        .join(", "),
  );
  lines.push(
    "Paid: " +
      e.payments
        .map((p) => `${name(p.personId)} ${format(p.amount, s.currency)}`)
        .join(", "),
  );
  if (e.notes) lines.push("Notes: " + e.notes);
  return lines.join("\n");
}
export function summary(s: Session, detailed = false) {
  const name = (id: string) =>
    s.people.find((p) => p.id === id)?.name || "Unknown";
  const net = balances(s);
  const lines = [
    `SplitPop — ${s.name}`,
    `Total: ${format(
      s.expenses.reduce((a, e) => a + e.baseAmount, 0),
      s.currency,
    )}`,
    ...s.people.map(
      (p) =>
        `${p.name}: ${format(
          s.expenses.reduce((a, e) => a + (e.allocations[p.id] || 0), 0),
          s.currency,
        )} allocated · ${net[p.id] > 0 ? "gets back " + format(net[p.id], s.currency) : net[p.id] < 0 ? "owes " + format(-net[p.id], s.currency) : "settled"}`,
    ),
    "",
    "Settlement suggestions:",
    ...transfers(net).map(
      (t) =>
        `${name(t.from)} pays ${name(t.to)} ${format(t.amount, s.currency)}`,
    ),
  ];
  if (detailed)
    lines.push(
      "",
      "Expenses:",
      ...s.expenses.map((e) => expenseReport(e, s)),
      "",
      "Recorded transfers:",
      ...s.settlements.map(
        (t) =>
          `${name(t.from)} paid ${name(t.to)} ${format(t.amount, s.currency)} · ${t.createdAt}`,
      ),
    );
  lines.push("", "Suggested transfers are not confirmed payments.");
  return lines.join("\n");
}
export function download(
  text: string,
  name: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function pdf(s: Session) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const { default: fontUrl } =
    await import("../assets/OpenSans-Regular.ttf?url");
  const response = await fetch(fontUrl);
  if (!response.ok) throw Error("The report font could not be loaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  doc.addFileToVFS("OpenSans.ttf", btoa(binary));
  doc.addFont("OpenSans.ttf", "OpenSans", "normal");
  doc.setFont("OpenSans");
  doc.setFontSize(11);
  let y = 20;
  for (const line of doc.splitTextToSize(
    summary(s, true).replace(/\p{Extended_Pictographic}/gu, ""),
    175,
  )) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, 15, y);
    y += 7;
  }
  doc.save("splitpop-report.pdf");
}

export function printSummary(s: Session) {
  const w = window.open("", "_blank");
  if (!w) throw Error("The browser blocked the print window.");
  w.document.title = `SplitPop — ${s.name}`;
  const pre = w.document.createElement("pre");
  pre.style.cssText =
    "white-space:pre-wrap;font:14px/1.6 system-ui;margin:32px";
  pre.textContent = summary(s, true);
  w.document.body.append(pre);
  w.document.close();
  w.focus();
  w.print();
}
