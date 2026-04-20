import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ScrollbackStore } from "./scrollback-store";

const tmpRoot = join("/tmp", `tempest-scrollback-store-test-${Date.now()}`);
const uuid = () => crypto.randomUUID();

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
});

describe("ScrollbackStore", () => {
  it("writes and reads a scrollback record", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const id = uuid();

    await store.write(id, { scrollback: "hello\x1b[0m world", cwd: "/tmp/x" });
    const rec = await store.read(id);

    expect(rec).not.toBeNull();
    expect(rec!.scrollback).toBe("hello\x1b[0m world");
    expect(rec!.cwd).toBe("/tmp/x");
  });

  it("returns null for an unknown terminalId", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const rec = await store.read(uuid());
    expect(rec).toBeNull();
  });

  it("readMany returns only records that exist", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const [a, b, c] = [uuid(), uuid(), uuid()];

    await store.write(a, { scrollback: "A" });
    await store.write(c, { scrollback: "C" });

    const got = await store.readMany([a, b, c]);
    expect(got.get(a)?.scrollback).toBe("A");
    expect(got.has(b)).toBe(false);
    expect(got.get(c)?.scrollback).toBe("C");
  });

  it("overwrites atomically and leaves no .tmp files behind", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const id = uuid();

    await store.write(id, { scrollback: "first" });
    await store.write(id, { scrollback: "second" });

    const rec = await store.read(id);
    expect(rec!.scrollback).toBe("second");

    const files = readdirSync(join(tmpRoot, "scrollback"));
    expect(files.some((f) => f.includes(".tmp"))).toBe(false);
  });

  it("delete removes the file", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const id = uuid();

    await store.write(id, { scrollback: "x" });
    await store.delete(id);

    expect(await store.read(id)).toBeNull();
    expect(existsSync(join(tmpRoot, "scrollback", `${id}.json`))).toBe(false);
  });

  it("gc deletes files not in the live set", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const keep = uuid();
    const drop = uuid();

    await store.write(keep, { scrollback: "k" });
    await store.write(drop, { scrollback: "d" });

    const { deleted } = await store.gc(new Set([keep]));
    expect(deleted).toBe(1);
    expect(await store.read(keep)).not.toBeNull();
    expect(await store.read(drop)).toBeNull();
  });

  it("gc ignores files with non-UUID names", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const keep = uuid();
    await store.write(keep, { scrollback: "k" });

    // Plant an unrelated file in the dir
    const dir = join(tmpRoot, "scrollback");
    writeFileSync(join(dir, "something-else.txt"), "unrelated");

    const { deleted } = await store.gc(new Set([keep]));
    expect(deleted).toBe(0);
    expect(existsSync(join(dir, "something-else.txt"))).toBe(true);
  });

  it("gc with empty dir is a no-op", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const { deleted } = await store.gc(new Set(["whatever"]));
    expect(deleted).toBe(0);
  });

  it("rejects non-UUID terminalIds", async () => {
    const store = new ScrollbackStore(tmpRoot);
    await expect(store.write("../../etc/passwd", { scrollback: "x" })).rejects.toThrow(
      /invalid terminalId/i,
    );
    await expect(store.read("not-a-uuid")).rejects.toThrow(/invalid terminalId/i);
  });

  it("corrupt file returns null without throwing, other files still readable", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const good = uuid();
    const bad = uuid();

    await store.write(good, { scrollback: "ok" });
    await store.write(bad, { scrollback: "will-clobber" });
    writeFileSync(join(tmpRoot, "scrollback", `${bad}.json`), "{not json");

    expect(await store.read(bad)).toBeNull();
    expect((await store.read(good))!.scrollback).toBe("ok");
  });

  it("listIds returns only UUID-named entries", async () => {
    const store = new ScrollbackStore(tmpRoot);
    const a = uuid();
    await store.write(a, { scrollback: "a" });
    writeFileSync(join(tmpRoot, "scrollback", "not-a-uuid.json"), "{}");

    const ids = store.listIds();
    expect(ids).toEqual([a]);
  });
});
