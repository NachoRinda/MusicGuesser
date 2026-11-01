import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppServer } from "./app.js";
import { FakeExtractor } from "./extraction/FakeExtractor.js";
import { FakeCatalog } from "./music/FakeCatalog.js";

describe("app server", () => {
  const { httpServer, io } = createAppServer({ extractor: new FakeExtractor(), catalog: new FakeCatalog() });
  let baseUrl = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await io.close();
  });

  it("responds to /health", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", extractor: "fake", catalog: "fake" });
  });
});
