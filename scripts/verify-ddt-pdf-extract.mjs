import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extractUrl = pathToFileURL(
  path.join(root, "electron", "services", "ddt-extract.ts"),
).href;

const { extractDdtContent } = await import(extractUrl);
const pdfPath = path.join(
  root,
  "scripts",
  "fixtures",
  "DDT_01_standard_multiriga.pdf",
);

const result = await extractDdtContent({
  absolutePath: pdfPath,
  mimeType: "application/pdf",
});

console.log(
  JSON.stringify(
    {
      strategy: result.strategy,
      pageCount: result.pageCount,
      documentNumber: result.parsed.documentNumber,
      documentDate: result.parsed.documentDate,
      counterpartyName: result.parsed.counterpartyName,
      lineCount: result.parsed.lines.length,
      message: result.message,
    },
    null,
    2,
  ),
);

if (result.strategy !== "native_text") {
  throw new Error(`Expected native_text, got ${result.strategy}`);
}
if (!result.parsed.documentNumber) {
  throw new Error("Expected document number from PDF text");
}
if (result.parsed.lines.length < 1) {
  throw new Error("Expected at least one parsed line");
}

console.log("VERIFY_OK");
