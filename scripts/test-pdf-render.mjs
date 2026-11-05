/**
 * Electron-only verification of printToPDF technique used by quotes-pdf-service.
 * Content assembly is covered by `npm run test:pdf-export` (tsx).
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPdfBuffer(buffer) {
  return (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  );
}

const sampleHtml = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <title>Preventivo PREV-2026-0001</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: "Segoe UI", sans-serif; color: #15202b; }
    .logo { max-width: 64px; }
  </style>
</head>
<body>
  <h1>PREVENTIVO</h1>
  <p>Studio Esempio · Città di Milano · caratteri àèéìòù</p>
  <img class="logo" alt="" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" />
  <p>Totale 1.234,56 €</p>
</body>
</html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 1200,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(sampleHtml)}`,
    );
    const pdf = Buffer.from(
      await win.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        pageSize: "A4",
        preferCSSPageSize: true,
      }),
    );

    assert(isPdfBuffer(pdf), "buffer must start with %PDF-");
    assert(pdf.length > 400, "pdf should have meaningful size");
    assert(!pdf.subarray(0, 32).toString("utf8").includes("<html"), "not raw HTML");

    const out = path.join(os.tmpdir(), `projectcore-pdf-render-${Date.now()}.pdf`);
    fs.writeFileSync(out, pdf);
    assert(isPdfBuffer(fs.readFileSync(out)), "disk file is PDF");
    fs.unlinkSync(out);

    console.log("OK  Electron printToPDF produced a valid PDF buffer");
    if (!win.isDestroyed()) {
      win.close();
    }
    app.exit(0);
  } catch (error) {
    console.error("PDF_RENDER_FAIL:", error);
    if (!win.isDestroyed()) {
      win.close();
    }
    app.exit(1);
  }
});
