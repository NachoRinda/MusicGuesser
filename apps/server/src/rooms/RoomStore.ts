import { randomUUID } from "node:crypto";
import {
  DEFAULT_ROUNDS,
  MAX_NAME_LENGTH,
  QUESTION_MS,
  REVEAL_STAGE_MS,
  ROUND_OPTIONS,
  MIN_PLAYERS_TO_START,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ExtractionProblem,
  type HostSession,
  type MyVote,
  type Player,
  type PlayerSession,
  type PlayerStatus,
  type PlayerTracks,
  type Result,
  type RoomPhase,
  type RoomSettings,
  type RoomState,
  type RoundsSetting,
} from "@mg/shared";
import type { ExtractionOutcome } from "../extraction/evaluate.js";
import { Game } from "../game/Game.js";
import { pickRounds } from "../game/pickRounds.js";

/** A room is deleted after its host has been away this long. */
export const HOST_TTL_MS = 30 * 60 * 1000;

interface StoredPlayer extends Player {
  token: string;
  /** Open sockets for this player; a reload briefly overlaps the old and new socket. */
  connections: number;
  status: PlayerStatus;
  problem?: ExtractionProblem;
  inGame: boolean;
}

/** What the socket layer reports when an extraction ends: an evaluated outcome or a technical failure. */
export type ExtractionResult = ExtractionOutcome | { status: "error" };

interface Room {
  code: string;
  hostToken: string;
  phase: RoomPhase;
  players: StoredPlayer[];
  hostConnections: number;
  /** When the last host socket left (or the room was created); null while the host is connected. */
  hostAwaySince: number | null;
  settings: RoomSettings;
  /** The game in progress or just finished; undefined in the lobby. */
  game?: Game;
}

export interface RoomStoreOptions {
  now?: () => number;
  random?: () => number;
  /** Stage lengths (tests shorten them). */
  questionMs?: number;
  revealStageMs?: number;
}


