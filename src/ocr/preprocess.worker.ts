self.onmessage = (
  event: MessageEvent<{
    buffer: ArrayBuffer;
    width: number;
    height: number;
    variant: string;
  }>,
) => {
  const { buffer, width, height, variant } = event.data;
  const pixels = new Uint8ClampedArray(buffer),
    gray = new Uint8Array(width * height);
  let sum = 0,
    sumSq = 0,
    edges = 0;
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    const g = Math.round(
      0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2],
    );
    gray[j] = g;
    sum += g;
    sumSq += g * g;
    if (j % width !== 0) edges += Math.abs(g - gray[j - 1]);
    if (variant === "contrast") {
      const adjusted = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
      pixels[i] = pixels[i + 1] = pixels[i + 2] = adjusted;
    }
  }
  const mean = sum / gray.length,
    contrast = Math.sqrt(sumSq / gray.length - mean * mean);
  const warnings: string[] = [];
  if (width < 700)
    warnings.push("Low resolution. A closer, sharper photo may read better.");
  if (mean < 85)
    warnings.push("The photo is dark. Improve lighting and avoid shadows.");
  if (contrast < 25)
    warnings.push("Low contrast. Check for glare or faded printing.");
  if (edges / gray.length < 3)
    warnings.push("Few sharp edges detected. Check focus before scanning.");
  self.postMessage({ buffer, warnings }, { transfer: [buffer] });
};
