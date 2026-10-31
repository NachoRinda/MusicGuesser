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
}
