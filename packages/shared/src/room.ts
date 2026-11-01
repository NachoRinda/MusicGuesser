/** Room contract shared by the server and both clients (TV and phones). */
import type { PlayerStatus, PlayerTracks, ScreenshotUpload } from "./extraction.js";
import type { GameView, MyVote, RoomSettings } from "./game.js";

export type RoomPhase = "lobby" | "playing" | "finished";

/** What everyone in the room may see about a player: never tokens nor tracks. */
export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  status: PlayerStatus;
  trackCount: number;
  /** Takes part in the current game (was ready when it started). Always false in the lobby. */
  inGame: boolean;
}

/** Full room snapshot broadcast as `room:state` after every change. */
export interface RoomState {
  code: string;
  phase: RoomPhase;
  players: PublicPlayer[];
  settings: RoomSettings;
  /** Present while playing and once finished. */
  game?: GameView;
}

export type RoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "NAME_TAKEN"
  | "GAME_ALREADY_STARTED"
  | "INVALID_NAME"
  | "NOT_ENOUGH_READY_PLAYERS"
  /** A previous upload from this player is still being read. */
  | "EXTRACTION_IN_PROGRESS"
  /** 0 or too many images, unsupported type or too big. */
  | "INVALID_UPLOAD"
  /** Resume token unknown or from another room: the client should start over (create / join as new). */
  | "INVALID_TOKEN"
  /** Action sent from a socket that isn't the room's host / a player. */
  | "NOT_AUTHORIZED"
  /** Rounds not in ROUND_OPTIONS. */
  | "INVALID_SETTINGS"
  /** Game action outside `playing` (or play again outside `finished`). */
  | "NOT_PLAYING"
  /** The player sits this game out (wasn't ready when it started). */
  | "NOT_IN_GAME"
  | "ALREADY_VOTED"
  /** For oneself, for someone not in the game, or outside the question. */
  | "INVALID_VOTE";

export type Result<T> = ({ ok: true } & T) | { ok: false; error: RoomErrorCode };

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;
export const MIN_PLAYERS_TO_START = 3;
export const MAX_NAME_LENGTH = 20;

export type HostSession = { code: string; hostToken: string };
export type PlayerSession = { code: string; playerId: string; playerToken: string };

export interface ClientToServerEvents {
  "host:create": (ack: (res: Result<HostSession>) => void) => void;
  "host:resume": (req: { hostToken: string }, ack: (res: Result<HostSession>) => void) => void;
  "host:start": (ack: (res: Result<object>) => void) => void;
  "host:settings": (req: RoomSettings, ack: (res: Result<object>) => void) => void;
  /** Skips to the next reveal stage (or round). */
  "host:next": (ack: (res: Result<object>) => void) => void;
  /** From `finished` back to the lobby, keeping players and their tracks. */
  "host:playAgain": (ack: (res: Result<object>) => void) => void;
  "player:vote": (req: { targetId: string }, ack: (res: Result<object>) => void) => void;
  "player:join": (req: { code: string; name: string }, ack: (res: Result<PlayerSession>) => void) => void;
  "player:resume": (
    req: { code: string; playerToken: string },
    ack: (res: Result<PlayerSession>) => void,
  ) => void;
  /** Acks as soon as the upload is accepted; the result arrives later via `room:state` and `player:tracks`. */
  "player:uploadScreenshots": (req: { images: ScreenshotUpload[] }, ack: (res: Result<object>) => void) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  /** Only to the player's own sockets: after an extraction finishes and on (re)join. */
  "player:tracks": (tracks: PlayerTracks) => void;
  /** Only to the voter's own sockets: after voting and on (re)join during the question. */
  "player:myVote": (vote: MyVote) => void;
}

/** `GET /api/network`: lets the TV build a QR that phones on the LAN can open. */
export interface NetworkInfo {
  lanHost: string | null;
}

/** Error messages shown in the UI. */
export const ROOM_ERROR_MESSAGES: Record<RoomErrorCode, string> = {
  ROOM_NOT_FOUND: "No existe la sala",
  NAME_TAKEN: "Ese nombre ya está en uso en esta sala",
  GAME_ALREADY_STARTED: "La partida ya empezó",
  INVALID_NAME: "El nombre debe tener entre 1 y 20 caracteres",
  NOT_ENOUGH_READY_PLAYERS: `Se necesitan al menos ${MIN_PLAYERS_TO_START} jugadores conectados y listos`,
  EXTRACTION_IN_PROGRESS: "Todavía estamos leyendo tu captura anterior",
  INVALID_UPLOAD: "Subí 1 o 2 imágenes (JPG, PNG o WebP)",
  INVALID_TOKEN: "La sesión expiró",
  NOT_AUTHORIZED: "No tenés permiso para hacer eso",
  INVALID_SETTINGS: "Elegí 5, 10 o 15 rondas",
  NOT_PLAYING: "No hay una partida en curso",
  NOT_IN_GAME: "No estás jugando esta partida",
  ALREADY_VOTED: "Ya votaste en esta ronda",
  INVALID_VOTE: "Ese voto no vale",
};
