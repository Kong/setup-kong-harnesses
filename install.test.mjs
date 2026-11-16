import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { assetName, verifyChecksum } from "./install.mjs";

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
  assert.throws(() => verifyChecksum(Buffer.from("tampered"), sums, name), /SHA256SUMS.txt says/);
  assert.throws(() => verifyChecksum(data, sums, "kong-harnesses_v0.13.0_linux_arm64.tar.gz"), /no entry/);
});
