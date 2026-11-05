import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(
  root,
  "scripts",
  "fixtures",
  "DDT_01_standard_multiriga.pdf",
);

// Pipe separators survive pdf.js itemization better than multi-space columns.
const lines = [
  "DDT N. DDT-2026-001",
  "Data documento: 15/03/2026",
  "Fornitore: Fornitore Demo Srl",
  "Rif. ordine: ORD-7788",
  "Codice | Descrizione | Q.ta | U.M.",
  "ART-001 | Vite M6 zincata | 10 | pcs",
  "ART-002 | Guarnizione NBR | 2,5 | kg",
  "ART-003 | Tubo PVC 20mm | 12 | m",
];

function escapePdfText(value) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

let content = "BT /F1 11 Tf 50 750 Td 14 TL\n";
lines.forEach((line, index) => {
  const escaped = escapePdfText(line);
  content += index === 0 ? `(${escaped}) Tj\n` : `T* (${escaped}) Tj\n`;
});
content += "ET";

const contentLen = Buffer.byteLength(content, "utf8");
const objects = [
  "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
  "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
  "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
  `4 0 obj<< /Length ${contentLen} >>stream\n${content}\nendstream\nendobj\n`,
  "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
];

let body = "%PDF-1.4\n";
const offsets = [0];
for (const object of objects) {
  offsets.push(Buffer.byteLength(body, "utf8"));
  body += object;
}
const xrefStart = Buffer.byteLength(body, "utf8");
body += `xref\n0 ${objects.length + 1}\n`;
body += "0000000000 65535 f \n";
for (let i = 1; i <= objects.length; i += 1) {
  body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
body += `startxref\n${xrefStart}\n%%EOF\n`;

fs.writeFileSync(outPath, body);
console.log(`Wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);
