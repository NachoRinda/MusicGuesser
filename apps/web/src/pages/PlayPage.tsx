import {
  MAX_NAME_LENGTH,
  MAX_SCREENSHOTS_PER_UPLOAD,
  ROOM_CODE_LENGTH,
  ROOM_ERROR_MESSAGES,
  extractionProblemMessage,
  type MyVote,
  type PlayerTracks,
  type RoomState,
} from "@mg/shared";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { PhoneGame } from "../game/PhoneGame.js";
import { prepareScreenshot } from "../images.js";
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
  const [myTracks, setMyTracks] = useState<PlayerTracks | null>(null);
  const [myVote, setMyVote] = useState<MyVote | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on("room:state", setRoom);
    socket.on("player:tracks", setMyTracks);
    socket.on("player:myVote", setMyVote);
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

  const me = room?.players.find((p) => p.id === playerId);

  if (room && room.phase !== "lobby" && room.game && socketRef.current && playerId) {
    return <PhoneGame room={room} socket={socketRef.current} meId={playerId} myVote={myVote} />;
  }

  return (
    <main className="center">
      <h1>¡Hola, {me?.name ?? "…"}!</h1>
      {socketRef.current && <Screenshots socket={socketRef.current} tracks={myTracks} />}
      {room && <PlayerList players={room.players} meId={playerId ?? undefined} />}
    </main>
  );
}

/** Upload 1–2 screenshots and see (read-only) what was read from them. */
function Screenshots({ socket, tracks }: { socket: AppSocket; tracks: PlayerTracks | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = tracks?.status ?? "noTracks";

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = ""; // so picking the same files again still triggers a change
    if (files.length === 0) return;
    if (files.length > MAX_SCREENSHOTS_PER_UPLOAD) return setError(ROOM_ERROR_MESSAGES.INVALID_UPLOAD);
    setSending(true);
    setError(null);
    try {
      const images = await Promise.all(files.map(prepareScreenshot));
      const res = await socket.emitWithAck("player:uploadScreenshots", { images });
      if (!res.ok) setError(ROOM_ERROR_MESSAGES[res.error]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos subir la captura");
    } finally {
      setSending(false);
    }
  }

  const busy = sending || status === "extracting";
  return (
    <section className="screenshots">
      {status === "noTracks" && <Instructions />}
      {status === "extracting" && <p className="muted">Leyendo tus canciones…</p>}
      {status === "ready" && <p className="ok">¡Listo! Leímos {tracks!.tracks.length} canciones. Esperá a que la TV empiece.</p>}
      {(status === "invalid" || status === "error") && tracks?.problem && (
        <p className="error">{extractionProblemMessage(tracks.problem, tracks.tracks.length)}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={upload}
        aria-label="Elegir capturas"
      />
      <button onClick={() => inputRef.current?.click()} disabled={busy}>
        {sending ? "Subiendo…" : status === "noTracks" ? "Subir capturas" : "Reintentar captura"}
      </button>
      {error && <p className="error">{error}</p>}

      {tracks && tracks.tracks.length > 0 && (
        <ol className="tracks">
          {tracks.tracks.map((t, i) => (
            <li key={i}>
              <strong>{t.title}</strong> — {t.artist}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Instructions() {
  return (
    <div className="instructions">
      <p>
        Subí <strong>2 capturas</strong> de tu playlist de <strong>más escuchadas</strong>: una arriba de todo y otra
        después de bajar un poco.
      </p>
      <ul>
        <li>
          <strong>Spotify</strong>: buscá “En repetición” (On Repeat)
        </li>
        <li>
          <strong>YouTube Music</strong>: “Mix de repetición” (Replay Mix)
        </li>
        <li>
          <strong>Apple Music</strong>: tu “Replay” del año
        </li>
      </ul>
      <p className="muted">Entre las dos se tienen que ver al menos 10 canciones. Elegilas juntas.</p>
    </div>
  );
}
