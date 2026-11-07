/**
 * Work out what a pasted blob identifier could be and which stored forms to
 * look for. Save blobs are keyed like `13pcfb752scyh8j7eozjpqbsh.room`, room
 * metadata blobs like `room/<key>.meta`, unity asset bundles like
 * `3iaehzyxfn0o7ua2dm22zsi1m.assetbundle`, and all carry a base64 hash.
 * People paste any of: the bare key, key with suffix, a full path, or a hash.
 */
export interface BlobTargets {
  /** Exact values to match against subroom_saves.data_blob_key. */
  saveKeys: string[];
  /** Exact values to match against rooms.meta_blob_key. */
  metaKeys: string[];
  /** Exact values to match against unity_asset_bundles.asset_key. */
  assetKeys: string[];
  /** Exact values to match against either table's blob hash. */
  hashes: string[];
}

export function blobTargets(input: string): BlobTargets {
  const q = input.trim();
  const none: BlobTargets = { saveKeys: [], metaKeys: [], assetKeys: [], hashes: [] };
  if (!q) return none;

  if (q.endsWith(".room")) return { ...none, saveKeys: [q] };
  if (q.endsWith(".assetbundle")) return { ...none, assetKeys: [q] };

  if (q.startsWith("room/") || q.endsWith(".meta")) {
    const bare = q.replace(/^room\//, "").replace(/\.meta$/, "");
    return { ...none, metaKeys: unique([q, `room/${bare}.meta`, `${bare}.meta`]) };
  }

  // Base64 hashes contain characters that never appear in blob keys.
  if (/[+/=]/.test(q)) return { ...none, hashes: [q] };

  // A bare key: could be either kind.
  return { saveKeys: [`${q}.room`], metaKeys: [`room/${q}.meta`, `${q}.meta`], assetKeys: [`${q}.assetbundle`], hashes: [] };
}

/** Every exact string a lookup might match; handy for highlighting hits. */
export function blobCandidates(input: string): string[] {
  const t = blobTargets(input);
  return unique([...t.saveKeys, ...t.metaKeys, ...t.assetKeys, ...t.hashes]);
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
