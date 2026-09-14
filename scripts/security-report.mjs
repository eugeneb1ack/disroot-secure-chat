import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const output = "public/secure-chat/reports";
mkdirSync(output, { recursive: true });
const suites = [
  { name: "Production integration and hostile inputs", file: "lib/secure-chat-v2.test.mjs" },
  { name: "MLS retention and compromise scenarios (laboratory fixtures)", file: "tests/secure-chat/ratchet.test.mjs" },
];
let failed = false;
const results = suites.map(suite => {
  const args = ["--experimental-strip-types", "--test", "--test-reporter=tap", suite.file];
  const run = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 8_000_000 });
  const tests = [...run.stdout.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map(([, status, name]) => ({ name, passed: status === "ok" }));
  const passed = run.status === 0 && tests.length > 0 && tests.every(test => test.passed);
  failed ||= !passed;
  const artifact = suite.file.includes("ratchet") ? "mls-ratchet.tap" : "integration.tap";
  writeFileSync(`${output}/${artifact}`, run.stdout);
  return { suite: suite.name, command: `node ${args.join(" ")}`, exitCode: run.status, passed, tests, artifact };
});
const sources = ["lib/secure-chat-protocol.ts", "lib/secure-chat-invite.ts", "lib/secure-chat-mls.ts", "lib/secure-chat-mls-adapter.ts", "lib/secure-chat-client.ts", "lib/secure-chat-store.ts", "lib/secure-chat-handler.ts", "lib/secure-chat-guard.ts", "app/api/secure-chat/route.ts", "scripts/secure-chat-relay.mjs", "lib/secure-chat-v2.test.mjs", "tests/secure-chat/ratchet.test.mjs", "package-lock.json"];
sources.push("lib/secure-chat-interactions.ts", "lib/secure-chat-session.ts");
sources.push("lib/secure-chat-runtime.ts", "lib/secure-chat-polling.ts");
sources.push("lib/secure-chat-vault.ts", "lib/secure-chat-browser-session.ts");
const sourceSha256 = Object.fromEntries(sources.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
const report = { schema: "disroot-chat-security-tests/v1", generatedAt: new Date().toISOString(), runtime: process.version, platform: `${process.platform}/${process.arch}`, classification: "Automated integration and MLS regression tests", gitHead: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), sourceSha256, passed: !failed, total: results.reduce((sum, suite) => sum + suite.tests.length, 0), results,
  limits: ["The source hashes identify the tested files, including uncommitted work. gitHead alone does not identify this build.", "Expiry is tested by advancing an injected relay clock; this is not a 24-hour endurance test.", "The parser test contains 256 deterministic malformed packets; the integrity test mutates 32 ciphertext bytes. These are bounded negative tests, not exhaustive fuzzing.", "Laboratory compromise fixtures exercise pinned ts-mls 1.6.4 and record behavior after state capture and participant key updates.", "The timing sample measures local Node cryptography, not browser or network latency.", "Browser, HTTP and deployment checks are recorded separately and are not implied by this report."] };
writeFileSync(`${output}/security-tests.json`, JSON.stringify(report, null, 2) + "\n");
writeFileSync(`${output}/security-tests.md`, `# Secure Chat — automated security checks\n\nGenerated: ${report.generatedAt}\n\nRuntime: ${report.runtime} (${report.platform})\n\n**${report.total} checks; ${failed ? "FAILED" : "PASSED"}. Technical self-review.**\n\n[Machine-readable report and source hashes](security-tests.json).\n\n` + results.map(suite => `## ${suite.suite}\n\n\`${suite.command}\`\n\nExit: ${suite.exitCode}. [Raw TAP output](${suite.artifact}).\n\n` + suite.tests.map(test => `- ${test.passed ? "PASS" : "FAIL"} — ${test.name}`).join("\n")).join("\n\n") + "\n\n## Limits\n\n" + report.limits.map(value => `- ${value}`).join("\n") + "\n");
console.log(JSON.stringify({ passed: report.passed, total: report.total, report: `${output}/security-tests.md` }));
if (failed) process.exitCode = 1;
