import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { extractArchive } from "../store/archive.ts";

/** Build a single 512-byte tar header block (unchecked checksum — parseTar
 *  doesn't validate it). */
function tarHeader({ name = "", size = 0, typeflag = "0", prefix = "" }) {
  const block = new Uint8Array(512);
  const enc = new TextEncoder();
  const put = (str, off, len) => block.set(enc.encode(str).subarray(0, len), off);
  put(name, 0, 100);
  put(size.toString(8).padStart(11, "0") + "\0", 124, 12); // octal size
  block[156] = typeflag.charCodeAt(0);
  put("ustar\0", 257, 6);
  put(prefix, 345, 155);
  return block;
}

function pad512(bytes) {
  const out = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
  out.set(bytes);
  return out;
}

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function fileFromBytes(bytes, name) {
  return new File([bytes], name);
}

describe("tar long-name handling", () => {
  it("reads a GNU 'L' long-name entry (>100 chars) instead of truncating", async () => {
    const longName = "deeply/nested/" + "x".repeat(120) + "/note.md";
    const content = "# hi";
    const nameBytes = pad512(strToU8(longName + "\0"));
    const contentBytes = pad512(strToU8(content));

    const tar = concat([
      tarHeader({ name: "././@LongLink", size: longName.length + 1, typeflag: "L" }),
      nameBytes,
      tarHeader({ name: longName.slice(0, 100), size: content.length, typeflag: "0" }),
      contentBytes,
      new Uint8Array(1024), // two zero blocks = end
    ]);

    const entries = await extractArchive(fileFromBytes(tar, "a.tar"));
    const paths = entries.map((e) => e.path);
    expect(paths).toContain(longName);
    expect(entries.find((e) => e.path === longName)?.text).toBe(content);
  });

  it("honors the ustar prefix field for long paths", async () => {
    const content = "body";
    const tar = concat([
      tarHeader({ name: "leaf.md", prefix: "some/long/prefix/path", size: content.length, typeflag: "0" }),
      pad512(strToU8(content)),
      new Uint8Array(1024),
    ]);
    const entries = await extractArchive(fileFromBytes(tar, "b.tar"));
    expect(entries.map((e) => e.path)).toContain("some/long/prefix/path/leaf.md");
  });
});
