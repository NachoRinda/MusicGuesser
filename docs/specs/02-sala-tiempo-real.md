# Spec 02 — Sala en tiempo real (con datos falsos)

**Estado: aprobado** (2026-10-31). Implementado 2026-10-31; contrato ampliado al implementar (ver "Cambios al implementar").

## Objetivo
Que una TV cree una sala y varios celulares se unan y se vean en un lobby sincronizado en tiempo real, sin todavía capturas ni modos de juego. Al final, el host puede "empezar" y todos pasan a una pantalla placeholder de juego.

## Comportamiento
### Crear sala (TV)
- `/host` crea una sala automáticamente al abrir y muestra:
  - Código de 4 letras (alfabeto sin letras ambiguas: sin `I`, `O`, `0`, `1`), único entre las salas activas.
  - QR que apunta a `http://<IP-de-red-local>:<puerto>/play/<CODE>` (no a `localhost`, para que funcione desde el celular). El server expone su IP de red local.
  - Lista de jugadores con estado conectado/desconectado.
  - Botón "Empezar" habilitado con ≥ 3 jugadores conectados.
- Si la TV recarga la página, recupera la misma sala (token de host en `localStorage`).

### Unirse (celular)
- `/play/<CODE>` pide un nombre (1–20 caracteres, sin espacios al borde) y entra al lobby.
- `/play` sin código permite tipear el código.
- Nombre único dentro de la sala (sin distinguir mayúsculas). Si se repite → error claro.
- Código inexistente → "No existe la sala".
- Se puede unir mientras la sala está en lobby; si ya empezó → "La partida ya empezó" (fase 2; reingreso de jugadores existentes sí se permite).

### Reconexión
- Al unirse, el jugador recibe un `playerToken` guardado en `localStorage`. Si recarga o pierde conexión, vuelve automáticamente como el mismo jugador.
- Un jugador desconectado aparece atenuado en la TV; no se borra de la sala.

### Datos falsos
- Cada jugador que se une recibe una lista de 10 canciones falsas (de un set fijo en `packages/shared`), para que las fases 4–5 puedan desarrollarse antes de la extracción real.

### Empezar
- Host toca "Empezar" → estado de sala `lobby → playing`. TV y celulares muestran "¡Arrancamos!" (placeholder).

### Ciclo de vida
- La sala se elimina tras 30 min sin el host conectado.

## Contrato (en `packages/shared`)
- `RoomState`: `{ code, phase: "lobby" | "playing", players: { id, name, connected }[] }` (sin tokens ni canciones en lo que se difunde a todos).
- Eventos cliente→server: `host:create`, `host:resume`, `host:start`, `player:join`, `player:resume`.
- Evento server→clientes: `room:state` (estado completo tras cada cambio), y errores tipados (`ROOM_NOT_FOUND`, `NAME_TAKEN`, `GAME_ALREADY_STARTED`, `INVALID_NAME`, `NOT_ENOUGH_PLAYERS`, `INVALID_TOKEN`, `NOT_AUTHORIZED`).
- Las respuestas a cada evento cliente→server llegan por *ack* de Socket.IO como `Result<T>` (`{ ok: true, ... }` o `{ ok: false, error }`).
- `GET /api/network` → `{ lanHost }` para armar el QR.
- Lógica de sala como módulo puro (`RoomStore`) separado de Socket.IO, para testearla sin red.

## Cambios al implementar
- `INVALID_TOKEN`: `host:resume`/`player:resume` con token desconocido o de otra sala. El cliente lo usa para "tratar como nuevo" (host crea sala nueva; jugador vuelve a pedir nombre).
- `NOT_AUTHORIZED`: `host:start` desde un socket que no es el host de la sala.
- IP de red local: se detecta la primera IPv4 no interna; la variable de entorno `LAN_HOST` la reemplaza (necesario bajo WSL2).

## Casos borde
- Dos celulares con el mismo nombre en simultáneo → solo uno entra.
- Host recarga a mitad del lobby → mismos jugadores.
- Jugador cierra la pestaña y vuelve 5 min después → mismo jugador.
- Token inválido o de otra sala → se trata como jugador nuevo.

## Criterios de aceptación
- [x] Códigos de 4 letras, del alfabeto definido y únicos entre salas activas.
- [x] 3 celulares se unen y la TV los muestra en < 1 s.
- [x] Nombre duplicado y sala inexistente muestran el error correspondiente.
- [x] Recargar un celular o la TV conserva la identidad.
- [x] "Empezar" deshabilitado con < 3 jugadores; con 3 pasa a todos a `playing`.
- [x] Unirse con nombre nuevo durante `playing` es rechazado.
- [x] Sala sin host por 30 min se elimina (test con reloj simulado).
- [x] El estado difundido nunca incluye tokens.

## Tests
> Criterios marcados = cubiertos por tests automáticos. La UI (recarga real del navegador, QR desde el celular) queda para la prueba manual.

- **Unit (`RoomStore`)**: generación de códigos, unir/nombres/errores, reconexión por token, transición de fase, TTL con fake timers, que `RoomState` no filtre tokens.
- **Integración (socket.io-client + server en puerto 0)**: host + 3 jugadores, desconexión/reconexión, start.
- **Manual (vos, ~5 min)**:
  1. `npm run dev`, abrir `/host` en la PC.
  2. Escanear el QR con 2–3 celulares en la misma red WiFi.
  3. Ver aparecer los nombres; recargar un celular; recargar la TV.
  4. Probar un nombre repetido.
  5. Empezar.

## Fuera de alcance
Capturas, modos de juego, audio, estilos finales, deploy.
