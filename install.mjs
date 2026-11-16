import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";

const REPO = "Kong/kong-harnesses";
const API = `https://api.github.com/repos/${REPO}`;
const OS = { linux: "linux", darwin: "darwin", win32: "windows" };
const ARCH = { x64: "amd64", arm64: "arm64" };

export async function run() {
  const token = core.getInput("token");
  const wanted = core.getInput("kong-harnesses-version").trim().replace(/^v/, "");
  const release = await api(wanted ? `releases/tags/v${wanted}` : "releases/latest", token);
  const version = release.tag_name.replace(/^v/, "");
  core.info(`Installing kong-harnesses ${version}`);

  let dir = tc.find("kong-harnesses", version);
  if (!dir) {
    const name = assetName(version, process.platform, process.arch);
    const archive = await download(release, name, token);
    const sums = await readFile(await download(release, "SHA256SUMS.txt", token), "utf8");
    verifyChecksum(await readFile(archive), sums, name);
    const extracted = name.endsWith(".zip") ? await tc.extractZip(archive) : await tc.extractTar(archive);
    dir = await tc.cacheDir(extracted, "kong-harnesses", version);
  }

  core.addPath(dir);
  core.setOutput("version", version);
}

export function assetName(version, platform, arch) {
  const os = OS[platform];
  const goarch = ARCH[arch];
  if (!os || !goarch) {
    throw new Error(`kong-harnesses has no release for ${platform}/${arch}`);
  }
  return `kong-harnesses_v${version}_${os}_${goarch}.${os === "windows" ? "zip" : "tar.gz"}`;
}

export function verifyChecksum(data, sums, name) {
  const line = sums.split("\n").find((l) => l.trim().split(/\s+/)[1] === name);
  if (!line) {
    throw new Error(`SHA256SUMS.txt has no entry for ${name}`);
  }
  const want = line.trim().split(/\s+/)[0];
  const got = createHash("sha256").update(data).digest("hex");
  if (got !== want) {
    throw new Error(`${name} has SHA-256 ${got}, but SHA256SUMS.txt says ${want}`);
  }
}

function headers(token, accept) {
  const h = { Accept: accept, "User-Agent": "setup-kong-harnesses", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function api(path, token) {
  const res = await fetch(`${API}/${path}`, { headers: headers(token, "application/vnd.github+json") });
  if (!res.ok) {
    throw new Error(
      `GET ${API}/${path} returned ${res.status}: the release does not exist, or the token cannot read ${REPO}`,
    );
  }
  return res.json();
}

// The asset API URL, not browser_download_url, so that a token with read
// access can download from a repository that is not public.
async function download(release, name, token) {
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) {
    throw new Error(`release ${release.tag_name} has no asset ${name}`);
  }
  return tc.downloadTool(asset.url, undefined, undefined, headers(token, "application/octet-stream"));
}
