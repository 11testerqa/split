import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("actual image OCR, mandatory review, assignments and persisted expense", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Scan a receipt", exact: true })
    .click();
  await page.getByLabel("Session name", { exact: true }).fill("Scanned lunch");
  await page.getByLabel("Participant 2 name").fill("Alice");
  await page.getByRole("button", { name: "Continue to bill" }).click();
  await page
    .getByLabel("Receipt photo")
    .setInputFiles("tests/fixtures/synthetic-receipt.png");
  await page.getByRole("button", { name: "Read this receipt" }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Chicken Rice",
    { timeout: 60000 },
  );
  await expect(page.getByLabel("Quantity 1")).toHaveValue("2");
  await expect(page.getByLabel("Unit price 1")).toHaveValue("18.00");
  await expect(page.getByLabel("Printed grand total")).toHaveValue("67.28");
  await expect(
    page.getByRole("button", { name: "Use reviewed receipt" }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /I checked the items/ }).check();
  await page.getByRole("button", { name: "Item 1 · See source" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const audit = await new AxeBuilder({ page })
    .include(".scanner")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole("button", { name: "Use reviewed receipt" }).click();
  await expect(page.getByLabel("Expense title", { exact: true })).toHaveValue(
    "KOPI HOUSE",
  );
  const items = page
    .locator(".item-card")
    .filter({ has: page.getByLabel("Item name", { exact: true }) });
  await items.nth(0).getByRole("button", { name: "You", exact: true }).click();
  await items
    .nth(1)
    .getByRole("button", { name: "Alice", exact: true })
    .click();
  await page.getByRole("button", { name: "Save & see settlements" }).click();
  await expect(
    page.getByRole("heading", { name: /Scanned lunch/ }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: /Scanned lunch.*2 people/ })
    .first()
    .click();
  await expect(
    page.getByText("MYR 67.28", { exact: true }).first(),
  ).toBeVisible();
});
test("unreadable image recovery and manual entry remain available", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Scan a receipt", exact: true })
    .click();
  await page.getByLabel("Session name", { exact: true }).fill("Recovery");
  await page.getByLabel("Participant 2 name").fill("Alice");
  await page.getByRole("button", { name: "Continue to bill" }).click();
  await page.getByLabel("Receipt photo").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a PNG"),
  });
  await page.getByRole("button", { name: "Read this receipt" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be read");
  await page.getByRole("button", { name: "Close receipt scanner" }).click();
  await expect(
    page.getByRole("button", { name: "Add item", exact: true }),
  ).toBeEnabled();
});
test("review draft survives reload and reduced motion stays readable", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Scan a receipt", exact: true })
    .click();
  await page.getByLabel("Session name", { exact: true }).fill("Review later");
  await page.getByLabel("Participant 2 name").fill("Alice");
  await page.getByRole("button", { name: "Continue to bill" }).click();
  await page
    .getByLabel("Receipt photo")
    .setInputFiles("tests/fixtures/synthetic-receipt.png");
  await page.getByRole("button", { name: "Read this receipt" }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Chicken Rice",
    { timeout: 60000 },
  );
  await page
    .getByLabel("Description 1", { exact: true })
    .fill("Corrected rice");
  await expect(page.getByText("Review saved locally.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Scan a receipt", exact: true })
    .click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Corrected rice",
  );
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("cancelling OCR initialization on a slow connection restores the scanner", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Scan a receipt", exact: true })
    .click();
  await page.getByLabel("Session name", { exact: true }).fill("Cancel scan");
  await page.getByLabel("Participant 2 name").fill("Alice");
  await page.getByRole("button", { name: "Continue to bill" }).click();
  await page.route("**/ocr/eng.traineddata.gz", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue().catch(() => {});
  });
  await page
    .getByLabel("Receipt photo")
    .setInputFiles("tests/fixtures/synthetic-receipt.png");
  await page.getByRole("button", { name: "Read this receipt" }).click();
  await expect(page.locator(".scan-progress")).toContainText("Reading receipt");
  await page.getByRole("button", { name: "Cancel scan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Read this receipt" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Cancel scan", exact: true }),
  ).toHaveCount(0);
});
