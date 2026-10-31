# MusicGuesser

Party game web: una pantalla compartida (TV, `/host`) y los celulares de los jugadores (`/play/:code`). Cada jugador sube capturas de su playlist autogenerada de "más escuchadas" (Spotify *On Repeat*, YouTube Music *Replay Mix*, Apple Music *Replay*…); un modelo con visión extrae las canciones y se juega a adivinar de quién es cada canción.

Principios de producto (no negociables, ver `docs/GAME_DESIGN.md`):
- **Dato auténtico**: el jugador nunca elige ni edita qué canciones aparecen.
- **Llegar y jugar**: cero preparación previa, sin cuentas ni OAuth.
- **Sin tope de jugadores** y **rejugable**.

## Al empezar cada sesión
1. Leer `docs/PROGRESS.md` (estado actual, decisiones, próximo paso).
2. Leer el spec de la fase en curso en `docs/specs/`.
3. Al terminar: actualizar `docs/PROGRESS.md`.

## Flujo de trabajo
- **Spec antes que código**: cada fase tiene `docs/specs/NN-nombre.md` con criterios de aceptación. No implementar una fase cuyo spec no esté marcado `Estado: aprobado`. Si la implementación necesita cambiar el comportamiento, actualizar el spec primero y avisar.
- **TDD en lógica pura** (matching, puntajes, rondas, estado de sala): test primero.
- **Commits** pequeños, solo con `npm run verify` en verde. Tag `fase-N` al cerrar una fase.
- Un hook Stop (`scripts/stop-verify.mjs`) corre typecheck + tests al final de cada turno. Si falla, arreglar o informar honestamente; nunca desactivarlo para "pasar".

## Comandos
- `npm run dev` — server (`:3000`) + web (Vite `:5173`, expuesto en la red local)
- `npm run verify` — typecheck + lint + tests (definición de "verde")
- `npm test` / `npm run test:watch` — vitest
- `npm run build` — build del cliente

## Estructura
- `packages/shared` — tipos y contratos compartidos (eventos de socket, `Track`, `Player`…). Todo tipo que cruce cliente↔servidor vive acá.
- `apps/server` — Node + Express + Socket.IO. `createAppServer()` en `src/app.ts` no escucha puerto (los tests lo levantan en puerto 0). Estado de salas en memoria.
- `apps/web` — Vite + React.
- `fixtures/screenshots` — capturas reales + `*.expected.json` para el eval de extracción.
- `docs/` — `GAME_DESIGN.md` (reglas), `PROGRESS.md` (bitácora), `specs/` (por fase).

## Convenciones
- TypeScript estricto, ESM, imports con extensión `.js`.
- Tests junto al código: `foo.ts` → `foo.test.ts`.
- APIs externas (Anthropic, Deezer) se mockean en tests; solo el eval de extracción usa las reales.
- **Privacidad**: las imágenes subidas nunca se escriben a disco ni se loguean; se procesan en memoria y se descartan.
- Antes de tocar código que llame a la API de Claude, cargar la skill `claude-api`.
- Textos de UI en español.
