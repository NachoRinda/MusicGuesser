import {
  MIN_PLAYERS_TO_START,
  ROOM_ERROR_MESSAGES,
  ROUND_OPTIONS,
  type NetworkInfo,
  type RoomState,
  type RoundsSetting,
} from "@mg/shared";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { HostGame } from "../game/HostGame.js";
import { createSocket, type AppSocket } from "../socket.js";
import { HOST_TOKEN_KEY, storage } from "../storage.js";
import { PlayerList } from "./PlayerList.js";

export function HostPage() {
  const socketRef = useRef<AppSocket | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const joinUrl = useJoinUrl(room?.code);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on("room:state", setRoom);
    // Runs on the first connection and on every reconnection: resume our room, or create one.
    socket.on("connect", async () => {
      const token = storage.get(HOST_TOKEN_KEY);
      const resumed = token ? await socket.emitWithAck("host:resume", { hostToken: token }) : null;
      const res = resumed?.ok ? resumed : await socket.emitWithAck("host:create");
      if (res.ok) storage.set(HOST_TOKEN_KEY, res.hostToken);
      else setError(ROOM_ERROR_MESSAGES[res.error]);
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  async function start() {
    const res = await socketRef.current?.emitWithAck("host:start");
    setError(res && !res.ok ? ROOM_ERROR_MESSAGES[res.error] : null);
  }

  async function setRounds(rounds: RoundsSetting) {
    const res = await socketRef.current?.emitWithAck("host:settings", { rounds });
    setError(res && !res.ok ? ROOM_ERROR_MESSAGES[res.error] : null);
  }

  if (!room) return <main className="center">Creando sala…</main>;

  if (room.phase !== "lobby" && room.game && socketRef.current) {
    return <HostGame room={room} socket={socketRef.current} />;
  }

  const connected = room.players.filter((p) => p.connected).length;
  const ready = room.players.filter((p) => p.connected && p.status === "ready").length;
  return (
    <main className="host">
      <section className="join">
        <p>Entrá desde tu celular</p>
        <div className="code">{room.code}</div>
        {joinUrl && <QrImage text={joinUrl} />}
        {joinUrl && <p className="muted">{joinUrl}</p>}
      </section>
      <section>
        <h2>
          Jugadores ({connected}) · listos: {ready}
        </h2>
        <PlayerList players={room.players} />
        <div className="settings">
          <p>
            Modo: <strong>¿De quién es?</strong>
          </p>
          <p role="group" aria-label="Rondas">
            Rondas:{" "}
            {ROUND_OPTIONS.map((n) => (
              <button
                key={n}
                className={room.settings.rounds === n ? "selected" : ""}
                aria-pressed={room.settings.rounds === n}
                onClick={() => void setRounds(n)}
              >
                {n}
              </button>
            ))}
          </p>
        </div>
        <button onClick={start} disabled={ready < MIN_PLAYERS_TO_START}>
          Empezar
        </button>
        {ready < MIN_PLAYERS_TO_START && (
          <p className="muted">
            Se necesitan al menos {MIN_PLAYERS_TO_START} jugadores listos (con su captura leída).
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

/** URL phones open: uses the server's LAN IP instead of localhost, keeping the page's port (Vite in dev). */
function useJoinUrl(code: string | undefined): string | null {
  const [lanHost, setLanHost] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/network")
      .then((res) => res.json() as Promise<NetworkInfo>)
      .then((info) => setLanHost(info.lanHost))
      .catch(() => setLanHost(null));
  }, []);
  if (!code) return null;
  const host = lanHost ?? location.hostname;
  const port = location.port ? `:${location.port}` : "";
  return `${location.protocol}//${host}${port}/play/${code}`;
}

function QrImage({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 280 }).then(setSrc, () => setSrc(null));
  }, [text]);
  return src ? <img className="qr" src={src} alt={`QR para unirse: ${text}`} /> : null;
}
