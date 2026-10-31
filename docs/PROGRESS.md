# Progreso

## Estado actual
- **Fase 2 — Sala en tiempo real: completa** (2026-10-31), tag `fase-2`.
- **Próximo paso**: escribir spec 03 (extracción de capturas). `GAME_DESIGN.md` ya resolvió "mínimo 10 canciones" y "captura inválida → no puede estar listo" (aplica a fase 3).

## Fases
| # | Fase | Estado |
|---|---|---|
| 1 | Scaffolding, CLAUDE.md, GAME_DESIGN.md, hook de verificación | ✅ |
| 2 | Sala en tiempo real con datos falsos | ✅ |
| 3 | Extracción de capturas (Claude vision) | — |
| 4 | Modo "¿De quién es?" + audio Deezer | — |
| 5 | Modo "¿Cuántos la tienen?" + matching | — |
| 6 | Pulido y deploy | — |

## Decisiones
- **Fuente de datos = capturas + visión**, no APIs de streaming. Spotify Dev Mode limita a 5 usuarios y desde feb-2026 no devuelve canciones de playlists ajenas; Last.fm solo registra desde que se conecta (exige preparación); elegir canciones a mano rompe la autenticidad.
- Stack: TypeScript, npm workspaces, Express + Socket.IO, Vite + React, vitest.
- Estado de salas en memoria, sin base de datos.
- Respuestas de socket por *ack* tipado (`Result<T>`), no por eventos de error sueltos. `room:state` se difunde completo tras cada cambio.
- Conexión contada por sockets (no booleano): al recargar, el socket nuevo puede conectar antes de que caiga el viejo.
- Router propio mínimo (`apps/web/src/router.ts`) en vez de react-router: solo hay 3 rutas.

## Bitácora
### 2026-10-31 — Fase 1
- Monorepo `packages/shared`, `apps/server`, `apps/web`.
- `GET /health` con test de integración (server en puerto 0).
- Vite proxy a `:3000` y `host: true` para acceder desde celulares.
- Hook Stop `scripts/stop-verify.mjs` (typecheck + tests; exit 2 si falla). Probado con un test que falla a propósito.
- Subagentes `.claude/agents/playtester.md` y `game-mode-designer.md`.
- Nota: npm bloqueó el postinstall de esbuild (opcional); `vite build` funciona igual.

### 2026-10-31 — Fase 2
- Contrato en `packages/shared/src/room.ts` (`RoomState`, eventos, códigos de error + mensajes en español) y `fakeTracks.ts` (30 canciones; cada jugador recibe 10 al azar, así hay solapamiento para la fase 5).
- `RoomStore` puro en `apps/server/src/rooms/` con reloj y random inyectables; 27 tests unitarios (códigos, nombres, reconexión, fases, TTL de 30 min, sin tokens en el estado).
- `socketHandlers.ts` + 9 tests de integración con `socket.io-client` (host + 3 jugadores en < 1 s, desconexión/reconexión, start, errores).
- `GET /api/network` → IP LAN para el QR. El sweep de salas vencidas corre cada 60 s.
- Web: `/host` (código, QR, lista, Empezar), `/play` (tipear código), `/play/:code` (nombre → lobby → "¡Arrancamos!"). Tokens en `localStorage`.
- Smoke test manual por script contra `npm run dev` (vía proxy de Vite): crear, 3 joins, start → OK.
- **WSL2**: la IP detectada es la de la VM (172.x) y el celular no llega. Para probar con celulares: `LAN_HOST=<IP-WiFi-de-Windows> npm run dev` y además exponer el puerto 5173 de WSL a la LAN (modo de red `mirrored` en `.wslconfig`, o `netsh interface portproxy` + regla de firewall).
- Configurado `networkingMode=mirrored` en `C:\Users\USUARIO\.wslconfig` (2026-10-31) + regla de Hyper-V firewall para TCP 5173. Con mirrored, WSL ve las interfaces reales de Windows; si la IP detectada no es la del WiFi (Ethernet, VPN, adaptadores virtuales), usar `LAN_HOST`.
- Prueba manual: el usuario probó con su celular por WiFi (QR → unirse → lobby), todo OK. Al no tener más celulares, el resto del flujo se probó con Playwright: TV + 3 "celulares" (contextos iPhone con `localStorage` separado), 15/15 checks del spec 02 OK. Capturas en `test-results/playtest/`.
- **Playwright en WSL**: el Chromium de Playwright no arranca porque le faltan librerías de sistema (`libnspr4`) y `npx playwright install-deps` necesita sudo con terminal. Alternativa usada sin sudo: lanzar el Chrome de Windows headless con `--remote-debugging-port=9222` y `chromium.connectOverCDP("http://localhost:9222")` (funciona gracias al modo mirrored). Para usar el Chromium propio: correr `sudo npx playwright install-deps chromium` en una terminal.
