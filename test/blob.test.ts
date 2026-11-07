import { describe, expect, it } from "vitest";
import { blobCandidates, blobTargets } from "../src/blob";

describe("blobTargets", () => {
  it("treats a bare key as either a save or a meta blob", () => {
    expect(blobTargets("13pcfb752scyh8j7eozjpqbsh")).toEqual({
      saveKeys: ["13pcfb752scyh8j7eozjpqbsh.room"],
      metaKeys: ["room/13pcfb752scyh8j7eozjpqbsh.meta", "13pcfb752scyh8j7eozjpqbsh.meta"],
      assetKeys: ["13pcfb752scyh8j7eozjpqbsh.assetbundle"],
      hashes: [],
    });
  });

  it("looks up an .assetbundle key only against bundles", () => {
    expect(blobTargets("3iaehzyxfn0o7ua2dm22zsi1m.assetbundle")).toEqual({
      saveKeys: [],
      metaKeys: [],
      assetKeys: ["3iaehzyxfn0o7ua2dm22zsi1m.assetbundle"],
      hashes: [],
    });
  });

  it("looks up a .room key only against saves", () => {
    expect(blobTargets("  13pcfb752scyh8j7eozjpqbsh.room ")).toEqual({
      saveKeys: ["13pcfb752scyh8j7eozjpqbsh.room"],
      metaKeys: [],
      assetKeys: [],
      hashes: [],
    });
  });

  it("looks up meta paths only against rooms", () => {
    expect(blobTargets("room/abc.meta")).toEqual({
      saveKeys: [],
      metaKeys: ["room/abc.meta", "abc.meta"],
      assetKeys: [],
      hashes: [],
    });
    expect(blobTargets("abc.meta").metaKeys).toContain("room/abc.meta");
  });

  it("treats base64 as a hash for both tables", () => {
    const hash = "I5imkd8+/DZs/Ow54tZ4Dbeng0YTUywtLxZ+g71k944=";
    expect(blobTargets(hash)).toEqual({ saveKeys: [], metaKeys: [], assetKeys: [], hashes: [hash] });
  });

  it("returns nothing for blank input", () => {
    expect(blobTargets("   ")).toEqual({ saveKeys: [], metaKeys: [], assetKeys: [], hashes: [] });
    expect(blobCandidates("")).toEqual([]);
  });
});
