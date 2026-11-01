import type { GameStage, GameView, MyVote, PlayerScore, Result, RoundReveal } from "@mg/shared";
import type { PickedRound } from "./pickRounds.js";
import { scoreRound, type CastVote } from "./scoreRound.js";

export interface RoundMedia {
  previewUrl: string | null;
  coverUrl: string | null;
  /** Catalog id to refresh the preview URL. */
  ref?: string;
}

export interface GameOptions {
  rounds: PickedRound[];
  /** Ids of the players in the game, in display order. */
  players: string[];
  now: () => number;
  questionMs: number;
  revealStageMs: number;
}

const NEXT_STAGE: Record<GameStage, GameStage | null> = {
  question: "owners",
  owners: "votes",
  votes: "ranking",
  ranking: null,
};

/**
 * One "¿De quién es?" game: rounds, stages, votes and scores. Knows nothing about sockets nor
 * timers: it reads the injected clock and the caller advances it (on timeout, all voted, or host).
 */
export class Game {
  private roundIndex = 0;
  private stage: GameStage = "question";
  private stageEndsAt: number;
  /** Bumps on every stage change, so a stale timer can tell it's no longer current. */
  private seq = 0;
  private votes: CastVote[] = [];
  private reveal: RoundReveal | undefined;
  private readonly scores = new Map<string, number>();
  private readonly media: (RoundMedia | undefined)[] = [];
  finished = false;

  constructor(private readonly options: GameOptions) {
    for (const id of options.players) this.scores.set(id, 0);
    options.rounds.forEach((r, i) => {
      if (r.media) this.media[i] = { ...r.media };
    });
    this.stageEndsAt = options.now() + options.questionMs;
  }

  get players(): readonly string[] {
    return this.options.players;
  }

  get totalRounds(): number {
    return this.options.rounds.length;
  }

  get currentRound(): number {
    return this.roundIndex;
  }

  get currentStage(): GameStage {
    return this.stage;
  }

  vote(voterId: string, targetId: string): Result<object> {
    const { players, now } = this.options;
    if (!players.includes(voterId)) return { ok: false, error: "NOT_IN_GAME" };
    if (this.finished || this.stage !== "question" || now() >= this.stageEndsAt) {
      return { ok: false, error: "INVALID_VOTE" };
    }
    if (voterId === targetId || !players.includes(targetId)) return { ok: false, error: "INVALID_VOTE" };
    if (this.votes.some((v) => v.voterId === voterId)) return { ok: false, error: "ALREADY_VOTED" };
    this.votes.push({ voterId, targetId, remainingMs: this.stageEndsAt - now() });
    return { ok: true };
  }

  myVote(playerId: string): MyVote | undefined {
    if (this.finished || this.stage !== "question") return undefined;
    const vote = this.votes.find((v) => v.voterId === playerId);
    return vote && { round: this.roundIndex + 1, targetId: vote.targetId };
  }

  /** True when every connected player in the game voted (and at least one is connected). */
  allVoted(connected: ReadonlySet<string>): boolean {
    const here = this.options.players.filter((id) => connected.has(id));
    return here.length > 0 && here.every((id) => this.votes.some((v) => v.voterId === id));
  }

  /** The current stage's timer, or null once finished. */
  deadline(): { seq: number; endsAt: number } | null {
    return this.finished ? null : { seq: this.seq, endsAt: this.stageEndsAt };
  }

  /** Advances only if the stage is still `seq` (a timer that fired late must not skip a stage). */
  advanceIf(seq: number): boolean {
    if (seq !== this.seq || this.finished) return false;
    this.advance();
    return true;
  }

  advance(): void {
    if (this.finished) return;
    const { now, questionMs, revealStageMs, rounds, players } = this.options;
    if (this.stage === "question") {
      const round = rounds[this.roundIndex]!;
      const score = scoreRound({ players, owners: round.owners, votes: this.votes, durationMs: questionMs });
      for (const p of score.points) this.scores.set(p.playerId, (this.scores.get(p.playerId) ?? 0) + p.points);
      this.reveal = { owners: round.owners, ...score };
    }
    const next = NEXT_STAGE[this.stage];
    this.seq++;
    if (next) {
      this.stage = next;
      this.stageEndsAt = now() + revealStageMs;
    } else if (this.roundIndex + 1 < rounds.length) {
      this.roundIndex++;
      this.stage = "question";
      this.stageEndsAt = now() + questionMs;
      this.votes = [];
      this.reveal = undefined;
    } else {
      this.finished = true;
    }
  }

  /** Catalog id of a round's audio, if it has any. */
  mediaRef(roundIndex: number): string | undefined {
    return this.media[roundIndex]?.ref;
  }

  /** Swaps in a fresh preview URL (they expire). */
  setPreview(roundIndex: number, previewUrl: string): void {
    const media = this.media[roundIndex];
    if (media) media.previewUrl = previewUrl;
  }

  view(): GameView {
    const round = this.options.rounds[this.roundIndex]!;
    const media = this.media[this.roundIndex];
    return {
      round: this.roundIndex + 1,
      totalRounds: this.totalRounds,
      stage: this.stage,
      track: {
        title: round.track.title,
        artist: round.track.artist,
        coverUrl: media?.coverUrl ?? null,
        previewUrl: media?.previewUrl ?? null,
      },
      remainingMs: this.finished ? 0 : Math.max(0, this.stageEndsAt - this.options.now()),
      voted: this.stage === "question" ? this.votes.map((v) => v.voterId) : [],
      ...(this.stage !== "question" && this.reveal && { reveal: this.reveal }),
      scores: this.sortedScores(),
    };
  }

  private sortedScores(): PlayerScore[] {
    // Stable sort keeps player order among ties.
    return this.options.players
      .map((playerId) => ({ playerId, score: this.scores.get(playerId) ?? 0 }))
      .sort((a, b) => b.score - a.score);
  }
}
