import { rankOf, type PlayerPoints, type PublicPlayer, type PlayerScore } from "@mg/shared";

export function nameOf(players: PublicPlayer[], id: string | null | undefined): string {
  return players.find((p) => p.id === id)?.name ?? "?";
}

/** Ranking with shared places for ties and, optionally, this round's points. */
export function Scoreboard({
  scores,
  players,
  roundPoints,
  meId,
}: {
  scores: PlayerScore[];
  players: PublicPlayer[];
  roundPoints?: PlayerPoints[];
  meId?: string;
}) {
  return (
    <ol className="scoreboard">
      {scores.map((s) => {
        const gained = roundPoints?.find((p) => p.playerId === s.playerId)?.points ?? 0;
        return (
          <li key={s.playerId} className={s.playerId === meId ? "me" : ""} data-player={nameOf(players, s.playerId)}>
            <span className="place">{rankOf(scores, s.playerId)}.</span>
            <span className="name">{nameOf(players, s.playerId)}</span>
            <span className="score">{s.score}</span>
            {roundPoints && gained > 0 && <span className="gained">+{gained}</span>}
          </li>
        );
      })}
    </ol>
  );
}
