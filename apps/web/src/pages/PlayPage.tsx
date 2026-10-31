import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH, ROOM_ERROR_MESSAGES, type RoomState } from "@mg/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { navigate } from "../router.js";
import { createSocket, type AppSocket } from "../socket.js";
import { playerTokenKey, storage } from "../storage.js";
import { PlayerList } from "./PlayerList.js";

type Status = "connecting" | "needName" | "joined" | "noRoom";

export function PlayPage({ code }: { code?: string }) {
  if (!code) return <CodeForm />;
  return <RoomView code={code} />;
}

function CodeForm() {
  const [code, setCode] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean) navigate(`/play/${clean}`);
  }
  return (
    <main className="center">
      <h1>Unirme a una sala</h1>
      <form onSubmit={submit}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Código"
          maxLength={ROOM_CODE_LENGTH}
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus
        />
        <button type="submit">Entrar</button>
      </form>
    </main>
  );
}

function RoomView({ code }: { code: string }) {
  const socketRef = useRef<AppSocket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on("room:state", setRoom);
    // On every (re)connection, come back as the same player if we have a token for this room.
    socket.on("connect", async () => {
      const token = storage.get(playerTokenKey(code));
      if (!token) return setStatus((s) => (s === "connecting" ? "needName" : s));
      const res = await socket.emitWithAck("player:resume", { code, playerToken: token });
      if (res.ok) {
        setPlayerId(res.playerId);
        setStatus("joined");
      } else if (res.error === "ROOM_NOT_FOUND") {
        storage.remove(playerTokenKey(code));
        setStatus("noRoom");
      } else {
        storage.remove(playerTokenKey(code));
        setStatus("needName");
      }
    });
    return () => {
      socket.disconnect();
    };
  }, [code]);

  async function join(e: FormEvent) {
    e.preventDefault();
    const socket = socketRef.current;
    if (!socket) return;
    const res = await socket.emitWithAck("player:join", { code, name });
    if (res.ok) {
      storage.set(playerTokenKey(code), res.playerToken);
      setPlayerId(res.playerId);
      setError(null);
      setStatus("joined");
    } else if (res.error === "ROOM_NOT_FOUND") {
      setStatus("noRoom");
    } else {
      setError(ROOM_ERROR_MESSAGES[res.error]);
    }
  }

  if (status === "connecting") return <main className="center">Conectando…</main>;

  if (status === "noRoom") {
    return (
      <main className="center">
        <p className="error">{ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND}</p>
        <button onClick={() => navigate("/play")}>Probar otro código</button>
      </main>
    );
  }

  if (status === "needName") {
    return (
      <main className="center">
        <h1>Sala {code}</h1>
        <form onSubmit={join}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre"
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            autoFocus
          />
          <button type="submit" disabled={!name.trim()}>
            Entrar
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  if (room?.phase === "playing") {
    return (
      <main className="center">
        <h1>¡Arrancamos!</h1>
      </main>
    );
  }

  const me = room?.players.find((p) => p.id === playerId);
  return (
    <main className="center">
      <h1>¡Hola, {me?.name ?? "…"}!</h1>
      <p className="muted">Esperando a que la TV empiece la partida.</p>
      {room && <PlayerList players={room.players} meId={playerId ?? undefined} />}
    </main>
  );
}
