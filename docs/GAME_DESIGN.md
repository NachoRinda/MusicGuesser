# Game Design — MusicGuesser

> Fuente de verdad de reglas y flujo. La edita el dueño del proyecto; los agentes la consultan y proponen cambios, no los imponen.

## Idea
Adivinar qué tan bien conocés a tus amigos a través de la música que realmente escuchan.

## Principios
1. **Dato auténtico** — sale de una playlist autogenerada por la plataforma; el jugador no la elige ni la edita.
2. **Llegar y jugar** — escanear QR, poner nombre, subir captura. Sin cuentas.
3. **Sin tope de jugadores** — sin dependencias de APIs con allowlist.
4. **Rejugable** — las playlists de "más escuchadas" cambian semana a semana.

## Pantallas
- **TV (`/host`)**: crea la sala, muestra QR + código de 4 letras, lista de jugadores, preguntas, audio (preview de 30s vía Deezer), revelaciones y ranking.
- **Celular (`/play/:code`)**: unirse con nombre, subir 1–2 capturas, ver lo leído (solo lectura, con "reintentar captura"), votar.

## Flujo de una partida
1. Host crea sala → aparece QR/código.
2. Jugadores se unen y suben capturas. La TV muestra quién está listo.
3. Host elige modo y empieza (mínimo 3 jugadores listos — *a confirmar*).
4. Rondas con timer (los segundos de la música y luego unos 15 segundos para votar) → revelación (se muestra los que realmente la escuchan y a quien voto cada uno) → puntajes.
5. Ranking final. "Jugar otra vez" mantiene la sala y los jugadores.

## Fuentes de captura aceptadas
| Plataforma | Dónde |
|---|---|
| Spotify | Buscar "On Repeat" / "En repetición" |
| YouTube Music | "Replay Mix" / "Mix de repetición" |
| Apple Music | "Replay" del año |

## Modos
### 1. ¿De quién es?
- Suena una canción (o se muestra título/artista si no hay preview).
- Todos votan a quién pertenece. El dueño no puede votarse a sí mismo, pero si cree que alguien más lo tiene puede votar por alguien más.
- Si varios jugadores la tienen, cualquiera de ellos es respuesta correcta.
- Puntaje: *a definir en el spec de la fase 4* (propuesta: +100 acierto, bonus por velocidad; el dueño gana puntos si nadie acierta).

### 2. ¿Cuántos la tienen?
- Se muestra una canción presente en al menos un jugador; cada uno adivina cuántos de la sala la tienen.
- Puntaje: *a definir en el spec de la fase 5*.

### Ideas futuras
- Match musical entre pares (% de canciones/artistas en común).
- ¿Quién es más mainstream?

## Preguntas abiertas y respuestas cuando se resuelvan
- Cantidad mínima de canciones por jugador para estar "listo". Respuesta: Al menos 10 canciones.
- Qué hacer si un jugador sube una captura que no es una playlist válida. Respuesta: Se le avisa que no es válida, no se puede poner en modo "listo" hasta que no se hayan parseado bien las canciones que subió, no puede jugar sin estar "listo".
