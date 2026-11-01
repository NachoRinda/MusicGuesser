import { DeezerCatalog } from "./DeezerCatalog.js";
import { FakeCatalog } from "./FakeCatalog.js";
import type { MusicCatalog } from "./MusicCatalog.js";

/** `MG_CATALOG=fake` → no network (playtest, offline dev). Otherwise Deezer. */
export function createCatalogFromEnv(env: NodeJS.ProcessEnv = process.env): MusicCatalog {
  return env.MG_CATALOG === "fake" ? new FakeCatalog() : new DeezerCatalog();
}
