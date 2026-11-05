import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const pdfPath =
  args[0] ??
  path.join(root, "scripts", "fixtures", "DDT_01_standard_multiriga.pdf");

console.log("PDF:", pdfPath);
console.log("size:", fs.statSync(pdfPath).size);

const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
console.log("pages:", pdf.numPages);

for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 3); pageNum += 1) {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  console.log(`\n=== PAGE ${pageNum} ITEMS (${content.items.length}) ===`);
  for (const item of content.items) {
    if (!("str" in item)) continue;
    console.log(
      JSON.stringify({
        str: item.str,
        x: Number(item.transform?.[4]?.toFixed?.(2) ?? item.transform?.[4]),
        y: Number(item.transform?.[5]?.toFixed?.(2) ?? item.transform?.[5]),
        w: item.width,
        eol: item.hasEOL,
      }),
    );
  }
}

const extractMod = await import(
  pathToFileURL(path.join(root, "electron/services/ddt-extract.ts")).href
);
const result = await extractMod.extractDdtContent({
  absolutePath: pdfPath,
  mimeType: "application/pdf",
});
console.log("\n=== EXTRACT+PARSE ===");
console.log(
  JSON.stringify(
    {
      strategy: result.strategy,
      message: result.message,
      documentNumber: result.parsed.documentNumber,
      documentDate: result.parsed.documentDate,
      counterpartyName: result.parsed.counterpartyName,
      orderReference: result.parsed.orderReference,
      warnings: result.parsed.warnings,
      lines: result.parsed.lines.map((l) => ({
        code: l.originalCode,
        desc: l.originalDescription,
        qty: l.quantityRaw,
        unit: l.unitNormalized,
      })),
    },
    null,
    2,
  ),
);
