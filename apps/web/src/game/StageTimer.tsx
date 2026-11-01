import { QUESTION_MS, REVEAL_STAGE_MS, type GameStage } from "@mg/shared";

/** The current stage's own timer: what it counts down to, seconds left and a draining bar. */
export function StageTimer({ stage, leftMs }: { stage: GameStage; leftMs: number }) {
  const total = stage === "question" ? QUESTION_MS : REVEAL_STAGE_MS;
  const label = stage === "question" ? "Tiempo para votar" : "Siguiente en";
  const fraction = Math.min(1, Math.max(0, leftMs / total));
  const seconds = Math.ceil(leftMs / 1000);
  return (
    <div className={`stage-timer${seconds <= 5 && stage === "question" ? " urgent" : ""}`}>
      <div className="stage-timer-text">
        <span>{label}</span>
        <span className="countdown" aria-label="segundos restantes">
          {seconds}
        </span>
      </div>
      <div className="stage-timer-bar">
        <div style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
