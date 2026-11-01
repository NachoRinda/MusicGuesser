import {
  CORRECT_VOTE_POINTS,
  HIDDEN_OWNER_POINTS,
  MAX_SPEED_BONUS,
  type PlayerPoints,
  type VoteResult,
} from "@mg/shared";

export interface CastVote {
  voterId: string;
  targetId: string;
  /** Time left in the question when the vote was cast. */
  remainingMs: number;
}

export interface RoundScoreInput {
  /** Everyone in the game, in display order. */
  players: string[];
  owners: string[];
  votes: CastVote[];
  durationMs: number;
}

export interface RoundScore {
  /** One entry per player (null target if they didn't vote), in player order. */
  votes: VoteResult[];
  ownerPoints: number;
  points: PlayerPoints[];
}

/**
 * Correct vote: 100 + up to 50 for speed. Wrong or missing: 0. Owners get +100 if no non-owner
 * found them out (and only if there was someone to hide from).
 */
export function scoreRound({ players, owners, votes, durationMs }: RoundScoreInput): RoundScore {
  const owner = new Set(owners);
  const results: VoteResult[] = players.map((voterId) => {
    const vote = votes.find((v) => v.voterId === voterId);
    if (!vote) return { voterId, targetId: null, correct: false, points: 0 };
    const correct = owner.has(vote.targetId);
    const fraction = Math.min(1, Math.max(0, vote.remainingMs / durationMs));
    const points = correct ? CORRECT_VOTE_POINTS + Math.round(MAX_SPEED_BONUS * fraction) : 0;
    return { voterId, targetId: vote.targetId, correct, points };
  });

  const nonOwners = results.filter((r) => !owner.has(r.voterId));
  const hidden = nonOwners.length > 0 && !nonOwners.some((r) => r.correct);
  const ownerPoints = hidden ? HIDDEN_OWNER_POINTS : 0;

  const points = results.map((r) => ({
    playerId: r.voterId,
    points: r.points + (owner.has(r.voterId) ? ownerPoints : 0),
  }));
  return { votes: results, ownerPoints, points };
}
