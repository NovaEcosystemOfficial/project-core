import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = path.join(projectRoot, "dist", "index.html");
const electronMain = path.join(projectRoot, "electron", "dist", "main.js");

if (!fs.existsSync(indexHtml) || !fs.existsSync(electronMain)) {
  console.error("Build artifacts missing. Run: npm run build:desktop");
  process.exit(1);
}

const electronCli = path.join(projectRoot, "node_modules", "electron", "cli.js");
const child = spawn(process.execPath, [electronCli, "."], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_SMOKE_TEST: "1",
  },
  windowsHide: false,
});

const timeout = setTimeout(() => {
  console.error("SMOKE_FAIL: timed out waiting for renderer");
  child.kill();
  process.exit(1);
}, 30_000);

child.on("exit", (code) => {
  clearTimeout(timeout);
  process.exit(code ?? 1);
});
