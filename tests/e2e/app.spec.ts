import { test, expect, type Page } from "@playwright/test";
async function create(page: Page, mode: string, name: string) {
  await page
    .getByRole("button", { name: new RegExp("^" + mode) })
    .first()
    .click();
  await page
    .getByLabel(
      mode === "Travel Split"
        ? "Trip name"
        : mode === "Group Split"
          ? "Group name"
          : "Session name",
      { exact: true },
    )
    .fill(name);
  await page.getByLabel("Participant 2 name").fill("Alice");
  await page
    .getByRole("button", {
      name:
        mode === "Group Split" || mode === "Travel Split"
          ? "Create & start tracking"
          : "Continue to bill",
    })
    .click();
}
async function expense(page: Page, title: string, amount: string) {
  await page.getByLabel("Expense title", { exact: true }).fill(title);
  await page.getByLabel("Bill amount", { exact: true }).fill(amount);
  await page.getByRole("button", { name: "Save & see settlements" }).click();
}
test("equal split, settlement, undo and persistence", async ({ page }) => {
  await page.goto("/");
  await create(page, "Equally Split", "Friday dinner");
  await expense(page, "Pizza", "100.01");
  await expect(
    page.getByText("MYR 50.00", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record actual payment" }).click();
  await expect(page.getByText("Everyone’s all settled!")).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: /Friday dinner.*2 people/ })
    .first()
    .click();
  await page.getByText("Recorded transfer history").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Undo transfer" }).click();
  await expect(
    page.getByRole("button", { name: "Record actual payment" }),
  ).toBeVisible();
});
test("pay your own assigns shared items and validates multiple payers", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Pay Your Own", "Dinner crew");
  await page.getByLabel("Expense title", { exact: true }).fill("Dinner");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Item name", { exact: true }).fill("Pizza");
  await page.getByLabel("Unit price", { exact: true }).fill("40");
  const item = page.locator(".item-card").first();
  await item.getByRole("button", { name: "You", exact: true }).click();
  await item.getByRole("button", { name: "Alice", exact: true }).click();
  await page.getByLabel("Multiple payers / partial contributions").check();
  await page.getByLabel("You paid (MYR)", { exact: true }).fill("30");
  await page.getByLabel("Alice paid (MYR)", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save & see settlements" }).click();
  await expect(page.getByText("Alice").first()).toBeVisible();
  await expect(
    page.getByText("MYR 10.00", { exact: true }).first(),
  ).toBeVisible();
  await page.getByText("See everyone’s share").click();
  await expect(page.getByText("2 × Pizza")).toHaveCount(0);
  await expect(page.getByText(/1 × Pizza/)).toBeVisible();
});
test("group weighted expense and partial settlement", async ({ page }) => {
  await page.goto("/");
  await create(page, "Group Split", "Housemates");
  await page
    .getByRole("button", { name: "Add expense", exact: true })
    .first()
    .click();
  await page.getByLabel("Expense title", { exact: true }).fill("Groceries");
  await page.getByLabel("Bill amount", { exact: true }).fill("90");
  await page.getByLabel("Split method", { exact: true }).selectOption("weight");
  await page.getByLabel("You — weight", { exact: true }).fill("1");
  await page.getByLabel("Alice — weight", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save & see settlements" }).click();
  await page
    .getByLabel("Amount paid by Alice (optional partial)", { exact: true })
    .fill("10");
  await page.getByRole("button", { name: "Record actual payment" }).click();
  await expect(
    page.getByText("MYR 50.00", { exact: true }).first(),
  ).toBeVisible();
});
test("travel manual conversion and subset shares", async ({ page }) => {
  await page.goto("/");
  await create(page, "Travel Split", "Kyoto weekend");
  await page
    .getByRole("button", { name: "Add expense", exact: true })
    .first()
    .click();
  await page.getByLabel("Expense title", { exact: true }).fill("Train");
  await page
    .getByLabel("Expense currency", { exact: true })
    .selectOption("JPY");
  await page.getByLabel("Bill amount", { exact: true }).fill("1000");
  await page
    .getByLabel("Manual rate: 1 JPY = how many MYR?", { exact: true })
    .fill("0.03");
  await page.getByRole("button", { name: "Save & see settlements" }).click();
  await expect(page.getByText(/Manual rate 0.03/)).toBeVisible();
  await expect(page.getByText("Where the adventure went")).toBeVisible();
  await expect(
    page.getByText("MYR 30.00", { exact: true }).first(),
  ).toBeVisible();
});
test("draft resumes, no small-screen overflow, theme and backup import", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Equally Split", "Draft dinner");
  await page
    .getByLabel("Expense title", { exact: true })
    .fill("Unfinished pizza");
  await page.getByLabel("Bill amount", { exact: true }).fill("45");
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Bill amount", { exact: true })).toHaveValue(
    "45",
  );
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .last()
    .click();
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON backup" }).click();
  expect((await downloaded).suggestedFilename()).toBe("splitpop-backup.json");
});
test("ordered charges survive edits without double counting and receipt reconciliation is explicit", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Equally Split", "Tax dinner");
  await page.getByLabel("Expense title", { exact: true }).fill("Dinner");
  await page.getByLabel("Bill amount", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Add charge or discount" }).click();
  await page.getByLabel("Percentage", { exact: true }).fill("10");
  await page
    .getByLabel("Actual receipt total (MYR, optional)", { exact: true })
    .fill("112");
  await expect(page.getByText(/Receipt difference: MYR\s2.00/)).toBeVisible();
  await page.getByRole("button", { name: "Add explicit adjustment" }).click();
  await page.getByRole("button", { name: "Save & see settlements" }).click();
  await expect(
    page.locator(".stat").first().getByText("MYR 112.00", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit expense", exact: true }).click();
  await expect(page.getByLabel("Bill amount", { exact: true })).toHaveValue(
    "100",
  );
  await expect(page.locator(".big-amount")).toHaveText("MYR 112.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.locator(".stat").first().getByText("MYR 112.00", { exact: true }),
  ).toBeVisible();
});
test("rejects invalid split and unbalanced payments", async ({ page }) => {
  await page.goto("/");
  await create(page, "Equally Split", "Validation");
  await page.getByLabel("Expense title", { exact: true }).fill("Dinner");
  await page.getByLabel("Bill amount", { exact: true }).fill("100");
  await page
    .getByLabel("Split method", { exact: true })
    .selectOption("percent");
  await page.getByLabel("You — %", { exact: true }).fill("40");
  await page.getByLabel("Alice — %", { exact: true }).fill("40");
  await expect(
    page.getByText("Percentages must add up to 100%."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save & see settlements" }),
  ).toBeDisabled();
  await page.getByLabel("Alice — %", { exact: true }).fill("60");
  await page.getByLabel("Multiple payers / partial contributions").check();
  await page.getByLabel("You paid (MYR)", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Save & see settlements" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Payment contributions must equal the total.",
  );
});
test("backup restores complete financial data and PDF downloads locally", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Equally Split", "Backup dinner");
  await expense(page, "Lunch", "60");
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF report" }).click();
  expect((await pdfDownload).suggestedFilename()).toBe("splitpop-report.pdf");
  const text = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("splitpop");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return await new Promise<string>((resolve, reject) => {
      const req = db.transaction("state").objectStore("state").get("app");
      req.onsuccess = () => resolve(JSON.stringify(req.result));
      req.onerror = () => reject(req.error);
    });
  });
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .last()
    .click();
  page.once("dialog", (d) => d.accept());
  await page.locator("input[type=file]").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await expect(page.getByText("Backup restored.")).toBeVisible();
  await page
    .getByRole("button", { name: "History", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: /Backup dinner.*2 people/ })
    .first()
    .click();
  await expect(
    page.locator(".stat").first().getByText("MYR 60.00", { exact: true }),
  ).toBeVisible();
});
test("expense deletion is reversible and transfer history survives edit", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Equally Split", "Audit dinner");
  await expense(page, "Pizza", "80");
  await page
    .getByLabel("Amount paid by Alice (optional partial)", { exact: true })
    .fill("10");
  await page.getByRole("button", { name: "Record actual payment" }).click();
  await page.getByRole("button", { name: "Edit expense", exact: true }).click();
  await page.getByLabel("Bill amount", { exact: true }).fill("100");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Recorded transfer history (1)")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Expense deleted.")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pizza", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Recorded transfer history (1)")).toBeVisible();
});

