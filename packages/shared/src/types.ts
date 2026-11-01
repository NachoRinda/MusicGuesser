/** A song read from a player's "most played" screenshot. */
export interface Track {
  title: string;
  artist: string;
}

export interface Player {
  id: string;
  name: string;
  tracks: Track[];
}

/** Health payload shared by the server endpoint and any client that pings it. */
export interface HealthResponse {
  status: "ok";
  /** Which screenshot reader is active: the playtest refuses to run against the real one. */
  extractor: "fake" | "claude";
  /** Where round audio comes from: the playtest uses the fake (no network). */
  catalog: "fake" | "deezer";
}
