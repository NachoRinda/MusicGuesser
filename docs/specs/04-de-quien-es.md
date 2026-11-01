# Spec 04 — Modo "¿De quién es?" + audio Deezer

**Estado: aprobado** (2026-10-31). Implementado y cerrado 2026-11-01 (tag `fase-4`). Cambios del usuario al aprobar: no se excluye ninguna canción (aunque la tengan todos, hay que jugársela por otro); la revelación tiene 3 etapas de 10 s (dueños → votos → ranking). Confirmados: título/artista visibles desde el principio, 5/10/15 rondas, voto definitivo, puntaje propuesto.

## Objetivo
Primera partida jugable de punta a punta: con ≥ 3 jugadores listos, el host elige cuántas rondas y empieza; en cada ronda la TV muestra y hace sonar (preview de 30 s de Deezer) una canción de alguno de los jugadores, todos votan desde el celular de quién es, se revela quién la escucha y quién votó a quién, se suman puntos, y al final hay ranking y "Jugar otra vez".

## Comportamiento

### Antes de empezar (TV)
- Bajo la lista de jugadores: modo **"¿De quién es?"** (único por ahora; la fase 5 agrega el otro) y selector de rondas **5 / 10 / 15** (default 10).
- "Empezar" igual que en la fase 3 (≥ 3 conectados y listos). El clic en "Empezar" además desbloquea el audio del navegador de la TV.

### Elección de canciones (servidor, lógica pura)
- Pool: las canciones de los jugadores que juegan (`inGame`). Una canción **pertenece** a todos los jugadores que la tienen (comparación con `trackKey`: sin mayúsculas, acentos ni espacios extra. El matching difuso queda para la fase 5).
- **No se excluye ninguna canción**, aunque la tengan todos: igual hay que votar a otro (no votar da 0 y uno no puede votarse a sí mismo).
- Reparto parejo: se recorre a los jugadores en orden aleatorio, en ronda, y de cada uno se toma una canción suya al azar no usada todavía. Así cada jugador "aparece" una cantidad similar de veces.
- Rondas = mín(elegidas, canciones disponibles). Ninguna canción se repite en la partida.
- `random` inyectable para tests.

### Ronda — pregunta
- **TV**: "Ronda N de M", tapa del disco, **título y artista** (decisión a confirmar: se muestran desde el principio; el juego es saber qué escucha cada uno, no reconocer la canción de oído), audio, cuenta regresiva y la lista de jugadores con ✓ en quienes ya votaron (sin mostrar a quién).
- **Celular**: título y artista + un botón por cada **otro** jugador de la partida (el propio no aparece). Un toque = voto, **definitivo** (no se cambia). Después: "Votaste a X. Esperando al resto…".
- El dueño vota igual que todos (si votara distinto o no votara, se delataría): puede votar a otro que crea que también la tiene. El celular no indica "es tuya".
- **Duración**: 45 s (30 s de preview + 15 s, como dice el game design). Termina antes si votaron todos los jugadores de la partida que están conectados.
- Un jugador desconectado no bloquea el cierre; si vuelve durante la pregunta, puede votar.

### Ronda — revelación (3 etapas de 10 s cada una)
1. **Dueños** (`owners`): TV "La escuchan: Ana, Beto" (destacados).
2. **Votos** (`votes`): TV cada voto ("Juan → Ana ✓", "Caro → Beto ✗", "Dani — no votó") y los puntos ganados en la ronda.
3. **Ranking** (`ranking`): TV la tabla de puntajes después de la ronda.
- El audio sigue sonando durante la revelación.
- **Celular**: desde la etapa 1, "¡Acertaste! +130" / "No, era de Ana y Beto" / "Nadie te descubrió: +100"; en la etapa 3, su puesto.
- Cada etapa avanza **sola a los 10 s**; el host puede tocar "Siguiente" para pasar a la siguiente etapa (o ronda).

