import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronDir = path.join(projectRoot, "electron");
const outDir = path.join(electronDir, "dist");
const require = createRequire(import.meta.url);

/**
 * pdf.js still dynamically imports its worker for the Node "fake worker".
 * Copy the package worker next to the Electron bundle so resolution stays
 * deterministic even when module paths differ after packaging.
 */
function copyPdfJsWorker() {
  const workerSrc = require.resolve(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
  );
  fs.mkdirSync(outDir, { recursive: true });
  const workerDest = path.join(outDir, "pdf.worker.mjs");
  fs.copyFileSync(workerSrc, workerDest);
  return workerDest;
}

export async function buildElectron() {
  // Keep pdfjs-dist external: its fake-worker does `import(workerSrc)` relative to
  // the real package file. Bundling it into main.js makes `./pdf.worker.mjs`
  // resolve under electron/dist/ and break extraction.
  const mainExternals = [
    "electron",
    "better-sqlite3",
    "pdfjs-dist",
    "pdfjs-dist/*",
    "tesseract.js",
    "tesseract.js/*",
  ];

  await esbuild.build({
    entryPoints: [path.join(electronDir, "main.ts")],
    outfile: path.join(outDir, "main.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: mainExternals,
    sourcemap: true,
  });

  // Preload as CJS: most reliable under Electron contextIsolation.
  await esbuild.build({
    entryPoints: [path.join(electronDir, "preload.ts")],
    outfile: path.join(outDir, "preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
    sourcemap: true,
  });

  const workerDest = copyPdfJsWorker();
  return { workerDest };
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const { workerDest } = await buildElectron();
  console.log("Electron main/preload built in electron/dist/");
  console.log(`PDF.js worker copied to ${workerDest}`);
}
