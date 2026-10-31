# Spec 03 — Extracción de capturas (Claude vision)

**Estado: aprobado** (2026-10-31). Decisión al aprobar: se acepta **cualquier playlist** (no solo las de "más escuchadas"); solo se rechaza lo que no es una playlist.

## Objetivo
Reemplazar las canciones falsas por las reales: cada jugador sube 1–2 capturas de su playlist autogenerada de "más escuchadas", un modelo con visión extrae título y artista, y el jugador queda **listo** cuando hay al menos 10 canciones válidas. La TV muestra quién está listo y solo deja empezar con ≥ 3 jugadores listos.

## Comportamiento
### Subir capturas (celular)
- En el lobby, el jugador ve instrucciones cortas por plataforma (Spotify *On Repeat / En repetición*, YouTube Music *Replay Mix / Mix de repetición*, Apple Music *Replay*) y un botón "Subir capturas" (`<input type="file" accept="image/*" multiple>`; en el celular abre la galería).
- Se aceptan **1 o 2 imágenes** por envío (JPEG, PNG o WebP). Más de 2 → error claro sin enviar.
- Antes de enviar, el cliente reduce cada imagen a lo sumo a 2000 px de lado y la recomprime a JPEG si pesa más de 4 MB (las capturas largas de celular superan los límites de la API). Imágenes chicas se envían tal cual.
- Mientras se procesa: "Leyendo tus canciones…" (estado `extracting`). Se puede seguir en la pantalla; el resultado llega solo.

### Resultado
- **Válida con ≥ 10 canciones** → estado `ready`. El jugador ve la lista leída (**solo lectura**, sin editar ni borrar) y un botón "Reintentar captura".
- **Válida con < 10 canciones** → estado `invalid`: "Leímos N canciones, necesitamos al menos 10. Subí otra captura que muestre más (podés mandar 2)". Se muestra lo leído.
- **No es una playlist** (una foto, un chat, la pantalla de inicio) → estado `invalid`: "Esa captura no parece una playlist" + recordatorio de dónde encontrar la de más escuchadas. Una playlist cualquiera se acepta (las instrucciones igual piden la de más escuchadas).
- **Falla técnica** (API caída, timeout de 60 s, sin API key) → estado `error`: "No pudimos leer la captura, probá de nuevo".
- "Reintentar captura" **reemplaza** todas las canciones del jugador por las del nuevo envío (nunca se mezclan envíos: el jugador no puede ir eligiendo qué entra).
- Con 2 capturas en el mismo envío, las canciones se unen y se quitan duplicados (comparación sin mayúsculas, acentos ni espacios extra en título + artista). Se conserva el orden de aparición.
- Si una de las 2 capturas es válida y la otra no, el envío se rechaza entero (`invalid`), para no aceptar una mezcla dudosa.
- Mientras un envío está en `extracting`, un segundo envío se rechaza con `EXTRACTION_IN_PROGRESS`.

### TV
- La lista de jugadores muestra el estado de cada uno: sin captura / leyendo… / listo (con cantidad de canciones) / captura inválida / error. **No muestra las canciones** (se revelan durante el juego).
- "Empezar" habilitado con **≥ 3 jugadores conectados y listos**. Nuevo error `NOT_ENOUGH_READY_PLAYERS`.
- Al empezar, los jugadores que no están listos quedan afuera de la partida (en su celular: "La partida empezó sin vos: no tenías canciones listas"). Se siguen viendo en la lista atenuados.

### Extracción (servidor)
- Interfaz `Extractor` inyectable: `extract(images: ImageInput[]) → Promise<ExtractionResult>`. Implementaciones:
  - `ClaudeExtractor`: un solo request a la API de Claude con las 1–2 imágenes, modelo `claude-opus-5-5`, salida estructurada (JSON schema) con `{ isPlaylist: boolean, platform: "spotify" | "youtube_music" | "apple_music" | "other" | null, tracks: { title, artist }[] }` por imagen. El prompt pide transcribir exactamente lo visible (sin completar ni inventar canciones cortadas a medias) e indicar si la imagen es una lista de canciones de una app de música.
  - `FakeExtractor` (para tests, playtest y desarrollo sin API key): determinístico según marcadores en los bytes de la imagen (`MG-INVALID` → no es playlist, `MG-FEW` → 5 canciones, `MG-ERROR` → falla; si no, 12 canciones del pool falso).
