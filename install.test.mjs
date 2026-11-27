import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assetName, parseVersion, resolveRelease, runtimeDir, verifyChecksum } from "./install.mjs";

test("runtimeDir creates a private directory only on Linux without one", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "runtime-test-"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  for (const env of [{}, { XDG_RUNTIME_DIR: "" }, { XDG_RUNTIME_DIR: "relative/dir" }]) {
    const dir = await runtimeDir(env, "linux", parent);
    assert.ok(dir.startsWith(parent), JSON.stringify(env));
    assert.equal((await stat(dir)).mode & 0o777, 0o700, JSON.stringify(env));
  }
  assert.equal(await runtimeDir({ XDG_RUNTIME_DIR: "/run/user/1001" }, "linux", parent), "");
  assert.equal(await runtimeDir({}, "darwin", parent), "");
  assert.equal(await runtimeDir({}, "win32", parent), "");
});

test("parseVersion accepts only a plain version", () => {
  assert.equal(parseVersion(""), "");
  assert.equal(parseVersion(" v0.13.0 "), "0.13.0");
  assert.equal(parseVersion("1.0.0-rc.1"), "1.0.0-rc.1");
  for (const bad of ["0.13.0/../../../../other/repo/releases/tags/v1.0.0", "0.13", "latest", "0.13.0?x=1"]) {
    assert.throws(() => parseVersion(bad), /is not a version/, bad);
  }
});

// Names from the kong-harnesses v0.13.0 release assets.
test("assetName matches the release archive names", () => {
  assert.equal(assetName("0.13.0", "linux", "x64"), "kong-harnesses_v0.13.0_linux_amd64.tar.gz");
  assert.equal(assetName("0.13.0", "darwin", "arm64"), "kong-harnesses_v0.13.0_darwin_arm64.tar.gz");
  assert.equal(assetName("0.13.0", "win32", "x64"), "kong-harnesses_v0.13.0_windows_amd64.zip");
  assert.throws(() => assetName("0.13.0", "linux", "ia32"), /no release for linux\/ia32/);
});

test("verifyChecksum accepts only the listed SHA-256", () => {
  const name = "kong-harnesses_v0.13.0_linux_amd64.tar.gz";
  const data = Buffer.from("archive");
  const sum = createHash("sha256").update(data).digest("hex");
  const sums = `${"0".repeat(64)}  kong-harnesses_v0.13.0_linux_amd64.deb\n${sum}  ${name}\n`;

  verifyChecksum(data, sums, name);
  assert.throws(() => verifyChecksum(data, sums + sums, name), /duplicate entries/);
  assert.throws(() => verifyChecksum(Buffer.from("tampered"), sums, name), /SHA256SUMS.txt says/);
  assert.throws(() => verifyChecksum(data, sums, "kong-harnesses_v0.13.0_linux_arm64.tar.gz"), /no entry/);
});

test("latest uses the highest stable release with a published bundle across all pages", async (t) => {
  const bundle = (version, downloadable = true) => ({
    filename: `kong-harnesses_v${version}.sigstore.json`, version, is_downloadable: downloadable,
  });
  const pages = [
    [bundle("0.9.0"), bundle("1.0.0-rc.1"), bundle("1.0.0", false)],
    [bundle("0.10.0")],
  ];
  t.mock.method(globalThis, "fetch", (url, opts) => {
    assert.equal(url.hostname, "api.cloudsmith.io");
    assert.equal(opts?.headers?.Authorization, undefined);
    assert.equal(url.searchParams.get("query"), "name:^kong-harnesses-sigstore-json$");
    const page = Number(url.searchParams.get("page"));
    return Response.json(pages[page - 1], { headers: { "x-pagination-pagetotal": String(pages.length) } });
  });
  assert.equal((await resolveRelease("", "github-token")).version, "0.10.0");
});

test("only an authenticated historical pin falls back to the GitHub release", async (t) => {
  let githubCalls = 0;
  t.mock.method(globalThis, "fetch", (url, opts) => {
    if (new URL(url).hostname === "api.cloudsmith.io") {
      assert.equal(url.searchParams.get("query"), "name:^kong-harnesses-sigstore-json$ version:^0.13.0$");
      assert.equal(opts?.headers?.Authorization, undefined);
      return Response.json([]);
    }
    assert.equal(String(url), "https://api.github.com/repos/Kong/kong-harnesses/releases/tags/v0.13.0");
    assert.equal(opts.headers.Authorization, "Bearer github-token");
    githubCalls++;
    return Response.json({ tag_name: "v0.13.0", assets: [] });
  });
  await assert.rejects(resolveRelease("0.13.0", ""), /No public kong-harnesses release/);
  assert.equal((await resolveRelease("0.13.0", "github-token")).version, "0.13.0");
  assert.equal(githubCalls, 1);
});
