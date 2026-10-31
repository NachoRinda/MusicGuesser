import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Loads the repo-root `.env` (if any) into process.env; variables already set win. */
export function loadRootEnv(): void {
  const file = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}
