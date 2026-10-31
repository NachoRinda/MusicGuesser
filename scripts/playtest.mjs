// End-to-end playtest: a TV and several phones (separate browser contexts) play through the app.
// Usage: npm run playtest [-- <escenario>]   e.g. npm run playtest -- sala
// Starts `npm run dev` if nothing is serving on :5173. Screenshots go to test-results/playtest/.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const BASE = "http://localhost:5173";
const SHOTS = "test-results/playtest";
const T = { timeout: 3000 };
const WINDOWS_CHROMES = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

// ---------- Escenarios (uno por fase; agregar los nuevos al final) ----------

/** Valid 1×1 PNG. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A "screenshot" for the FakeExtractor: a real PNG with a tag appended after the image data
 * (browsers ignore it). Tags MG-INVALID / MG-FEW / MG-ERROR pick the outcome; anything else reads
 * 12 fake tracks (varying with the tag).
 */
const fakeShot = (tag) => ({ name: `${tag}.png`, mimeType: "image/png", buffer: Buffer.concat([PNG_1PX, Buffer.from(tag)]) });

/** Picks screenshots on a phone (the input is hidden behind the "Subir capturas" button). */
async function pickShots(page, ...tags) {
  await page.locator('input[type="file"]').setInputFiles(tags.map(fakeShot));
}

async function uploadOk(page, tag) {
  await pickShots(page, tag);
  await page.getByText("¡Listo! Leímos").waitFor({ timeout: 5000 });
}

