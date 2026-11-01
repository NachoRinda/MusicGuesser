import { ROOM_ERROR_MESSAGES, rankOf, type MyVote, type RoomState } from "@mg/shared";
import { useState } from "react";
import type { AppSocket } from "../socket.js";
import { nameOf, Scoreboard } from "./Scoreboard.js";
import { StageTimer } from "./StageTimer.js";
import { TrackCard } from "./TrackCard.js";
import { useCountdown } from "./useCountdown.js";

/** Phone during a game: vote buttons, then this player's result, place and the final ranking. */
export function PhoneGame({
  room,
  socket,
  meId,
  myVote,
}: {
  room: RoomState;
  socket: AppSocket;
  meId: string;
  myVote: MyVote | null;
}) {
  const game = room.game!;
  const leftMs = useCountdown(game.remainingMs, room);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = room.players.find((p) => p.id === meId);
  const myScore = game.scores.find((s) => s.playerId === meId)?.score ?? 0;
  const place = rankOf(game.scores, meId);

  if (room.phase === "finished") {
    return (
      <main className="center">
        <h1>¡Terminó!</h1>
        {me?.inGame && (
          <p className="result">
            Quedaste {place}° con {myScore} puntos
          </p>
        )}
        <Scoreboard scores={game.scores} players={room.players} meId={meId} />
        <p className="muted">Mirá la TV: el host puede arrancar otra.</p>
      </main>
    );
  }

  const header = (
    <header className="round-header">
      Ronda {game.round}/{game.totalRounds}
    </header>
  );

  if (!me?.inGame) {
    return (
      <main className="center">
        {header}
        <StageTimer stage={game.stage} leftMs={leftMs} />
        <p className="muted">La partida empezó sin vos: no tenías canciones listas. Mirá la TV.</p>
        <TrackCard track={game.track} />
      </main>
    );
  }

  async function vote(targetId: string) {
    setSending(true);
    const res = await socket.emitWithAck("player:vote", { targetId });
    setSending(false);
    setError(res.ok ? null : ROOM_ERROR_MESSAGES[res.error]);
  }

  if (game.stage === "question") {
    const voted = myVote?.round === game.round ? myVote.targetId : null;
    const others = room.players.filter((p) => p.inGame && p.id !== meId);
    return (
      <main className="center">
        {header}
        <TrackCard track={game.track} />
        {voted ? (
          <p className="muted">Votaste a {nameOf(room.players, voted)}. Esperando al resto…</p>
        ) : (
          <>
            <h2>¿De quién es?</h2>
            <StageTimer stage={game.stage} leftMs={leftMs} />
            <div className="vote-buttons">
              {others.map((p) => (
                <button key={p.id} disabled={sending} onClick={() => void vote(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  const reveal = game.reveal!;
  const mine = reveal.votes.find((v) => v.voterId === meId);
  const isOwner = reveal.owners.includes(meId);
  const ownerNames = reveal.owners.map((id) => nameOf(room.players, id)).join(" y ");
  const gained = reveal.points.find((p) => p.playerId === meId)?.points ?? 0;

  if (game.stage === "ranking") {
    return (
      <main className="center">
        {header}
        <p className="result">
          Vas {place}° con {myScore} puntos
        </p>
        {gained > 0 && <p className="ok">+{gained} en esta ronda</p>}
        <StageTimer stage={game.stage} leftMs={leftMs} />
      </main>
    );
  }

  // Owners and votes stages: the whole screen says how the round went (green: scored, red: didn't).
  const won = gained > 0;
  return (
    <main className={`center outcome ${won ? "outcome-win" : "outcome-lose"}`} data-outcome={won ? "win" : "lose"}>
      {header}
      <div className="outcome-icon" aria-hidden>
        {won ? "✓" : "✗"}
      </div>
      <div className="result">
        {mine?.correct && <p>¡Acertaste! +{mine.points}</p>}
        {!mine?.correct && !isOwner && (
          <p>
            {mine?.targetId ? "No" : "No votaste"}, era de {ownerNames}
          </p>
        )}
        {isOwner && reveal.ownerPoints > 0 && <p>Nadie te descubrió: +{reveal.ownerPoints}</p>}
        {isOwner && reveal.ownerPoints === 0 && reveal.owners.length < game.scores.length && <p>Te descubrieron</p>}
        {isOwner && !mine?.correct && reveal.owners.length === game.scores.length && <p>La tienen todos: había que votar a otro</p>}
      </div>
      <TrackCard track={game.track} />
      <StageTimer stage={game.stage} leftMs={leftMs} />
    </main>
  );
}
