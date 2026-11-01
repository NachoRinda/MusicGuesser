# Progreso

## Estado actual
- **Fase 4 — "¿De quién es?" + audio Deezer: completa** (2026-11-01), tag `fase-4`. Tests 138, playtest 40/40, prueba manual del usuario OK (celular + audio real).
- Fase 3 — Extracción de capturas: completa (2026-10-31), tag `fase-3`.
- **Playtest automatizado**: `npm run playtest` (escenarios `sala`, `capturas` y `de-quien-es`). Usa `MG_EXTRACTOR=fake` y `MG_CATALOG=fake`.
- **Próximo paso**: que el usuario pruebe los ajustes de diseño de la fase 4; después spec 05 (pulido y deploy). La música de tensión queda pendiente (ver "Feedback pendiente"). Pendiente opcional: un fixture de Apple Music.

## Fases
| # | Fase | Estado |
|---|---|---|
| 1 | Scaffolding, CLAUDE.md, GAME_DESIGN.md, hook de verificación | ✅ |
| 2 | Sala en tiempo real con datos falsos | ✅ |
| 3 | Extracción de capturas (Claude vision) | ✅ |
| 4 | Modo "¿De quién es?" + audio Deezer | ✅ |
| 5 | Pulido y deploy | — |

## Backlog (sin fase asignada)
- Modo **"¿Cuántos la tienen?"** — descripción en `docs/GAME_DESIGN.md` → "Backlog de modos".
- **Matching difuso** de canciones entre jugadores (hoy se compara con `trackKey`: sin mayúsculas, acentos ni espacios extra). Iba junto con ese modo; también mejoraría la detección de dueños en "¿De quién es?".

## Feedback pendiente (prueba manual fase 4, 2026-11-01)
- Música de tensión de uso libre cuando termina el preview de Deezer (30 s), para que no quede en silencio. A decidir: pista real con licencia (fase 6) o loop generado con Web Audio.
- (Hechos el 2026-11-01: etapas distintas en la TV, celular verde/rojo, timer por etapa.)

## Decisiones
- **Fuente de datos = capturas + visión**, no APIs de streaming. Spotify Dev Mode limita a 5 usuarios y desde feb-2026 no devuelve canciones de playlists ajenas; Last.fm solo registra desde que se conecta (exige preparación); elegir canciones a mano rompe la autenticidad.
- Stack: TypeScript, npm workspaces, Express + Socket.IO, Vite + React, vitest.
- Estado de salas en memoria, sin base de datos.
- Respuestas de socket por *ack* tipado (`Result<T>`), no por eventos de error sueltos. `room:state` se difunde completo tras cada cambio.
- Conexión contada por sockets (no booleano): al recargar, el socket nuevo puede conectar antes de que caiga el viejo.
- Se acepta **cualquier playlist** (no solo "más escuchadas"); solo se rechaza lo que no es una playlist. Decisión del usuario al aprobar el spec 03: menos falsos rechazos; las instrucciones igual piden la de más escuchadas.
- Extracción con **`claude-haiku-5-5`** (igualó a Opus 5.5 en el eval a ~1/35 del costo: ~US$0,0004 por captura, así que US$5 alcanzan para miles de envíos), salida estructurada (JSON schema), `effort: low`. Un request por envío (1–2 imágenes). Opus con `MG_EXTRACTION_MODEL=claude-opus-5-5`.
- La API de Anthropic es aparte de Claude Pro: el usuario cargó US$5 de crédito prepago (2026-10-31); la key está en `.env` (no se commitea).
- **Partida "¿De quién es?"** (spec 04, cambios del usuario al aprobar): no se excluye ninguna canción (aunque la tengan todos); la revelación tiene 3 etapas de 10 s (dueños → votos → ranking). Puntaje: acierto 100 + hasta 50 por velocidad; dueño no descubierto +100.
- **Deezer**: las canciones que no están en Deezer se descartan al tocar "Empezar" (la TV muestra "Preparando canciones…", ~1,5 s para 15). Si la búsqueda falla por red, esa canción se juega sin audio. Las URLs de preview vencen a los ~15 min → la de la ronda siguiente se renueva por id de Deezer mientras suena la actual.
- **El modo "¿Cuántos la tienen?" sale del plan de fases** (2026-11-01, decisión del usuario): queda en el backlog junto con el matching difuso. "Pulido y deploy" pasa a ser la fase 5.
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

