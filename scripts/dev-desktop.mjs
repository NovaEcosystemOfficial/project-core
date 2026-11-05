import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildElectron } from "./build-electron.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const children = [];

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

function runNodeScript(scriptPath, args = [], env = process.env) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env,
    windowsHide: false,
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

function waitForVite(timeoutMs = 60_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(VITE_URL, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timeout waiting for Vite at ${VITE_URL}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await buildElectron();

if (await isPortInUse(VITE_PORT)) {
  console.error(
    `Port ${VITE_PORT} is already in use. Free it, then run npm run dev:desktop again.`,
  );
  process.exit(1);
}

console.log("Electron build ready. Starting Vite…");

const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const vite = runNodeScript(viteBin);
vite.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(
      `Vite exited with code ${code}. If port 5173 is busy, free it and retry.`,
    );
    shutdown(code);
  }
});

try {
  await waitForVite();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}

console.log("Vite is up. Starting Electron…");
const electronCli = path.join(projectRoot, "node_modules", "electron", "cli.js");
const electronApp = runNodeScript(electronCli, ["."], {
  ...process.env,
  ELECTRON_RENDERER_URL: VITE_URL,
});
electronApp.on("exit", (code) => shutdown(code ?? 0));
