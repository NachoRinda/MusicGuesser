import Anthropic from "@anthropic-ai/sdk";
import type { Platform, ScreenshotReading } from "./evaluate.js";
import type { Extractor } from "./Extractor.js";
import type { ImageInput } from "./upload.js";

export const EXTRACTION_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 60_000;

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
/** The one SDK call we make; injectable so tests never hit the API. */
export type CreateMessage = (params: CreateParams, options: { timeout: number }) => Promise<Message>;

const PLATFORMS = ["spotify", "youtube_music", "apple_music", "other", "none"] as const;

const SYSTEM_PROMPT = `You read screenshots of music apps for a party game. For each screenshot, in the order given:

1. Decide whether it shows a list of songs from a music app (Spotify, YouTube Music, Apple Music, Deezer, etc.): a playlist, mix or similar track list. Anything else (a photo, a chat, a home screen, a single "now playing" screen, a list of artists or albums) is not a playlist.
2. If it is, transcribe every song row visible in the list: title and artist exactly as shown on screen, keeping the original language, spelling and capitalization. When a row lists several artists, keep them as shown (e.g. "Bad Bunny, Chencho Corleone").
3. Name the app if you can tell it from the interface, otherwise "other". Use "none" when it is not a playlist.

Rules:
- Only transcribe what is visible. Never guess, complete or add songs that are not on screen.
- If a title or artist is cut off by the edge of the screen or an ellipsis, transcribe the visible part as is.
- Skip rows whose title or artist is hidden or cut off entirely (e.g. a row half-covered by a bar at the top or bottom of the screen), and skip non-song items (headers, buttons, ads, "recommended" sections, the playlist's own title).
- Skip the "now playing" mini-player bar near the bottom of the screen: it shows the song currently playing, which is not necessarily part of the list.
- Badges next to the artist (an "E" for explicit, a download or verified check mark) are not part of the artist name. Leave durations out too.
- If it is not a playlist, return an empty track list.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["screenshots"],
  properties: {
    screenshots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["isPlaylist", "platform", "tracks"],
        properties: {
          isPlaylist: { type: "boolean" },
          platform: { type: "string", enum: [...PLATFORMS] },
          tracks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "artist"],
              properties: { title: { type: "string" }, artist: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

/** Thrown for anything that keeps us from getting a usable reading (API errors are passed through as-is). */
export class ExtractionError extends Error {
  override name = "ExtractionError";
}

/**
 * Reads screenshots with Claude vision in a single request. Images are sent as base64 and never
 * stored or logged.
 */
export class ClaudeExtractor implements Extractor {
  private readonly create: CreateMessage;

  constructor(create?: CreateMessage) {
    this.create = create ?? defaultCreate();
  }

  async extract(images: ImageInput[]): Promise<ScreenshotReading[]> {
    const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
    images.forEach((image, i) => {
      content.push({ type: "text", text: `Screenshot ${i + 1}:` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.data.toString("base64") },
      });
    });
    content.push({
      type: "text",
      text: `Return one entry per screenshot (${images.length} in total), in order.`,
    });

    const response = await this.create(
      {
        model: EXTRACTION_MODEL,
        max_tokens: 16000,
        // If a safety classifier declines, the API retries on a recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      },
      { timeout: TIMEOUT_MS },
    );

    if (response.stop_reason !== "end_turn") {
      throw new ExtractionError(`unexpected stop_reason: ${response.stop_reason}`);
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new ExtractionError("no text block in response");
    return parseReadings(text.text, images.length);
  }
}

/** Creates the client on first use, so a missing credential surfaces as a failed extraction, not a crash at startup. */
function defaultCreate(): CreateMessage {
  let client: Anthropic | undefined;
  return (params, options) => {
    client ??= new Anthropic({ maxRetries: 1 });
    return client.beta.messages.create(params, options);
  };
}

/** Validates the model's JSON (structured outputs should guarantee it, but this is the trust boundary). */
export function parseReadings(json: string, expected: number): ScreenshotReading[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ExtractionError("response is not JSON");
  }
  const screenshots = (data as { screenshots?: unknown })?.screenshots;
  if (!Array.isArray(screenshots) || screenshots.length !== expected) {
    throw new ExtractionError(`expected ${expected} screenshot readings`);
  }
  return screenshots.map((s: unknown): ScreenshotReading => {
    const r = s as { isPlaylist?: unknown; platform?: unknown; tracks?: unknown };
    if (typeof r?.isPlaylist !== "boolean" || !Array.isArray(r.tracks)) throw new ExtractionError("malformed reading");
    const platform = PLATFORMS.includes(r.platform as (typeof PLATFORMS)[number]) ? r.platform : "other";
    const tracks = (r.tracks as unknown[]).map((t) => {
      const track = t as { title?: unknown; artist?: unknown };
      if (typeof track?.title !== "string" || typeof track.artist !== "string") {
        throw new ExtractionError("malformed track");
      }
      return { title: track.title, artist: track.artist };
    });
    return {
      isPlaylist: r.isPlaylist,
      platform: platform === "none" ? null : (platform as Platform),
      tracks: r.isPlaylist ? tracks : [],
    };
  });
}
