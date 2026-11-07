import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("roomindex worker", () => {
  it("responds to /health", async () => {
    const res = await exports.default.fetch(new Request("https://example.com/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 404 for unknown routes", async () => {
    const res = await exports.default.fetch(new Request("https://example.com/nope"));
    expect(res.status).toBe(404);
  });
});
