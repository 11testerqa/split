import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function create(page: Page, mode: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create a bill room", exact: true })
    .click();
  await page.getByLabel("Your display name").fill("Host");
  await page.getByLabel("Room name").fill("Together lunch");
  await page.getByLabel("Room mode").selectOption(mode);
  await page
    .getByRole("button", { name: "Create live room", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Together lunch", exact: true }),
  ).toBeVisible();
  await page.getByText("Invite & room controls", { exact: true }).click();
  return await page.getByLabel("Shareable room invitation").inputValue();
}
async function join(page: Page, link: string, name = "Alice") {
  await page.goto(link);
  await page.getByLabel("Your display name").fill(name);
  await page
    .getByRole("button", { name: "Join live room", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Together lunch", exact: true }),
  ).toBeVisible();
}
async function addExpense(page: Page, title: string, amount: string) {
  await page
    .getByRole("button", { name: "Add shared expense", exact: true })
    .click();
  await page.getByLabel("Expense title", { exact: true }).fill(title);
  await page.getByLabel("Bill amount", { exact: true }).fill(amount);
  await page
    .getByRole("button", { name: "Save & see settlements", exact: true })
    .click();
  await expect(
    page.getByText(`${title} ·`, { exact: false }).first(),
  ).toBeVisible();
}
test("two authenticated sessions add expenses, report a partial repayment and recipient confirms", async ({
  page,
  browser,
}) => {
  const link = await create(page, "group");
  const ctx = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
  });
  const alice = await ctx.newPage();
  try {
    await join(alice, link);
    await page
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    await addExpense(page, "Lunch", "40");
    await alice
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    await expect(
      alice.getByRole("button", { name: "I've paid", exact: true }),
    ).toBeVisible();
    await alice.getByLabel("Repayment to Host (optional partial)").fill("5");
    await alice.getByRole("button", { name: "I've paid", exact: true }).click();
    await expect(
      alice.getByText("Marked as sent · awaiting recipient confirmation"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page
      .getByRole("button", { name: "Confirm received", exact: true })
      .click();
    await expect(
      page.getByText("Confirmed received", { exact: true }),
    ).toBeVisible();
    await alice
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    await expect(
      alice.getByText("Confirmed received", { exact: true }),
    ).toBeVisible();
    await addExpense(alice, "Dessert", "10");
    await page
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    await expect(
      page.getByText("Dessert ·", { exact: false }).first(),
    ).toBeVisible();
    await alice.reload();
    await alice
      .getByRole("button", { name: "Create a bill room", exact: true })
      .click();
    await alice
      .getByRole("button", { name: /Together lunch.*members/ })
      .click();
    await expect(
      alice.getByText("Confirmed received", { exact: true }),
    ).toBeVisible();
  } finally {
    await ctx.close();
  }
});
test("scan, invite, simultaneous shared claims, finalize and confirm complete repayment", async ({
  page,
  browser,
}) => {
  const link = await create(page, "own");
  const ctx = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
  });
  const alice = await ctx.newPage();
  try {
    await join(alice, link);
    await page
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Scan a receipt", exact: true })
      .click();
    await page
      .getByLabel("Receipt photo")
      .setInputFiles("tests/fixtures/synthetic-receipt.png");
    await page.getByRole("button", { name: "Read this receipt" }).click();
    await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
      "Chicken Rice",
      { timeout: 60000 },
    );
    await page.getByRole("checkbox", { name: /I checked the items/ }).check();
    await page.getByRole("button", { name: "Use reviewed receipt" }).click();
    await expect(
      page.getByText("Claim my item", { exact: true }).first(),
    ).toBeVisible();
    await alice
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    await Promise.all([
      page
        .getByRole("button", { name: "Claim my item", exact: true })
        .first()
        .click(),
      alice
        .getByRole("button", { name: "Claim my item", exact: true })
        .first()
        .click(),
    ]);
    await page
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    await expect(page.getByText("2 sharing", { exact: false })).toBeVisible();
    await page
      .getByRole("button", { name: "Claim my item", exact: true })
      .click();
    await page
      .getByText("Record restaurant payment & finalize", { exact: true })
      .click();
    await page.getByLabel("Host restaurant contribution").fill("67.28");
    await page
      .getByRole("button", { name: "Finalize bill & calculate repayments" })
      .click();
    await alice
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    await alice.getByRole("button", { name: "I've paid", exact: true }).click();
    await page
      .getByRole("button", { name: "Refresh room", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm received", exact: true })
      .click();
    await expect(
      page.getByText("Everyone is settled. Keep the fun! ✦"),
    ).toBeVisible();
  } finally {
    await ctx.close();
  }
});
test("failed shared writes retain a local draft and explicit retry", async ({
  page,
}) => {
  await create(page, "group");
  await page
    .getByRole("button", { name: "Add shared expense", exact: true })
    .click();
  await page.getByLabel("Expense title", { exact: true }).fill("Offline lunch");
  await page.getByLabel("Bill amount", { exact: true }).fill("20");
  await page.route("**/rest/v1/rpc/save_shared_expense", (route) =>
    route.abort("failed"),
  );
  await page
    .getByRole("button", { name: "Save & see settlements", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("not been confirmed");
  await expect(page.getByLabel("Expense title", { exact: true })).toHaveValue(
    "Offline lunch",
  );
  await page.getByRole("button", { name: "Refresh room", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not been confirmed");
  await page.unroute("**/rest/v1/rpc/save_shared_expense");
  await page
    .getByRole("button", { name: "Save & see settlements", exact: true })
    .click();
  await expect(
    page.getByText("Offline lunch ·", { exact: false }).first(),
  ).toBeVisible();
});
