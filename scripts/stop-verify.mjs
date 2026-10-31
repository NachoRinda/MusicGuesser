// Claude Code Stop hook: blocks Claude from finishing a turn while typecheck or tests fail.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
// Already re-prompted once by this hook: let Claude stop so it can report the failure instead of looping.
if (input.stop_hook_active) process.exit(0);

try {
  execSync("npm run -s typecheck && npm test -s", { stdio: "pipe", encoding: "utf8" });
} catch (err) {
  const output = `${err.stdout ?? ""}${err.stderr ?? ""}`.split("\n").slice(-40).join("\n");
  process.stderr.write(`Verificación falló (typecheck/tests). Arreglalo o informalo al usuario:\n${output}`);
  process.exit(2);
}
