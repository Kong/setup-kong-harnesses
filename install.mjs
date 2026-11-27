import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";

const REPO = "Kong/kong-harnesses";
const API = `https://api.github.com/repos/${REPO}`;
const PACKAGES = "https://api.cloudsmith.io/v1/packages/kong/kong-harnesses/";
const CDN = "https://packages.konghq.com/public/kong-harnesses/raw/names";
const OS = { linux: "linux", darwin: "darwin", win32: "windows" };
const ARCH = { x64: "amd64", arm64: "arm64" };

export async function run() {
  const token = core.getInput("token");
  const wanted = parseVersion(core.getInput("kong-harnesses-version"));
  const { version, download } = await resolveRelease(wanted, token);
  core.info(`Installing kong-harnesses ${version}`);

  let dir = tc.find("kong-harnesses", version);
  if (!dir) {
    const name = assetName(version, process.platform, process.arch);
    const archive = await download(name);
    const sums = await readFile(await download("SHA256SUMS.txt"), "utf8");
    verifyChecksum(await readFile(archive), sums, name);
    const extracted = name.endsWith(".zip") ? await tc.extractZip(archive) : await tc.extractTar(archive);
    dir = await tc.cacheDir(extracted, "kong-harnesses", version);
  }

  core.addPath(dir);
  core.setOutput("version", version);

  const runtime = await runtimeDir(process.env, process.platform, process.env.RUNNER_TEMP || tmpdir());
  if (runtime) {
    core.exportVariable("XDG_RUNTIME_DIR", runtime);
  }
}

// On Linux, kong-harnesses takes its profile lock in XDG_RUNTIME_DIR, which a
// desktop sign-in creates and a hosted runner does not have. mkdtemp creates
// the directory with mode 0700, which the lock requires.
export async function runtimeDir(env, platform, parent) {
  if (platform !== "linux" || isAbsolute(env.XDG_RUNTIME_DIR ?? "")) {
    return "";
  }
  return mkdtemp(join(parent, "kong-harnesses-runtime-"));
}

// The version goes into the API path, so anything but a plain version, such
// as "../../other/repo", could point the download at another repository.
export function parseVersion(input) {
  const version = input.trim().replace(/^v/, "");
  if (version && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
    throw new Error(`kong-harnesses-version "${input}" is not a version such as 0.21.0`);
  }
  return version;
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
  const entries = sums.split("\n").map((line) => line.trim().split(/\s+/)).filter((entry) => entry[1] === name);
  if (entries.length === 0) {
    throw new Error(`SHA256SUMS.txt has no entry for ${name}`);
  }
  if (entries.length !== 1) throw new Error(`SHA256SUMS.txt has duplicate entries for ${name}`);
  const want = entries[0][0];
  const got = createHash("sha256").update(data).digest("hex");
  if (got !== want) {
    throw new Error(`${name} has SHA-256 ${got}, but SHA256SUMS.txt says ${want}`);
  }
}

// The release job uploads the provenance bundle after the archives and checksums.
async function publicVersion(wanted) {
  const url = new URL(PACKAGES);
  const query = "name:^kong-harnesses-sigstore-json$";
  url.searchParams.set("query", wanted ? `${query} version:^${wanted}$` : query);
  url.searchParams.set("page_size", "100");
  const versions = [];
  for (let page = 1; ; page++) {
    url.searchParams.set("page", String(page));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
    for (const pkg of await res.json()) {
      if (!pkg.is_downloadable || pkg.filename !== `kong-harnesses_v${pkg.version}.sigstore.json`) continue;
      if (wanted && pkg.version === wanted) return wanted;
      if (!wanted && tc.isExplicitVersion(pkg.version)) versions.push(pkg.version);
    }
    if (page >= Number(res.headers.get("x-pagination-pagetotal"))) break;
  }
  return tc.evaluateVersions(versions, "*");
}

export async function resolveRelease(wanted, token) {
  const version = await publicVersion(wanted);
  if (version) {
    return {
      version,
      download(name) {
        const pkg = name.replace(`_v${version}`, "").toLowerCase().replace(/[_.]/g, "-");
        return tc.downloadTool(`${CDN}/${pkg}/versions/${version}/${name}`);
      },
    };
  }

  if (!wanted || !token) throw new Error(`No public kong-harnesses release for ${wanted || "the latest stable version"}`);
  const release = await api(`releases/tags/v${wanted}`, token);
  return { version: wanted, download: (name) => downloadGitHubAsset(release, name, token) };
}

function headers(token, accept) {
  const h = { Accept: accept, "User-Agent": "setup-kong-harnesses", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function api(path, token) {
  const res = await fetch(`${API}/${path}`, { headers: headers(token, "application/vnd.github+json") });
  if (res.status === 404) {
    throw new Error(`GET ${API}/${path} returned 404: the release does not exist, or the token cannot read ${REPO}`);
  }
  if (!res.ok) {
    throw new Error(`GET ${API}/${path} returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// The asset API URL, not browser_download_url, so that a token with read
// access can download from a repository that is not public.
async function downloadGitHubAsset(release, name, token) {
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) {
    throw new Error(`release ${release.tag_name} has no asset ${name}`);
  }
  return tc.downloadTool(asset.url, undefined, undefined, headers(token, "application/octet-stream"));
}