test("home and bill editor pass automated WCAG A/AA checks", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.goto("/");
  await page.getByRole("heading", { name: "What are we splitting?" }).waitFor();
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Toggle dark mode" }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
  await create(page, "Equally Split", "Accessible dinner");
  await page.getByLabel("Expense title", { exact: true }).fill("Dinner");
  await page.getByLabel("Bill amount", { exact: true }).fill("100");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("dashboard, creation and settings have accessible controls", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.goto("/");
  await page.getByRole("button", { name: "Group Split", exact: true }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Access crew");
  await page.getByLabel("Participant 2 name").fill("Alice");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Create & start tracking" }).click();
  await page
    .getByRole("button", { name: "Add expense", exact: true })
    .first()
    .click();
  await expense(page, "Dinner", "60");
  await expect(page.locator(".transfer").first()).toHaveCSS("opacity", "1");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .last()
    .click();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("copy, encoded WhatsApp summary and Web Share fallback work", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await create(page, "Equally Split", "Sharing dinner");
  await expense(page, "Pizza", "80");
  await page.getByRole("button", { name: "Copy summary" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("SplitPop — Sharing dinner");
  expect(copied).toContain("Alice pays You MYR");
  const report = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  expect((await report).suggestedFilename()).toBe("splitpop-summary.txt");
  await context.route("https://wa.me/**", (route) =>
    route.fulfill({ status: 200, body: "Intercepted by local test" }),
  );
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  const shared = await popup;
  await shared.waitForLoadState();
  expect(new URL(shared.url()).searchParams.get("text")).toContain(
    "SplitPop — Sharing dinner",
  );
  await shared.close();
});
