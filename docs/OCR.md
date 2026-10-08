# OCR benchmark protocol

`ReceiptOCRProvider` isolates recognition from image preparation, spatial parsing,
exact reconciliation and correction. The shipped implementation is Tesseract.js;
a cloud adapter can implement the same interface later, with explicit consent
and server-side credentials. No cloud recognition is active now.

The default benchmark fixture is a generated, synthetic Malaysian-style image.
Regenerate with `npm run fixtures:ocr`. Recognize it with
`npm run benchmark:ocr`. The checked-in results contain actual Tesseract output;
no results are simulated. Original and contrast variants each extracted both
items, both prices/quantities and the total, and reconciled. Processing time is
machine-specific and excludes worker startup. This narrow fixture does not
establish performance on photographs, thermal printing or restaurant layouts.

For a real dataset, provide a manifest following
`tests/fixtures/ocr-manifest.json`, with `kind: "real"`, permission provenance,
verified quantities, unit prices, currency and printed total. Keep personal data
out of committed fixtures unless publication is authorized. Real-image raw OCR
text is omitted from benchmark output. Include café, food-court, SST, service,
discounts, long, blurred, tilted, faded and repeated-item cases. Report results
separately for each quality class. Compare variants on identical inputs.

Metrics use normalized exact descriptions to match truth items, item precision
and recall, exact unit-price and quantity agreement, exact printed total,
reconciliation and failures. Timing includes image preparation, OCR and parsing.
Correction time is null until measured in a real human review session. Local API
cost is zero; device compute, hosting bandwidth and any future cloud costs are
separate. Do not equate synthetic correctness with real-world accuracy.

Current image preparation uses margin crop, quarter-turn rotation, capped resize,
optional grayscale/contrast, and measurable brightness/contrast/resolution/edge
checks. It does not implement automatic deskew, perspective correction, adaptive
thresholding or a blur classifier calibrated against real receipts. Warnings are
heuristics. Preserve the original photo option because contrast can reduce
recognition quality. Financial mismatches are shown and never silently patched.
