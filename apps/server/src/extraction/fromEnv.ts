import { ClaudeExtractor } from "./ClaudeExtractor.js";
import type { Extractor } from "./Extractor.js";
import { FakeExtractor } from "./FakeExtractor.js";

/**
 * `MG_EXTRACTOR=fake` → FakeExtractor (optional delay via `MG_FAKE_DELAY_MS`), for the playtest and
 * dev without an API key. Otherwise ClaudeExtractor, which resolves credentials like the SDK does
 * (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or an `ant auth login` profile); without any, each
 * upload ends as an error for the player.
 */
export function createExtractorFromEnv(env: NodeJS.ProcessEnv = process.env): Extractor {
  if (env.MG_EXTRACTOR === "fake") return new FakeExtractor(Number(env.MG_FAKE_DELAY_MS ?? 0) || 0);
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    console.warn(
      "⚠ No hay ANTHROPIC_API_KEY: si tampoco hay un perfil de `ant auth login`, las capturas van a fallar. Para probar sin la API: MG_EXTRACTOR=fake.",
    );
  }
  return new ClaudeExtractor();
}
