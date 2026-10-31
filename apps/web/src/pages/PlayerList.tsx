import type { PublicPlayer } from "@mg/shared";

export function PlayerList({ players, meId }: { players: PublicPlayer[]; meId?: string }) {
  if (players.length === 0) return <p className="muted">Todavía no hay jugadores.</p>;
  return (
    <ul className="players">
      {players.map((p) => (
        <li key={p.id} className={p.connected ? "" : "disconnected"}>
          {p.name}
          {p.id === meId && " (vos)"}
          {!p.connected && " · desconectado"}
        </li>
      ))}
    </ul>
  );
}
