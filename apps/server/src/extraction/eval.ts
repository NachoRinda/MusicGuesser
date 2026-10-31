// Extraction eval against the real Claude API (costs money; not part of `verify`).
// Usage: npm run eval:extraction [-- <filtro>]
// Each fixtures/screenshots/<name>.{png,jpg,jpeg,webp} needs <name>.expected.json: { "isPlaylist": boolean, "tracks": [{ "title", "artist" }] }.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { MAX_SCREENSHOT_BYTES, type ScreenshotMediaType, type Track } from "@mg/shared";
import { loadRootEnv } from "../env.js";
import { ClaudeExtractor, EXTRACTION_MODEL } from "./ClaudeExtractor.js";
import { trackKey } from "./evaluate.js";

loadRootEnv();

const DIR = "fixtures/screenshots";
const GOALS = { recall: 0.9, precision: 0.95 };
const MEDIA: Record<string, ScreenshotMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

interface Expected {
  isPlaylist: boolean;
  tracks: Track[];
}

const filter = process.argv[2];
const files = readdirSync(DIR)
  .filter((f) => MEDIA[path.extname(f).toLowerCase()] && (!filter || f.includes(filter)))
  .sort();
if (files.length === 0) {
  console.log(`No hay capturas en ${DIR}/. Agregá imágenes con su <nombre>.expected.json.`);
  process.exit(1);
}

const extractor = new ClaudeExtractor();
const rows: { file: string; classOk: boolean; recall: number | null; precision: number | null; note: string }[] = [];

for (const file of files) {
  const base = path.join(DIR, path.basename(file, path.extname(file)));
  const expectedPath = `${base}.expected.json`;
  if (!existsSync(expectedPath)) {
    console.log(`⚠ ${file}: falta ${path.basename(expectedPath)}, la salteo`);
    continue;
  }
  const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as Expected;
  const data = readFileSync(path.join(DIR, file));
  if (data.length > MAX_SCREENSHOT_BYTES) {
    console.log(`⚠ ${file}: pesa ${(data.length / 1e6).toFixed(1)} MB (> límite); en la app el celular la achica. Achicala para el eval.`);
    continue;
  }

  const t0 = Date.now();
  try {
    const [reading] = await extractor.extract([{ mediaType: MEDIA[path.extname(file).toLowerCase()]!, data }]);
    const classOk = reading!.isPlaylist === expected.isPlaylist;
    let recall: number | null = null;
    let precision: number | null = null;
    const notes: string[] = [`${((Date.now() - t0) / 1000).toFixed(1)} s`];
    if (expected.isPlaylist) {
      const want = new Set(expected.tracks.map(trackKey));
      const got = new Set(reading!.tracks.map(trackKey));
      const hits = [...got].filter((k) => want.has(k)).length;
      recall = want.size ? hits / want.size : 1;
      precision = got.size ? hits / got.size : 0;
      const missing = expected.tracks.filter((t) => !got.has(trackKey(t)));
      const extra = reading!.tracks.filter((t) => !want.has(trackKey(t)));
      if (missing.length) notes.push(`faltan: ${missing.map((t) => `${t.title} — ${t.artist}`).join("; ")}`);
      if (extra.length) notes.push(`sobran: ${extra.map((t) => `${t.title} — ${t.artist}`).join("; ")}`);
    }
    rows.push({ file, classOk, recall, precision, note: notes.join(" | ") });
  } catch (err) {
    rows.push({ file, classOk: false, recall: null, precision: null, note: `ERROR ${err instanceof Error ? err.message : err}` });
  }
}

const pct = (x: number | null) => (x === null ? "  —  " : `${(x * 100).toFixed(0).padStart(4)}%`);
console.log(`\nModelo: ${EXTRACTION_MODEL}\n`);
for (const r of rows) {
  console.log(`${r.classOk ? "✅" : "❌"} ${r.file}  recall ${pct(r.recall)}  precisión ${pct(r.precision)}  ${r.note}`);
}
const scored = rows.filter((r) => r.recall !== null);
const avg = (k: "recall" | "precision") => (scored.length ? scored.reduce((s, r) => s + r[k]!, 0) / scored.length : null);
const classAll = rows.length > 0 && rows.every((r) => r.classOk);
const recall = avg("recall");
const precision = avg("precision");
console.log(
  `\nClasificación: ${rows.filter((r) => r.classOk).length}/${rows.length}` +
    `  ·  recall prom. ${pct(recall)} (meta ${GOALS.recall * 100}%)  ·  precisión prom. ${pct(precision)} (meta ${GOALS.precision * 100}%)`,
);
const pass = classAll && (recall ?? 0) >= GOALS.recall && (precision ?? 0) >= GOALS.precision;
console.log(pass ? "META CUMPLIDA" : "META NO CUMPLIDA");
process.exit(pass ? 0 : 1);
