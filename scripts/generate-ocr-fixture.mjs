import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: existsSync("/usr/bin/chromium")
    ? "/usr/bin/chromium"
    : undefined,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.setContent(`<body style="margin:0;background:white"><pre style="font:32px/1.7 monospace;padding:40px;margin:0;width:820px">KOPI HOUSE
08/10/2026
2 x Chicken Rice    18.00    36.00
Noodles                     22.00
Subtotal                    58.00
Service Charge               5.80
SST                          3.48
Grand Total RM              67.28
Cash                       100.00
Change                      32.72</pre></body>`);
await page.screenshot({ path: "tests/fixtures/synthetic-receipt.png" });
await browser.close();
