/** "¿De quién es?" game contract (phase 4). */

export const ROUND_OPTIONS = [5, 10, 15] as const;
export type RoundsSetting = (typeof ROUND_OPTIONS)[number];
export const DEFAULT_ROUNDS: RoundsSetting = 10;

/** Voting window: the 30 s preview plus 15 s. */
export const QUESTION_MS = 45_000;
/** Each of the three reveal stages (owners, votes, ranking). */
export const REVEAL_STAGE_MS = 10_000;

export const CORRECT_VOTE_POINTS = 100;
export const MAX_SPEED_BONUS = 50;
export const HIDDEN_OWNER_POINTS = 100;

export interface RoomSettings {
  rounds: RoundsSetting;
}

/** `question` → reveal in three stages: `owners` → `votes` → `ranking`. */
export type GameStage = "question" | "owners" | "votes" | "ranking";

export interface RoundTrack {
  title: string;
  artist: string;
  coverUrl: string | null;
  /** 30 s Deezer preview; null if not found (yet). Only the TV plays it. */
  previewUrl: string | null;
}

export interface VoteResult {
  voterId: string;
  targetId: string | null;
  correct: boolean;
  points: number;
}

export interface PlayerPoints {
  playerId: string;
  points: number;
}

export interface RoundReveal {
  owners: string[];
  votes: VoteResult[];
  /** Points each owner got for not being found out (0 if found out, or if everyone owns it). */
  ownerPoints: number;
  /** Total points won this round, per player in the game. */
  points: PlayerPoints[];
}

export interface PlayerScore {
  playerId: string;
  score: number;
}

/** Public view of the game, part of `room:state`. Never carries owners nor votes during the question. */
export interface GameView {
  round: number;
  totalRounds: number;
  stage: GameStage;
  track: RoundTrack;
  /** Time left in the current stage when the state was sent (clients count down locally); 0 when finished. */
  remainingMs: number;
  /** Ids of players who already voted this round. */
  voted: string[];
  reveal?: RoundReveal;
  /** Sorted by score, highest first. */
  scores: PlayerScore[];
}

/** Private message to a player: their own vote this round. */
export interface MyVote {
  round: number;
  targetId: string;
}

/** Players with the same score share their place (1, 2, 2, 4…). */
export function rankOf(scores: PlayerScore[], playerId: string): number {
  const mine = scores.find((s) => s.playerId === playerId);
  if (!mine) return 0;
  return scores.filter((s) => s.score > mine.score).length + 1;
}