### Puntaje (lógica pura)
- **Voto correcto** (votó a alguno de los dueños): **100 + bonus de velocidad** de hasta 50, lineal con el tiempo restante: `round(50 × restante / 45 s)`.
- **Voto incorrecto o sin voto**: 0. Nunca se restan puntos.
- **Dueño no descubierto**: si ningún jugador que *no* es dueño acertó, cada dueño suma **+100**. (Que un co-dueño vote al otro co-dueño cuenta como acierto suyo, pero no "descubre" a nadie.) Si la tienen **todos** no hay a quién esconderse: no hay bonus de dueño.
- Ranking: por puntaje; empates comparten puesto.

### Audio (Deezer)
- Interfaz `MusicCatalog` inyectable: `lookup(track) → Promise<{ previewUrl, coverUrl } | null>`.
  - `DeezerCatalog`: `GET https://api.deezer.com/search?q=<artista> <título>&limit=10` (sin auth). Elige el primer resultado cuyo título y artista coinciden normalizados (el título puede tener sufijos como "(feat. …)" o " - Remastered"); si ninguno coincide, el primero cuyo artista coincide; si no, `null`. Timeout de 4 s; error → `null`.
  - `FakeCatalog` para tests y playtest: sin red, devuelve `null` (o una URL fija si se le pide).
  - Selección: `MG_CATALOG=fake`, si no Deezer. El playtest usa el falso.
- **Las URLs de preview vencen a los ~15 min** (verificado: `hdnea=exp=…`), así que se buscan al preparar cada ronda: la de la ronda 1 al empezar y la siguiente mientras se juega la actual. No se cachean las URLs; sí el "no encontrado" por `trackKey` durante la vida del server.
- La búsqueda nunca demora una ronda más de 4 s: si no llegó, la ronda arranca sin audio.
- **Sin preview**: la ronda se juega igual con título/artista y un aviso chico "sin audio".
- El audio suena **solo en la TV** (`<audio>` apuntando directo al CDN de Deezer; no hace falta CORS). Si el navegador bloquea el autoplay (p. ej. la TV recargó a mitad de partida), aparece "🔊 Tocá para activar el sonido".

### Final
- **TV**: ranking final con puntos y botón **"Jugar otra vez"** → vuelve al lobby con los mismos jugadores, sus canciones y su estado (siguen listos; pueden reintentar captura). Puntajes en 0.
- **Celular**: su puesto y puntaje.
- Durante la partida no se pueden sumar jugadores (`GAME_ALREADY_STARTED`, como hoy); en el lobby de "Jugar otra vez" sí.

### Desconexiones
- TV o celular que recarga durante la partida recibe el estado actual (ronda, tiempo restante, su voto si ya votó) y sigue.
- Los timers viven en el servidor: la partida avanza aunque la TV esté desconectada.
- Si la sala se borra por TTL (host ausente 30 min), se cancelan sus timers.

## Contrato (en `packages/shared`)
- `RoomPhase = "lobby" | "playing" | "finished"`.
- `RoomState` suma `game?: GameView` (presente en `playing` y `finished`) y `settings: { rounds: 5 | 10 | 15 }`.
- `GameView`:
  - `round`, `totalRounds`, `stage: "question" | "owners" | "votes" | "ranking"`.
  - `track: { title, artist, coverUrl: string | null, previewUrl: string | null }`.
  - `remainingMs` (tiempo restante de la etapa al momento del envío; el cliente cuenta localmente).
  - `voted: string[]` (ids que ya votaron) durante la pregunta.
  - `reveal?: { owners: string[], votes: { voterId, targetId: string | null, correct: boolean, points: number }[], ownerPoints: number, points: { playerId, points }[] }` **solo** en las etapas de revelación.
  - `scores: { playerId, score }[]`.
- **Durante la pregunta el estado difundido no incluye dueños ni a quién votó cada uno** (los celulares también reciben `room:state`).
- Eventos nuevos:
  - `host:settings({ rounds }, ack)` — solo en lobby.
  - `host:next(ack)` — pasa a la siguiente etapa de revelación (o ronda).
  - `host:playAgain(ack)` — de `finished` a `lobby`.
  - `player:vote({ targetId }, ack)` — `Result<object>`.
  - Server → jugador `player:myVote({ round, targetId })` privado (al votar y al reconectarse), para que el celular muestre su voto sin difundirlo.