### 2026-10-31 — Fase 3 (eval real)
- El usuario aportó 5 capturas (Spotify con/sin encabezado, YT Music con/sin encabezado, DMs de Instagram como no-playlist); `expected.json` armados por Claude y revisados por el usuario. Imágenes fuera de git.
- Ajustes de prompt antes de medir: excluir mini-reproductor y badges. El eval tolera `...` ≡ `…`.
- Resultado: Opus 5.5 y Haiku 5.5 → 5/5 clasificación, 100 % recall y precisión. Haiku 3 corridas estables, ~2 s por captura, US$0,002 las 5. Pares reales vía `evaluateExtraction`: 14 y 17 canciones → ready; par con no-playlist → invalid.
- Default cambiado a Haiku. Instrucciones del celular piden 2 capturas (una sola con encabezado trae 4–7 canciones).
- Prueba manual: el usuario subió capturas reales desde su celular por WiFi → lista leída y "listo" en la TV. Fase cerrada.

### 2026-11-01 — Fase 4 (implementación)
- Spec 04 escrito y aprobado con cambios del usuario (no excluir canciones; revelación en 3 etapas de 10 s).
- Lógica pura con TDD: `pickRounds` (reparto parejo por jugador, dueños por `trackKey`), `scoreRound`, `Game` (etapas, votos, cierre anticipado, `advanceIf(seq)` contra timers viejos, reloj inyectable). `RoomStore` integra settings, partida y "Jugar otra vez".
- `MusicCatalog`: `DeezerCatalog` (fetch inyectable, timeout 4 s, recuerda solo los "no encontrado") y `FakeCatalog`. Búsqueda real verificada a mano.
- Sockets: `host:settings`, `host:next`, `host:playAgain`, `player:vote`, `player:myVote` privado. Timers en el socket layer (uno por sala, etiquetado con partida + etapa). Test de integración con etapas cortas (400/60 ms): partida completa de 5 rondas.
- Web: TV (selector de rondas, pregunta con audio y ✓ de quién votó, 3 etapas de revelación, final, "Jugar otra vez", botón para desbloquear el audio) y celular (votar, resultado, puesto, espectador).
- Playtest `de-quien-es` 14/14; `sala` y `capturas` actualizados (40/40 en total). Un test de sockets falló una vez por timing (miraba solo el último estado); se arregló con un cursor sobre todos los estados recibidos y pasó 8/8 bajo carga de CPU.
- **No probado todavía**: audio real de Deezer sonando en un navegador (el playtest usa el catálogo falso) ni el desbloqueo de autoplay en la TV.

### 2026-11-01 — Ajustes de diseño fase 4
- Feedback de la prueba manual, agregado al spec 04 ("Ajustes de diseño…"): cada etapa de revelación con fondo y composición propios (dueños violeta con tarjetas, votos oscuro con tarjetas verde/roja, ranking azul con barras); celular a pantalla completa verde ✓ si sumó puntos en la ronda, rojo ✗ si no; timer por etapa con etiqueta y barra ("Tiempo para votar" / "Siguiente en"), sin contador global.
- Playtest `de-quien-es` con 4 chequeos nuevos (18/18; 44/44 en total).
- `npm run playtest` se puede correr junto a un `npm run dev` propio: `PORT` también define el proxy de Vite y `MG_PLAYTEST_URL` cambia la URL (p. ej. server `PORT=3100` + `vite --port 5180`).

### 2026-11-01 — Canciones sin audio
- Reporte del usuario: 2 rondas sin audio. Diagnóstico contra Deezer real: "Nothin' on You (con Bruno Mars) — B.o.B" no se encontraba porque Deezer exige todas las palabras ("con") → búsquedas de respaldo (completa → artista principal + título limpio → título solo). "Haciendo Nada — Santaferia" sí se encontraba: fue una falla momentánea sin reintento (no había log).
- Spec 04 actualizado y aprobado: descartar canciones sin audio. `pickPlayableRounds` (reemplaza por otra del mismo jugador, 4 búsquedas en paralelo, falla de red → se juega sin audio), `RoomStore.beginStart/completeStart` (`starting`, `NO_PLAYABLE_TRACKS`), `DeezerCatalog.preview(ref)` vía `/track/{id}`, errores de Deezer con HTTP 200 (cuota) tratados como error, log de cada canción sin preview.
- Verificado con Deezer real: 15 canciones (2 inventadas) → 13 rondas con audio en 1,5 s; renovación por id OK. Tests 157, playtest 44/44.
