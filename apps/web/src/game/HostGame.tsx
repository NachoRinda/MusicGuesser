import type { RoomState } from "@mg/shared";
import { useEffect, useRef, useState } from "react";
import type { AppSocket } from "../socket.js";
import { nameOf, Scoreboard } from "./Scoreboard.js";
import { StageTimer } from "./StageTimer.js";
import { TrackCard } from "./TrackCard.js";
import { useCountdown } from "./useCountdown.js";

/** TV during a game: the question (with audio), the three reveal stages, and the final ranking. */
export function HostGame({ room, socket }: { room: RoomState; socket: AppSocket }) {
  const game = room.game!;
  const leftMs = useCountdown(game.remainingMs, room);
  const players = room.players.filter((p) => p.inGame);
  const finished = room.phase === "finished";

  return (
    <main className={`host-game stage-${finished ? "finished" : game.stage}`}>
      <Audio url={finished ? null : game.track.previewUrl} />
      {finished ? (
        <section className="center">
          <h1>¡Terminó!</h1>
          <Scoreboard scores={game.scores} players={room.players} bars />
          <button onClick={() => void socket.emitWithAck("host:playAgain")}>Jugar otra vez</button>
        </section>
      ) : (
        <>
          <header className="round-header">
            Ronda {game.round} de {game.totalRounds}
          </header>
          <TrackCard track={game.track} big={game.stage === "question"} />
          {!game.track.previewUrl && <p className="muted small">sin audio</p>}

          {game.stage === "question" && (
            <section className="stage-panel">
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
            <section className="stage-panel reveal-owners">
              <h2>La escuchan</h2>
              <div className="owners">
                {game.reveal.owners.map((id) => (
                  <span key={id} className="owner-card">
                    {nameOf(room.players, id)}
                  </span>
                ))}
              </div>
              {game.reveal.ownerPoints > 0 && <p className="hidden-bonus">¡Nadie los descubrió! +{game.reveal.ownerPoints}</p>}
            </section>
          )}

          {game.stage === "votes" && game.reveal && (
            <section className="stage-panel">
              <h2>Votos</h2>
              <ul className="votes">
                {game.reveal.votes.map((v) => (
                  <li key={v.voterId} className={v.correct ? "correct" : "wrong"}>
                    <span className="vote-icon">{v.correct ? "✓" : "✗"}</span>
                    <span>
                      <strong>{nameOf(room.players, v.voterId)}</strong>
                      {v.targetId ? ` → ${nameOf(room.players, v.targetId)}` : " no votó"}
                    </span>
                    {v.points > 0 && <span className="gained">+{v.points}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {game.stage === "ranking" && (
            <section className="stage-panel">
              <h2>Así va</h2>
              <Scoreboard scores={game.scores} players={room.players} roundPoints={game.reveal?.points} bars />
            </section>
          )}

          <StageTimer stage={game.stage} leftMs={leftMs} />
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