/** In-memory room state, independent of Socket.IO so it can be tested without a network. */
export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly questionMs: number;
  private readonly revealStageMs: number;

  constructor({
    now = Date.now,
    random = Math.random,
    questionMs = QUESTION_MS,
    revealStageMs = REVEAL_STAGE_MS,
  }: RoomStoreOptions = {}) {
    this.now = now;
    this.random = random;
    this.questionMs = questionMs;
    this.revealStageMs = revealStageMs;
  }

  createRoom(): HostSession {
    const room: Room = {
      code: this.newCode(),
      hostToken: randomUUID(),
      phase: "lobby",
      players: [],
      hostConnections: 0,
      hostAwaySince: this.now(),
      settings: { rounds: DEFAULT_ROUNDS },
    };
    this.rooms.set(room.code, room);
    return { code: room.code, hostToken: room.hostToken };
  }

  resumeHost(hostToken: string): Result<HostSession> {
    for (const room of this.rooms.values()) {
      if (room.hostToken === hostToken) return { ok: true, code: room.code, hostToken };
    }
    return { ok: false, error: "INVALID_TOKEN" };
  }

  hostConnected(code: string): void {
    const room = this.room(code);
    if (!room) return;
    room.hostConnections++;
    room.hostAwaySince = null;
  }

  hostDisconnected(code: string): void {
    const room = this.room(code);
    if (!room || room.hostConnections === 0) return;
    room.hostConnections--;
    if (room.hostConnections === 0) room.hostAwaySince = this.now();
  }

  join(code: string, rawName: string): Result<PlayerSession> {
    const room = this.room(code);
    if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
    if (room.phase !== "lobby") return { ok: false, error: "GAME_ALREADY_STARTED" };

    const name = rawName.trim();
    const length = [...name].length;
    if (length < 1 || length > MAX_NAME_LENGTH) return { ok: false, error: "INVALID_NAME" };
    const key = name.toLocaleLowerCase();
    if (room.players.some((p) => p.name.toLocaleLowerCase() === key)) return { ok: false, error: "NAME_TAKEN" };

    const player: StoredPlayer = {
      id: randomUUID(),
      name,
      tracks: [],
      token: randomUUID(),
      connections: 0,
      status: "noTracks",
      inGame: false,
    };
    room.players.push(player);
    return { ok: true, code: room.code, playerId: player.id, playerToken: player.token };
  }

  resumePlayer(code: string, playerToken: string): Result<PlayerSession> {
    const room = this.room(code);
    if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
    const player = room.players.find((p) => p.token === playerToken);
    if (!player) return { ok: false, error: "INVALID_TOKEN" };
    return { ok: true, code: room.code, playerId: player.id, playerToken };
  }

  playerConnected(code: string, playerId: string): void {
    const player = this.findPlayer(code, playerId);
    if (player) player.connections++;
  }

  playerDisconnected(code: string, playerId: string): void {
    const room = this.room(code);
    const player = room?.players.find((p) => p.id === playerId);
    if (!room || !player || player.connections === 0) return;
    player.connections--;
    // The last voter may be the one who left: don't wait for them.
    if (player.connections === 0) this.closeQuestionIfAllVoted(room);
  }

  setRounds(code: string, rounds: RoundsSetting): Result<object> {
    const room = this.room(code);
    if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
    if (room.phase !== "lobby") return { ok: false, error: "GAME_ALREADY_STARTED" };
    if (!ROUND_OPTIONS.includes(rounds)) return { ok: false, error: "INVALID_SETTINGS" };
    room.settings = { rounds };
    return { ok: true };
  }

  start(code: string): Result<object> {
    const room = this.room(code);
    if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
    if (room.phase !== "lobby") return { ok: false, error: "GAME_ALREADY_STARTED" };
    const readyAndConnected = room.players.filter((p) => p.status === "ready" && p.connections > 0).length;
    if (readyAndConnected < MIN_PLAYERS_TO_START) return { ok: false, error: "NOT_ENOUGH_READY_PLAYERS" };
    room.phase = "playing";
    // Ready players play even if momentarily disconnected; the rest sit this game out.
    for (const p of room.players) p.inGame = p.status === "ready";
    const inGame = room.players.filter((p) => p.inGame);
    room.game = new Game({
      rounds: pickRounds(inGame, room.settings.rounds, this.random),
      players: inGame.map((p) => p.id),
      now: this.now,
      questionMs: this.questionMs,
      revealStageMs: this.revealStageMs,
    });
    return { ok: true };
  }

  getGame(code: string): Game | undefined {
    return this.room(code)?.game;
  }

  vote(code: string, playerId: string, targetId: string): Result<object> {
    const room = this.room(code);
    if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
    if (room.phase !== "playing" || !room.game) return { ok: false, error: "NOT_PLAYING" };
    const res = room.game.vote(playerId, targetId);
    if (res.ok) this.closeQuestionIfAllVoted(room);
    return res;
  }

  getMyVote(code: string, playerId: string): MyVote | undefined {
    return this.room(code)?.game?.myVote(playerId);
  }

  /** Host skips to the next stage. */
  next(code: string): Result<object> {
    const room = this.room(code);
    if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
    if (room.phase !== "playing" || !room.game) return { ok: false, error: "NOT_PLAYING" };
    room.game.advance();
    this.syncPhase(room);
    return { ok: true };
  }

  /** A stage timer fired: advances only if `game` is still the room's game and still on stage `seq`. */
  advanceIf(code: string, game: Game, seq: number): boolean {
    const room = this.room(code);
    if (!room || room.game !== game || !game.advanceIf(seq)) return false;
    this.syncPhase(room);
    return true;
  }

  /** From the final ranking back to the lobby with the same players, tracks and statuses. */
  playAgain(code: string): Result<object> {
    const room = this.room(code);
    if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
    if (room.phase !== "finished") return { ok: false, error: "NOT_PLAYING" };
    room.phase = "lobby";
    delete room.game;
    for (const p of room.players) p.inGame = false;
    return { ok: true };
  }

  private closeQuestionIfAllVoted(room: Room): void {
    const game = room.game;
    if (room.phase !== "playing" || !game || game.currentStage !== "question") return;
    const connected = new Set(room.players.filter((p) => p.connections > 0).map((p) => p.id));
    if (game.allVoted(connected)) {
      game.advance();
      this.syncPhase(room);
    }
  }

  private syncPhase(room: Room): void {
    if (room.game?.finished) room.phase = "finished";
  }

  /** Marks a player as having an upload being read; their previous tracks are discarded. */
  beginExtraction(code: string, playerId: string): Result<object> {
    const room = this.room(code);
    if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: "NOT_AUTHORIZED" };
    if (room.phase !== "lobby") return { ok: false, error: "GAME_ALREADY_STARTED" };
    if (player.status === "extracting") return { ok: false, error: "EXTRACTION_IN_PROGRESS" };
    player.status = "extracting";
    player.tracks = [];
    delete player.problem;
    return { ok: true };
  }

  /** Stores the result of an extraction; returns false (and changes nothing) if none was in progress. */
  finishExtraction(code: string, playerId: string, result: ExtractionResult): boolean {
    const player = this.findPlayer(code, playerId);
    if (!player || player.status !== "extracting") return false;
    player.status = result.status;
    if (result.status === "error") {
      player.tracks = [];
      player.problem = "failed";
    } else {
      player.tracks = result.tracks;
      if (result.status === "invalid") player.problem = result.problem;
    }
    return true;
  }

  /** Private view of a player's own tracks (sent only to that player). */
  getPlayerTracks(code: string, playerId: string): PlayerTracks | undefined {
    const player = this.findPlayer(code, playerId);
    if (!player) return undefined;
    return {
      status: player.status,
      tracks: player.tracks,
      ...(player.problem && { problem: player.problem }),
    };
  }

  /** Public snapshot for broadcasting: no tokens, no tracks (only how many). */
  getState(code: string): RoomState | undefined {
    const room = this.room(code);
    if (!room) return undefined;
    return {
      code: room.code,
      phase: room.phase,
      settings: room.settings,
      ...(room.game && { game: room.game.view() }),
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connections > 0,
        status: p.status,
        trackCount: p.tracks.length,
        inGame: p.inGame,
      })),
    };
  }

  getPlayer(code: string, playerId: string): Player | undefined {
    const player = this.findPlayer(code, playerId);
    return player && { id: player.id, name: player.name, tracks: player.tracks };
  }

  /** Deletes rooms whose host has been away for HOST_TTL_MS; returns the deleted codes. */
  sweep(): string[] {
    const now = this.now();
    const deleted: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.hostAwaySince !== null && now - room.hostAwaySince >= HOST_TTL_MS) {
        this.rooms.delete(room.code);
        deleted.push(room.code);
      }
    }
    return deleted;
  }

  private room(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  private findPlayer(code: string, playerId: string): StoredPlayer | undefined {
    return this.room(code)?.players.find((p) => p.id === playerId);
  }

  private newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[this.randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private randomInt(max: number): number {
    return Math.floor(this.random() * max);
  }
}
