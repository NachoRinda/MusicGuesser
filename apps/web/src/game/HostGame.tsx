import type { RoomState } from "@mg/shared";
import { useEffect, useRef, useState } from "react";
import type { AppSocket } from "../socket.js";
import { nameOf, Scoreboard } from "./Scoreboard.js";
import { TrackCard } from "./TrackCard.js";
import { useCountdown } from "./useCountdown.js";

/** TV during a game: the question (with audio), the three reveal stages, and the final ranking. */
export function HostGame({ room, socket }: { room: RoomState; socket: AppSocket }) {
  const game = room.game!;
  const left = useCountdown(game.remainingMs, room);
  const players = room.players.filter((p) => p.inGame);
  const finished = room.phase === "finished";

  return (
    <main className="host-game">
      <Audio url={finished ? null : game.track.previewUrl} />
      {finished ? (
        <section className="center">
          <h1>¡Terminó!</h1>
          <Scoreboard scores={game.scores} players={room.players} />
          <button onClick={() => void socket.emitWithAck("host:playAgain")}>Jugar otra vez</button>
        </section>
      ) : (
        <>
          <header className="round-header">
            <span>
              Ronda {game.round} de {game.totalRounds}
            </span>
            <span className="countdown" aria-label="segundos restantes">
              {left}
            </span>
          </header>
          <TrackCard track={game.track} big />
          {!game.track.previewUrl && <p className="muted small">sin audio</p>}

          {game.stage === "question" && (
            <section>
              <h2>¿De quién es?</h2>
              <ul className="vote-status">
                {players.map((p) => (
                  <li key={p.id} className={game.voted.includes(p.id) ? "voted" : ""}>
                    {game.voted.includes(p.id) ? "✓ " : ""}
                    {p.name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {game.stage === "owners" && game.reveal && (
            <section className="reveal-owners">
              <h2>La escuchan</h2>
              <p className="owners">{game.reveal.owners.map((id) => nameOf(room.players, id)).join(", ")}</p>
              {game.reveal.ownerPoints > 0 && <p className="ok">¡Nadie los descubrió! +{game.reveal.ownerPoints}</p>}
            </section>
          )}

          {game.stage === "votes" && game.reveal && (
            <section>
              <h2>Votos</h2>
              <ul className="votes">
                {game.reveal.votes.map((v) => (
                  <li key={v.voterId} className={v.correct ? "correct" : "wrong"}>
                    {nameOf(room.players, v.voterId)}
                    {v.targetId ? ` → ${nameOf(room.players, v.targetId)} ${v.correct ? "✓" : "✗"}` : " — no votó"}
                    {v.points > 0 && <span className="gained"> +{v.points}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {game.stage === "ranking" && (
            <section>
              <h2>Así va</h2>
              <Scoreboard scores={game.scores} players={room.players} roundPoints={game.reveal?.points} />
            </section>
          )}

          {game.stage !== "question" && (
            <button onClick={() => void socket.emitWithAck("host:next")}>Siguiente</button>
          )}
        </>
      )}
    </main>
  );
}

/** Plays the round's preview on the TV; offers a button if the browser blocks autoplay. */
function Audio({ url }: { url: string | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    if (!url) {
      audio.pause();
      audio.removeAttribute("src");
      return;
    }
    audio.src = url;
    audio.play().then(
      () => setBlocked(false),
      (err: unknown) => setBlocked(err instanceof DOMException && err.name === "NotAllowedError"),
    );
  }, [url]);

  return (
    <>
      <audio ref={ref} />
      {blocked && (
        <button
          className="unmute"
          onClick={() => void ref.current?.play().then(() => setBlocked(false), () => setBlocked(true))}
        >
          🔊 Tocá para activar el sonido
        </button>
      )}
    </>
  );
}