/** Fase 2: sala en tiempo real (spec 02). */
async function sala({ browser, check, shot }) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const phoneCtx = () => browser.newContext({ ...devices["iPhone 13"] });

  await tv.goto(`${BASE}/host`);
  const code = (await tv.locator(".code").textContent({ timeout: 5000 })).trim();
  const startBtn = tv.getByRole("button", { name: "Empezar" });

  /** Opens a phone on the room and submits the name; returns when the click happened. */
  async function joinPhone(name, roomCode = code) {
    const ctx = await phoneCtx();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/play/${roomCode}`);
    await page.getByPlaceholder("Tu nombre").fill(name);
    const clickedAt = Date.now();
    await page.getByRole("button", { name: "Entrar" }).click();
    return { ctx, page, clickedAt };
  }

  await check(`Código de 4 letras válido (${code})`, async () => {
    if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code)) throw new Error(code);
  });
  await check("QR visible y URL con IP LAN (no localhost)", async () => {
    await tv.locator("img.qr").waitFor(T);
    const url = await tv.locator(".join .muted").textContent();
    if (!url.includes(`/play/${code}`) || url.includes("localhost")) throw new Error(url);
  });
  await shot(tv, "sala-01-tv-vacia");

  const ana = await joinPhone("Ana");
  const beto = await joinPhone("Beto");
  await check("Con 2 jugadores, Empezar está deshabilitado", async () => {
    await tv.locator(".players li", { hasText: "Beto" }).waitFor(T);
    if (await startBtn.isEnabled()) throw new Error("habilitado");
  });

  const caro = await joinPhone("Caro");
  await check("El 3er jugador aparece en la TV en < 1 s", async () => {
    await tv.locator(".players li", { hasText: "Caro" }).waitFor({ timeout: 1000 });
    return `${Date.now() - caro.clickedAt} ms`;
  });
  await check("Con 3 jugadores listos (captura leída), Empezar se habilita", async () => {
    for (const [p, tag] of [[ana, "ana"], [beto, "beto"], [caro, "caro"]]) await uploadOk(p.page, tag);
    await tv.locator('.players li[data-status="ready"]').nth(2).waitFor(T);
    if (!(await startBtn.isEnabled())) throw new Error("deshabilitado");
  });
  await check("El celular ve el lobby con todos", async () => {
    await ana.page.getByText("¡Hola, Ana!").waitFor(T);
    await ana.page.getByText("Caro").waitFor(T);
  });
  await shot(tv, "sala-02-tv-3-jugadores");
  await shot(ana.page, "sala-03-celular-lobby");

  await check("Nombre duplicado (otra mayúscula) → error", async () => {
    const dup = await joinPhone("ana");
    await dup.page.getByText("Ese nombre ya está en uso").waitFor(T);
    await shot(dup.page, "sala-04-nombre-duplicado");
    await dup.ctx.close();
  });

  await check("Sala inexistente → 'No existe la sala'", async () => {
    const p = await joinPhone("Dani", "ZZZZ");
    await p.page.getByText("No existe la sala").waitFor(T);
    await p.ctx.close();
  });

  await check("/play sin código → tipear código lleva a la sala", async () => {
    const ctx = await phoneCtx();
    const p = await ctx.newPage();
    await p.goto(`${BASE}/play`);
    await p.getByPlaceholder("Código").fill(code.toLowerCase());
    await p.getByRole("button", { name: "Entrar" }).click();
    await p.getByText(`Sala ${code}`).waitFor(T);
    await ctx.close();
  });

  await check("Recargar un celular conserva la identidad", async () => {
    await beto.page.reload();
    await beto.page.getByText("¡Hola, Beto!").waitFor(T);
    if (await beto.page.getByPlaceholder("Tu nombre").count()) throw new Error("pidió nombre");
  });

  await check("Cerrar la pestaña → atenuado en la TV; volver → mismo jugador", async () => {
    await caro.page.close();
    await tv.locator(".players li.disconnected", { hasText: "Caro" }).waitFor(T);
    if (await startBtn.isEnabled()) throw new Error("Empezar habilitado con 2 conectados");
    await shot(tv, "sala-05-tv-desconectado");
    caro.page = await caro.ctx.newPage();
    await caro.page.goto(`${BASE}/play/${code}`);
    await caro.page.getByText("¡Hola, Caro!").waitFor(T);
    await tv.locator(".players li:not(.disconnected)", { hasText: "Caro" }).waitFor(T);
    if ((await tv.locator(".players li").count()) !== 3) throw new Error("se duplicó el jugador");
  });

  await check("Recargar la TV conserva sala y jugadores", async () => {
    await tv.reload();
    await tv.locator(".code", { hasText: code }).waitFor(T);
    for (const n of ["Ana", "Beto", "Caro"]) await tv.locator(".players li", { hasText: n }).waitFor(T);
  });

  await check("Empezar → TV y celulares muestran '¡Arrancamos!'", async () => {
    await startBtn.click();
    for (const p of [tv, ana.page, beto.page, caro.page]) await p.getByText("¡Arrancamos!").waitFor(T);
    await shot(tv, "sala-06-tv-arrancamos");
    await shot(ana.page, "sala-07-celular-arrancamos");
  });

  await check("Nombre nuevo durante la partida → 'La partida ya empezó'", async () => {
    const late = await joinPhone("Eli");
    await late.page.getByText("La partida ya empezó").waitFor(T);
    await late.ctx.close();
  });

  await check("Recargar un celular durante la partida → vuelve al juego", async () => {
    await ana.page.reload();
    await ana.page.getByText("¡Arrancamos!").waitFor(T);
  });
}

/** Fase 3: subir capturas y quedar listo (spec 03), con el FakeExtractor. */
async function capturas({ browser, check, shot }) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await tv.goto(`${BASE}/host`);
  const code = (await tv.locator(".code").textContent({ timeout: 5000 })).trim();
  const startBtn = tv.getByRole("button", { name: "Empezar" });
  const tvRow = (name) => tv.locator(".players li", { hasText: name });

  async function joinPhone(name) {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/play/${code}`);
    await page.getByPlaceholder("Tu nombre").fill(name);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.getByText(`¡Hola, ${name}!`).waitFor(T);
    return { ctx, page };
  }

  const ana = await joinPhone("Ana");
  const beto = await joinPhone("Beto");
  const caro = await joinPhone("Caro");
  const dani = await joinPhone("Dani");

  await check("Recién unidos: instrucciones, 'Subir capturas' y TV con 'sin captura'", async () => {
    await ana.page.getByText("En repetición").waitFor(T);
    await ana.page.getByRole("button", { name: "Subir capturas" }).waitFor(T);
    await tvRow("Dani").getByText("sin captura").waitFor(T);
    if (await startBtn.isEnabled()) throw new Error("Empezar habilitado sin nadie listo");
  });
  await shot(ana.page, "capturas-01-celular-instrucciones");

  let anaTitles = [];
  await check("Ana sube 2 capturas → 'Leyendo…' en celular y TV → listo con su lista", async () => {
    await pickShots(ana.page, "ana-1", "ana-2");
    await ana.page.getByText("Leyendo tus canciones…").waitFor(T);
    await tvRow("Ana").getByText("leyendo captura…").waitFor(T);
    await shot(tv, "capturas-02-tv-leyendo");
    await ana.page.getByText("¡Listo! Leímos").waitFor({ timeout: 5000 });
    await tvRow("Ana").getByText(/listo \(\d+ canciones\)/).waitFor(T);
    anaTitles = await ana.page.locator(".tracks li strong").allTextContents();
    if (anaTitles.length < 10) throw new Error(`solo ${anaTitles.length} canciones`);
    return `${anaTitles.length} canciones`;
  });
  await shot(ana.page, "capturas-03-celular-listo");

  await check("La lista es de solo lectura (sin campos ni botones por canción)", async () => {
    if (await ana.page.locator(".tracks input, .tracks button, .tracks [contenteditable]").count()) {
      throw new Error("hay controles de edición");
    }
    await ana.page.getByRole("button", { name: "Reintentar captura" }).waitFor(T);
  });

  await check("La TV no muestra las canciones", async () => {
    const tvText = await tv.locator("body").textContent();
    const leaked = anaTitles.filter((t) => tvText.includes(t));
    if (leaked.length) throw new Error(`la TV muestra: ${leaked.join(", ")}`);
  });

  await check("Beto sube algo que no es playlist → aviso; reintenta → listo", async () => {
    await pickShots(beto.page, "MG-INVALID");
    await beto.page.getByText("no parece una playlist").waitFor({ timeout: 5000 });
    await tvRow("Beto").getByText("captura inválida").waitFor(T);
    await shot(beto.page, "capturas-04-celular-no-es-playlist");
    await uploadOk(beto.page, "beto");
  });

  await check("Caro sube una captura con 5 canciones → 'necesitamos al menos 10' y Empezar sigue deshabilitado", async () => {
    await pickShots(caro.page, "MG-FEW");
    await caro.page.getByText("Leímos 5 canciones, necesitamos al menos 10").waitFor({ timeout: 5000 });
    if ((await caro.page.locator(".tracks li").count()) !== 5) throw new Error("no muestra lo leído");
    await shot(caro.page, "capturas-05-celular-pocas");
    if (await startBtn.isEnabled()) throw new Error("Empezar habilitado con 2 listos");
  });

  await check("Caro reintenta → listo → con 3 listos se habilita Empezar", async () => {
    await uploadOk(caro.page, "caro");
    if ((await caro.page.locator(".tracks li").count()) === 5) throw new Error("mezcló envíos");
    await tvRow("Caro").getByText(/listo/).waitFor(T);
    await tv.locator("button:not(:disabled)", { hasText: "Empezar" }).waitFor(T);
  });
  await shot(tv, "capturas-06-tv-3-listos");

  await check("Elegir 3 imágenes → error sin enviar", async () => {
    await pickShots(dani.page, "d1", "d2", "d3");
    await dani.page.getByText("Subí 1 o 2 imágenes").waitFor(T);
    await tvRow("Dani").getByText("sin captura").waitFor(T);
  });

  await check("Falla técnica → 'No pudimos leer la captura' y Dani no queda listo", async () => {
    await pickShots(dani.page, "MG-ERROR");
    await dani.page.getByText("No pudimos leer la captura").waitFor({ timeout: 5000 });
    await tvRow("Dani").getByText("error al leer").waitFor(T);
  });

  await check("Recargar el celular conserva lo leído", async () => {
    await ana.page.reload();
    await ana.page.getByText("¡Listo! Leímos").waitFor(T);
    const again = await ana.page.locator(".tracks li strong").allTextContents();
    if (again.join("|") !== anaTitles.join("|")) throw new Error("cambió la lista");
  });

  await check("Empezar → juegan los 3 listos; Dani queda afuera con aviso", async () => {
    await startBtn.click();
    await tv.getByText("Juegan: Ana, Beto, Caro").waitFor(T);
    for (const p of [ana, beto, caro]) await p.page.getByText("¡Arrancamos!").waitFor(T);
    await dani.page.getByText("La partida empezó sin vos").waitFor(T);
    if (await ana.page.getByText("La partida empezó sin vos").count()) throw new Error("Ana figura afuera");
  });
  await shot(dani.page, "capturas-07-celular-afuera");
}

