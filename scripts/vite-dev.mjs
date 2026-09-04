import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vitePath = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/vite/bin/vite.js");

const portFile = ".vite-dev-port";

function findAvailablePort(start) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => findAvailablePort(start + 1).then(resolve, reject));
    server.listen(start, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const port = await findAvailablePort(5173);
await writeFile(portFile, String(port));
const child = spawn(process.execPath, [vitePath, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  stdio: "inherit",
  env: process.env,
});

function shutdown() {
  child.kill();
  unlink(portFile).catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.once("exit", (code) => {
  unlink(portFile).catch(() => {});
  process.exit(code ?? 1);
});