- Errores nuevos: `NOT_IN_GAME` (no juega esta partida), `ALREADY_VOTED`, `INVALID_VOTE` (a sí mismo, a alguien que no juega, fuera de la etapa de pregunta), `NOT_PLAYING` (acción de partida fuera de `playing`), con mensaje en español.
- Lógica pura separada de Socket.IO y de timers: `pickRounds(players, count, random)`, `scoreRound(owners, votes, durationMs)`, y una máquina de estados de partida (`Game`) con reloj inyectable; el socket layer solo agenda los timeouts y difunde.

## Cambios al implementar
- **La ronda no espera a Deezer**: arranca enseguida y el audio (y la tapa) aparecen en cuanto llega la búsqueda (≤ 4 s). Así ninguna ronda se demora y no hace falta una etapa "preparando".
- La búsqueda avanzada de Deezer (`artist:"…" track:"…"`) no devolvió resultados en las pruebas reales; se usa la búsqueda común `q=<artista> <título>` y se filtra por coincidencia. Verificado en vivo: Bad Bunny, Bizarrap (título cortado con "…" y crédito "Bizarrap, Shakira"), Miley Cyrus y Soda Stereo encontradas; una inexistente → `null`.
- **Búsquedas de respaldo en Deezer** (tras la prueba manual): Deezer solo devuelve resultados que contienen *todas* las palabras de la búsqueda, así que una palabra de más ("Santaferia, Chico Trujillo Haciendo Nada") da 0 resultados aunque la canción exista. Se prueba en orden: texto completo → artista principal + título sin paréntesis/feat. → título solo (filtrando por artista). Artistas comparados sin espacios ni puntuación ("BoB" = "B.o.B"). Cada canción sin preview se loguea con su texto y las búsquedas probadas (solo título/artista, nunca imágenes).
- Error extra `INVALID_SETTINGS` (rondas fuera de 5/10/15).
- `reveal.points` (puntos de la ronda por jugador) para mostrar "+N" en el ranking.
- `GET /health` informa también `catalog: "fake" | "deezer"`; el playtest levanta el server con `MG_CATALOG=fake` (sin red).
- Si todos tienen la canción, el celular del dueño no muestra "Te descubrieron" (no había a quién esconderse).

## Ajustes de diseño tras la prueba manual (2026-11-01, aprobados por el usuario)
- **TV, etapas bien distintas** (no solo el título): cada etapa tiene su propio fondo y composición.
  - Pregunta: fondo neutro, la canción grande.
  - Dueños: fondo violeta, los nombres de los dueños como tarjetas gigantes, la canción chica.
  - Votos: fondo oscuro, una tarjeta por jugador, verde (acertó) o roja (falló / no votó), con "+N".
  - Ranking: fondo azul, tabla con barras proporcionales al puntaje y "+N" de la ronda.
- **Celular, resultado estilo Kahoot**: en las etapas de dueños y votos, la pantalla entera se pone **verde con ✓** si el jugador sumó puntos en la ronda (acertó o no lo descubrieron) y **roja con ✗** si no, con el texto del resultado. En la etapa de ranking vuelve a neutro con su puesto.
- **Timer por etapa**: se quita el contador global de arriba. Cada etapa muestra su propio timer con etiqueta y barra que se vacía: "Tiempo para votar" (pregunta), "Siguiente en" (revelación). En el celular, el timer va junto a los botones de voto.

