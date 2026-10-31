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
  await check("Con 3 jugadores, Empezar se habilita", async () => {
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

const SCENARIOS = { sala };

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
  if ((await isUp(`${BASE}/health`)) && (await isUp(`${BASE}/host`))) return () => {};
  console.log("Levantando npm run dev…");
  const dev = spawn("npm", ["run", "dev"], { detached: true, stdio: "ignore" });
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
