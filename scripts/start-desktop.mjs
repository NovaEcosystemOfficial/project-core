import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = path.join(projectRoot, "dist", "index.html");
const electronMain = path.join(projectRoot, "electron", "dist", "main.js");
const electronPreload = path.join(projectRoot, "electron", "dist", "preload.cjs");

for (const requiredPath of [indexHtml, electronMain, electronPreload]) {
  if (!fs.existsSync(requiredPath)) {
    console.error(`Missing ${path.relative(projectRoot, requiredPath)}. Run: npm run build:desktop`);
    process.exit(1);
  }
}

// Production local run: no ELECTRON_RENDERER_URL → main uses loadFile(dist/index.html)
const electronCli = path.join(projectRoot, "node_modules", "electron", "cli.js");
const child = spawn(process.execPath, [electronCli, "."], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
  windowsHide: false,
});

child.on("exit", (code) => process.exit(code ?? 0));