const SCENARIOS = { sala, capturas };

// ---------- Infraestructura ----------

async function isUp(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

async function waitUntil(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout esperando ${what}`);
}

/** Starts `npm run dev` unless the app is already up; returns a stop function. */
async function ensureDevServer() {
  if ((await isUp(`${BASE}/health`)) && (await isUp(`${BASE}/host`))) {
    const { extractor } = await (await fetch(`${BASE}/health`)).json();
    if (extractor !== "fake") {
      throw new Error(
        "Ya hay un dev server con el extractor real (gastaría API con imágenes falsas). Cerralo o levantalo con MG_EXTRACTOR=fake.",
      );
    }
    return () => {};
  }
  console.log("Levantando npm run dev (MG_EXTRACTOR=fake)…");
  const dev = spawn("npm", ["run", "dev"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, MG_EXTRACTOR: "fake", MG_FAKE_DELAY_MS: "700" },
  });
  await waitUntil(async () => (await isUp(`${BASE}/health`)) && (await isUp(`${BASE}/host`)), 30_000, "al dev server");
  return () => {
    try {
      process.kill(-dev.pid, "SIGTERM"); // whole process group: npm, tsx and vite
    } catch {
      // already gone
    }
  };
}

/**
 * Playwright's own Chromium; under WSL without its system libraries (needs sudo to install),
 * falls back to the Windows Chrome/Edge in headless mode over CDP (needs WSL mirrored networking).
 */
async function launchBrowser() {
  try {
    const browser = await chromium.launch();
    return { browser, close: () => browser.close() };
  } catch (err) {
    const exe = WINDOWS_CHROMES.find((p) => existsSync(p));
    if (!exe) throw err;
    console.log(`Chromium de Playwright no arrancó; uso ${exe.split("/").pop()} de Windows (headless).`);
    const port = 9222;
    const proc = spawn(
      exe,
      [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        "--user-data-dir=C:\\Users\\Public\\mg-playtest-profile",
        "--no-first-run",
        "about:blank",
      ],
      { detached: true, stdio: "ignore" },
    );
    proc.unref();
    await waitUntil(() => isUp(`http://localhost:${port}/json/version`), 15_000, "a Chrome de Windows");
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    return {
      browser,
      close: async () => {
        const session = await browser.newBrowserCDPSession();
        await session.send("Browser.close").catch(() => {});
      },
    };
  }
}

