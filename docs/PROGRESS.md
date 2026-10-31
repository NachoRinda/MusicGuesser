# Progreso

## Estado actual
- **Fase 3 — Extracción de capturas: implementada, sin cerrar** (2026-10-31). Código, tests (88) y playtest (26/26) en verde. **Falta para el tag `fase-3`**: correr `npm run eval:extraction` con capturas reales y credencial, y la prueba manual con un celular.
- **Playtest automatizado**: `npm run playtest` (escenarios `sala` y `capturas`). Usa `MG_EXTRACTOR=fake`.
- **Próximo paso**: (1) el usuario pone en `fixtures/screenshots/` ≥ 3 capturas de "más escuchadas" (idealmente Spotify/YT Music/Apple) + 1 que no sea playlist; (2) armar los `*.expected.json` y que el usuario los revise; (3) `ANTHROPIC_API_KEY` en `.env` y `npm run eval:extraction`; (4) prueba manual; (5) tag `fase-3` y spec 04.

## Fases
| # | Fase | Estado |
|---|---|---|
| 1 | Scaffolding, CLAUDE.md, GAME_DESIGN.md, hook de verificación | ✅ |
| 2 | Sala en tiempo real con datos falsos | ✅ |
| 3 | Extracción de capturas (Claude vision) | 🟡 falta eval real + prueba manual |
| 4 | Modo "¿De quién es?" + audio Deezer | — |
| 5 | Modo "¿Cuántos la tienen?" + matching | — |
| 6 | Pulido y deploy | — |

## Decisiones
- **Fuente de datos = capturas + visión**, no APIs de streaming. Spotify Dev Mode limita a 5 usuarios y desde feb-2026 no devuelve canciones de playlists ajenas; Last.fm solo registra desde que se conecta (exige preparación); elegir canciones a mano rompe la autenticidad.
- Stack: TypeScript, npm workspaces, Express + Socket.IO, Vite + React, vitest.
- Estado de salas en memoria, sin base de datos.
- Respuestas de socket por *ack* tipado (`Result<T>`), no por eventos de error sueltos. `room:state` se difunde completo tras cada cambio.
- Conexión contada por sockets (no booleano): al recargar, el socket nuevo puede conectar antes de que caiga el viejo.
- Se acepta **cualquier playlist** (no solo "más escuchadas"); solo se rechaza lo que no es una playlist. Decisión del usuario al aprobar el spec 03: menos falsos rechazos; las instrucciones igual piden la de más escuchadas.
- Extracción con `claude-opus-5-5`, salida estructurada (JSON schema), `effort: low`, `fallbacks: "default"`. Un request por envío (1–2 imágenes).
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
- `npm run playtest` (`scripts/playtest.mjs`): escenarios por fase, levanta/apaga el dev server, usa Chromium de Playwright o cae al Chrome de Windows headless vía CDP. ~20 s, 15/15 OK.

### 2026-10-31 — Fase 3 (implementación)
- Spec 03 escrito y aprobado (con el cambio de aceptar cualquier playlist).
- Lógica pura con TDD: `evaluateExtraction` + `trackKey` (dedupe sin mayúsculas/acentos/espacios, mínimo 10, rechazo de envío mixto), `validateUpload`, estados del jugador en `RoomStore` (`noTracks → extracting → ready | invalid | error`, reintentar reemplaza, `start` exige 3 listos y conectados, los no listos quedan con `inGame: false`).
- `Extractor` inyectable: `ClaudeExtractor` (SDK `@anthropic-ai/sdk` 1.3.0, cliente mockeado en tests) y `FakeExtractor` determinístico por marcadores en los bytes (`MG-INVALID`, `MG-FEW`, `MG-ERROR`).
- Sockets: `player:uploadScreenshots` (ack inmediato) y `player:tracks` privado (room Socket.IO `player:<id>`). Timeout de 60 s. Test que espía `console` para verificar que no se loguean imágenes.
- Web: subir capturas (achica/recomprime en el celular), estados, lista solo lectura, "Reintentar captura"; la TV muestra estado y cantidad, nunca canciones.
- Playtest: escenario `capturas` (11 checks) y `sala` actualizado (los jugadores suben captura antes de empezar). 26/26 OK.
- `npm run eval:extraction` listo; **no se corrió**: no hay fixtures ni credencial en este entorno. Tampoco se pudo hacer una llamada real a la API: la forma del request (fallbacks + structured outputs + imágenes) solo está verificada contra los tipos del SDK y el mock.