- Selección por variable de entorno: `MG_EXTRACTOR=fake` usa el falso; si no, `ClaudeExtractor` con `ANTHROPIC_API_KEY`. Sin key y sin `fake` → el server arranca con una advertencia y cada envío termina en `error`.
- Tamaño máximo por envío: 2 imágenes × 5 MB (límite de Socket.IO `maxHttpBufferSize` ajustado a 12 MB).
- **Privacidad**: las imágenes viven solo en memoria durante el request; nunca se escriben a disco ni se loguean (ni su contenido ni su base64). Tras la extracción se descartan; solo quedan las canciones.

### Canciones falsas
- Se eliminan del flujo de `join` (el jugador arranca sin canciones). `FAKE_TRACK_POOL` queda en `packages/shared` para el `FakeExtractor` y los tests de fases 4–5.

## Contrato (en `packages/shared`)
- `PlayerStatus = "noTracks" | "extracting" | "ready" | "invalid" | "error"`.
- `PublicPlayer` suma `status` y `trackCount` (nunca las canciones).
- Nuevo evento cliente→server `player:uploadScreenshots({ images: { mediaType, data: ArrayBuffer }[] }, ack)` → ack inmediato `Result<object>` (aceptado o error de validación); el resultado llega después.
- Nuevo evento server→jugador `player:tracks({ status, tracks, message? })`, enviado solo a los sockets de ese jugador (al terminar la extracción y al reconectarse).
- Errores nuevos: `NOT_ENOUGH_READY_PLAYERS`, `EXTRACTION_IN_PROGRESS`, `INVALID_UPLOAD` (0 o > 2 imágenes, tipo no soportado, demasiado grande), con mensaje en español.
- La lógica de validación del resultado (dedupe, mínimo 10, rechazo) es pura (`evaluateExtraction`) y separada del extractor y de Socket.IO.

## Eval de extracción (con la API real)
- `npm run eval:extraction` recorre `fixtures/screenshots/*.{png,jpg,webp}` con su `*.expected.json` (`{ isPlaylist, tracks }`), llama a `ClaudeExtractor` y reporta por captura: clasificación correcta, recall y precisión de canciones (comparación normalizada).
- **Meta**: clasificación correcta en el 100 % de los fixtures; recall ≥ 90 % y precisión ≥ 95 % promedio.
- No forma parte de `verify` (cuesta plata y necesita API key).
- **Necesita fixtures reales**: al menos 3 capturas de "más escuchadas" (idealmente de plataformas distintas) + 1 captura que no sea playlist. Las aportás vos; yo armo los `expected.json` y vos los revisás.

## Casos borde
- Captura larga (scroll) de celular de 1080×6000 → se reduce en el cliente y se lee bien.
- Jugador recarga durante `extracting` → al volver ve el estado actual y recibe el resultado cuando termine.
- Jugador sube capturas después de que la partida empezó → rechazado (`GAME_ALREADY_STARTED`).
- Canción con título o artista cortado ("Bzrp Music Sessions, Vo…") → el modelo la transcribe tal cual se ve; no la inventa ni la descarta en silencio.
- La misma canción en las 2 capturas (solapamiento al hacer scroll) → aparece una sola vez.

## Criterios de aceptación
- [ ] `evaluateExtraction`: dedupe normalizado, mínimo 10, rechazo de lo que no es playlist, rechazo de envío mixto (tests unitarios).
- [ ] `RoomStore`: estados del jugador, reemplazo de canciones al reintentar, `EXTRACTION_IN_PROGRESS`, `start` exige 3 listos y conectados, jugadores no listos quedan fuera (tests unitarios).
- [ ] Integración por sockets con `FakeExtractor`: subir → `extracting` → `ready` difundido a la TV y `player:tracks` solo al dueño; validaciones de `INVALID_UPLOAD`.
- [ ] `ClaudeExtractor` arma el request correcto y mapea la respuesta (test con el cliente de Anthropic mockeado); errores de API → `error`.
- [ ] El estado difundido nunca incluye canciones ni tokens.
- [ ] Ninguna ruta de código escribe imágenes a disco ni las loguea (revisión + test que espía `console`).
- [ ] Escenario `capturas` en `npm run playtest`: 3 celulares suben capturas (uno inválido y luego reintenta), la TV ve los estados y empieza.
- [ ] Eval con la API real sobre los fixtures cumple la meta.
- [ ] Prueba manual: subir tu captura real desde tu celular.

## Fuera de alcance
Modos de juego, audio Deezer, matching de canciones entre jugadores (fase 5), pulido visual, deploy.
