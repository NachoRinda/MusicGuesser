import { FAKE_TRACK_POOL } from "@mg/shared";
import { describe, expect, it } from "vitest";
import { FakeExtractor } from "./FakeExtractor.js";

const img = (content: string) => ({ mediaType: "image/png" as const, data: Buffer.from(content) });

describe("FakeExtractor", () => {
  const fake = new FakeExtractor();

  it("reads 12 tracks from the fake pool from a plain image, one reading per image", async () => {
    const readings = await fake.extract([img("a"), img("b")]);
    expect(readings).toHaveLength(2);
    for (const r of readings) {
      expect(r.isPlaylist).toBe(true);
      expect(r.tracks).toHaveLength(12);
      for (const t of r.tracks) expect(FAKE_TRACK_POOL).toContainEqual(t);
    }
  });

  it("is deterministic per image, and different images give different (overlapping) sets", async () => {
    const [a1] = await fake.extract([img("player-a")]);
    const [a2] = await fake.extract([img("player-a")]);
    const [b] = await fake.extract([img("player-b-other")]);
    expect(a1).toEqual(a2);
    expect(b!.tracks).not.toEqual(a1!.tracks);
  });

  it("honours the markers in the image bytes", async () => {
    expect((await fake.extract([img("xx MG-INVALID xx")]))[0]).toEqual({ isPlaylist: false, platform: null, tracks: [] });
    expect((await fake.extract([img("MG-FEW")]))[0]!.tracks).toHaveLength(5);
    await expect(fake.extract([img("MG-ERROR")])).rejects.toThrow();
  });
});
