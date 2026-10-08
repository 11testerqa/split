export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  warnings: string[];
}
export async function prepareImage(
  file: Blob,
  rotation: number,
  crop: Crop,
  variant: "original" | "contrast",
  signal: AbortSignal,
): Promise<PreparedImage> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 40_000_000) {
    bitmap.close();
    throw Error(
      "Image is too large. Use a smaller photo (under 40 megapixels).",
    );
  }
  const left = Math.round((bitmap.width * crop.left) / 100),
    top = Math.round((bitmap.height * crop.top) / 100);
  const width = Math.round(
      (bitmap.width * (100 - crop.left - crop.right)) / 100,
    ),
    height = Math.round((bitmap.height * (100 - crop.top - crop.bottom)) / 100);
  if (width < 100 || height < 100) {
    bitmap.close();
    throw Error("Crop leaves too little of the receipt.");
  }
  const sideways = rotation % 180 !== 0;
  const scale = Math.min(
    1,
    2400 / (sideways ? height : width),
    10000 / (sideways ? width : height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((sideways ? height : width) * scale);
  canvas.height = Math.round((sideways ? width : height) * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(
    bitmap,
    left,
    top,
    width,
    height,
    (-width * scale) / 2,
    (-height * scale) / 2,
    width * scale,
    height * scale,
  );
  bitmap.close();
  const worker = new Worker(
    new URL("./preprocess.worker.ts", import.meta.url),
    { type: "module" },
  );
  try {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = await new Promise<{
      buffer: ArrayBuffer;
      warnings: string[];
    }>((resolve, reject) => {
      const abort = () => reject(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      worker.onmessage = (e) => {
        signal.removeEventListener("abort", abort);
        resolve(e.data);
      };
      worker.onerror = () => {
        signal.removeEventListener("abort", abort);
        reject(Error("Image preparation failed."));
      };
      worker.postMessage(
        {
          buffer: pixels.data.buffer,
          width: canvas.width,
          height: canvas.height,
          variant,
        },
        [pixels.data.buffer],
      );
    });
    signal.throwIfAborted();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(result.buffer),
        canvas.width,
        canvas.height,
      ),
      0,
      0,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error("Image preparation failed."))),
        "image/png",
      ),
    );
    return {
      blob,
      width: canvas.width,
      height: canvas.height,
      warnings: result.warnings,
    };
  } finally {
    worker.terminate();
  }
}
