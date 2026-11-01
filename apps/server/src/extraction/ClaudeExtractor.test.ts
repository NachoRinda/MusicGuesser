import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ClaudeExtractor, DEFAULT_EXTRACTION_MODEL, ExtractionError, type CreateMessage } from "./ClaudeExtractor.js";

type Message = Anthropic.Beta.Messages.BetaMessage;

function reply(body: unknown, stop_reason: Message["stop_reason"] = "end_turn"): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_EXTRACTION_MODEL,
    stop_reason,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
  } as unknown as Message;
}

const png = { mediaType: "image/png" as const, data: Buffer.from("fake-png-bytes") };
const jpg = { mediaType: "image/jpeg" as const, data: Buffer.from("fake-jpg-bytes") };
const track = { title: "Tusa", artist: "Karol G" };

function extractorReturning(message: Message) {
  const create = vi.fn<CreateMessage>().mockResolvedValue(message);
  return { create, extractor: new ClaudeExtractor({ create }) };
}

describe("ClaudeExtractor", () => {
  it("sends every image as base64 in one request, with structured output (Haiku by default)", async () => {
    const { create, extractor } = extractorReturning(
      reply({ screenshots: [{ isPlaylist: true, platform: "spotify", tracks: [track] }, { isPlaylist: true, platform: "spotify", tracks: [] }] }),
    );
    await extractor.extract([png, jpg]);

    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0]!;
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.fallbacks).toBeUndefined(); // Haiku has no server-side fallback
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params.thinking).toBeUndefined();
    expect(options.timeout).toBe(60_000);

    const content = params.messages[0]!.content as Anthropic.Beta.Messages.BetaContentBlockParam[];
    const images = content.filter((b) => b.type === "image");
    expect(images).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: png.data.toString("base64") } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpg.data.toString("base64") } },
    ]);
  });

  it("uses another model when configured; Opus gets the server-side refusal fallback", async () => {
    const create = vi.fn<CreateMessage>().mockResolvedValue(reply({ screenshots: [{ isPlaylist: false, platform: "none", tracks: [] }] }));
    await new ClaudeExtractor({ create, model: "claude-opus-5-5" }).extract([png]);
    const [params] = create.mock.calls[0]!;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toContain("server-side-fallback-2026-07-01");
  });

  it("maps the response to one reading per screenshot", async () => {
    const { extractor } = extractorReturning(
      reply({
        screenshots: [
          { isPlaylist: true, platform: "youtube_music", tracks: [track] },
          { isPlaylist: false, platform: "none", tracks: [] },
        ],
      }),
    );
    expect(await extractor.extract([png, jpg])).toEqual([
      { isPlaylist: true, platform: "youtube_music", tracks: [track] },
      { isPlaylist: false, platform: null, tracks: [] },
    ]);
  });

  it("drops tracks reported for something that is not a playlist", async () => {
    const { extractor } = extractorReturning(reply({ screenshots: [{ isPlaylist: false, platform: "none", tracks: [track] }] }));
    expect((await extractor.extract([png]))[0]!.tracks).toEqual([]);
  });

  it.each([
    ["a refusal", reply({ screenshots: [] }, "refusal")],
    ["a truncated answer", reply("{", "max_tokens")],
    ["invalid JSON", reply("not json")],
    ["the wrong number of readings", reply({ screenshots: [] })],
    ["a malformed track", reply({ screenshots: [{ isPlaylist: true, platform: "other", tracks: [{ title: 1 }] }] })],
  ])("throws ExtractionError on %s", async (_label, message) => {
    const { extractor } = extractorReturning(message);
    await expect(extractor.extract([png])).rejects.toBeInstanceOf(ExtractionError);
  });

  it("lets API errors through (the caller reports them as a failed extraction)", async () => {
    const create = vi.fn<CreateMessage>().mockRejectedValue(new Error("529 overloaded"));
    await expect(new ClaudeExtractor({ create }).extract([png])).rejects.toThrow("529");
  });
});