## Canciones sin audio se descartan (2026-11-01, aprobado por el usuario)
Tras la prueba manual hubo rondas sin audio. Causas: "Nothin' on You (con Bruno Mars) — B.o.B" no se encontraba por la palabra "con" (arreglado con las búsquedas de respaldo); "Haciendo Nada — Santaferia" sí se encontraba, así que fue una falla momentánea sin reintento (no quedó registro).
- **Al tocar "Empezar"** el server busca en Deezer las canciones antes de arrancar. La TV muestra "Preparando canciones…" (botón deshabilitado); mientras tanto no se puede subir capturas, unirse ni cambiar las rondas (`GAME_ALREADY_STARTED`).
- Se mantiene el reparto parejo: se arman los turnos por jugador como antes y, si la canción de un turno **no está en Deezer**, se prueba otra del mismo jugador (si ya no le quedan, de cualquier otro). Una canción descartada no vuelve a usarse.
- Si la búsqueda de una canción **falla por red o timeout** (Deezer caído, sin internet), la canción se juega **sin audio**, como antes: mejor jugar sin audio que no poder jugar.
- Se buscan de a 4 canciones en paralelo (Deezer limita a 50 pedidos cada 5 s).
- Si ninguna canción tiene audio y ninguna falló por red, "Empezar" responde `NO_PLAYABLE_TRACKS` ("No encontramos el audio de ninguna canción").
- **Antes de cada ronda** se pide de nuevo la URL del preview por el id de Deezer (`GET /track/{id}`), porque vencen a los ~15 min: la de la ronda siguiente se pide al empezar la actual. Si ese pedido falla, la ronda usa la URL obtenida al preparar (puede seguir vigente).
- Contrato: `RoomState.starting?: true` mientras se prepara. `MusicCatalog.lookup(track)` devuelve `found` (con `ref` = id de Deezer, preview y tapa), `notFound` o `error`; `MusicCatalog.preview(ref)` da una URL fresca o `null`.
- `FakeCatalog` (playtest) responde `error` por defecto: el playtest sigue jugando sin audio, ejercitando ese camino.

## Casos borde
- Menos canciones distintas que rondas elegidas → se juegan tantas rondas como canciones distintas haya.
- Canción que tienen todos → se juega; acierta quien vote a cualquier otro.
- Nadie vota → todos 0; si la canción tiene dueño(s), ganan +100 por no ser descubiertos.
- Voto que llega después del cierre (carrera con el timer) → `INVALID_VOTE`, no cuenta.
- Un jugador que no juega esta partida (no estaba listo) ve la partida como espectador en su celular, sin botones.
- Deezer devuelve otra versión (en vivo, remix) → se acepta: preferimos que suene algo del artista. Si el artista no coincide, sin audio.

## Criterios de aceptación
- [x] `pickRounds`: reparto parejo, sin repetidos, no excluye canciones, dueños múltiples por `trackKey`, determinístico con `random` fijo (tests unitarios).
- [x] `scoreRound`: acierto + bonus, incorrecto/sin voto 0, dueño no descubierto +100, co-dueños (tests unitarios).
- [x] Máquina de partida: pregunta → dueños → votos → ranking (10 s c/u) → siguiente → final; cierre anticipado cuando votaron todos los conectados; validaciones de voto; "Jugar otra vez" conserva jugadores y canciones y resetea puntajes (tests unitarios con reloj falso).
- [x] `DeezerCatalog`: arma la URL, elige el resultado correcto, `null` ante error/timeout/sin match (fetch mockeado). Una búsqueda real verificada a mano.
- [x] Integración por sockets: partida completa de 3 jugadores con etapas cortas (400/60 ms, timers reales); el estado de la pregunta no filtra dueños ni votos; `player:myVote` solo al votante; reconexión a mitad de ronda.
- [x] Escenario `de-quien-es` en `npm run playtest`: TV + 3 celulares juegan una partida de 5 rondas (votos, revelación, ranking final, jugar otra vez).
- [x] Prueba manual con el celular del usuario y audio real de Deezer en la TV (2026-11-01).

## Fuera de alcance
Modo "¿Cuántos la tienen?" y matching difuso (fase 5), animaciones y pulido visual, deploy, volumen/controles de audio, elegir qué parte de la canción suena.