async function main() {
  const only = process.argv[2];
  const selected = only ? { [only]: SCENARIOS[only] } : SCENARIOS;
  if (only && !SCENARIOS[only]) {
    console.error(`Escenario desconocido "${only}". Disponibles: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
  }
  mkdirSync(SHOTS, { recursive: true });

  const stopDev = await ensureDevServer();
  const { browser, close } = await launchBrowser();
  let failures = 0;
  try {
    for (const [name, scenario] of Object.entries(selected)) {
      console.log(`\n▶ ${name}`);
      const shot = (page, file) => page.screenshot({ path: `${SHOTS}/${file}.png` });
      const check = async (label, fn) => {
        try {
          const note = await fn();
          console.log(`  ✅ ${label}${note ? ` (${note})` : ""}`);
        } catch (e) {
          failures++;
          console.log(`  ❌ ${label}: ${String(e.message).split("\n")[0]}`);
        }
      };
      try {
        await scenario({ browser, check, shot });
      } catch (e) {
        failures++;
        console.log(`  ❌ El escenario se cortó: ${String(e.message).split("\n")[0]}`);
      }
    }
  } finally {
    await close();
    stopDev();
  }
  console.log(failures ? `\n${failures} chequeo(s) fallaron. Capturas en ${SHOTS}/` : `\nTodo OK. Capturas en ${SHOTS}/`);
  process.exit(failures ? 1 : 0);
}

await main();
