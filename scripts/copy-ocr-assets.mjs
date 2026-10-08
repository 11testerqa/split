import { mkdir, copyFile, readdir, readFile } from "node:fs/promises";
await mkdir("public/ocr", { recursive: true });
async function copyIfChanged(source, target) {
  const content = await readFile(source);
  try {
    if (content.equals(await readFile(target))) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Avoid needless dev-server reloads when two test/dev servers prepare assets.
  await copyFile(source, target);
}
await copyIfChanged(
  "node_modules/tesseract.js/dist/worker.min.js",
  "public/ocr/worker.min.js",
);
for (const name of await readdir("node_modules/tesseract.js-core"))
  if (/\.wasm(\.js)?$/.test(name))
    await copyIfChanged(
      `node_modules/tesseract.js-core/${name}`,
      `public/ocr/${name}`,
    );
await copyIfChanged(
  "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "public/ocr/eng.traineddata.gz",
);
await copyIfChanged(
  "node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt",
  "public/ocr/worker.min.js.LICENSE.txt",
);
await copyIfChanged(
  "node_modules/tesseract.js/LICENSE.md",
  "public/ocr/TESSERACT-LICENSE.md",
);
await copyIfChanged(
  "node_modules/tesseract.js-core/LICENSE",
  "public/ocr/CORE-LICENSE",
);
