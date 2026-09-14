import { spawn } from "node:child_process";

// The relay does not receive the site environment or any special owner credentials.
const relay = spawn(process.execPath, ["--experimental-strip-types", "scripts/secure-chat-relay.mjs"], { stdio: "inherit", env: { PATH: process.env.PATH, NODE_OPTIONS: "--max-old-space-size=256" } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => relay.kill(signal));
relay.on("exit", code => process.exit(code ?? 0));
