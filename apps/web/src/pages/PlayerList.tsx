import type { PlayerStatus, PublicPlayer } from "@mg/shared";

const STATUS_LABEL: Record<PlayerStatus, string> = {
  noTracks: "sin captura",
  extracting: "leyendo captura…",
  ready: "listo",
  invalid: "captura inválida",
  error: "error al leer",
};

export function PlayerList({ players, meId }: { players: PublicPlayer[]; meId?: string }) {
  if (players.length === 0) return <p className="muted">Todavía no hay jugadores.</p>;
  return (
    <ul className="players">
      {players.map((p) => (
        <li key={p.id} className={p.connected ? "" : "disconnected"} data-status={p.status}>
          {p.name}
          {p.id === meId && " (vos)"}
          <span className={`status status-${p.status}`}>
            {" · "}
            {STATUS_LABEL[p.status]}
            {p.status === "ready" && ` (${p.trackCount} canciones)`}
          </span>
          {!p.connected && " · desconectado"}
        </li>
      ))}
    </ul>
  );
}
