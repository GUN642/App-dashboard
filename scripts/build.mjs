// Baut die Seite für GitHub Pages.
// Liest apps.json, holt Live-Daten über die GitHub-API und schreibt alles nach site/.
//
// Umgebung:
//   GH_TOKEN            Token für die GitHub-API (in Actions: Secret REPOS_TOKEN, sonst GITHUB_TOKEN)
//   DASHBOARD_PASSWORD  Passwort für die private Ansicht. Ohne Passwort wird keine private Datei erzeugt.
//   DASHBOARD_PLAIN=1   Nur lokal: private Daten zusätzlich unverschlüsselt als all.json schreiben.

import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "site");
const token = process.env.GH_TOKEN || "";
const password = process.env.DASHBOARD_PASSWORD || "";
const WEEKS = 13;

const catalog = JSON.parse(await readFile(path.join(root, "apps.json"), "utf8"));
const owner = catalog.owner;

let useToken = !!token;
async function gh(url, { raw = false } = {}) {
  const headers = {
    "Accept": raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "app-dashboard-build",
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (useToken) headers.Authorization = `Bearer ${token}`; else delete headers.Authorization;
    const res = await fetch(`https://api.github.com${url}`, { headers });
    if (res.status === 401 && useToken) {
      console.warn("  Token ungültig, weiter ohne Token");
      useToken = false;
      continue;
    }
    if (res.status === 404 || res.status === 409) return null; // fehlt oder leeres Repo
    if (res.ok) return raw ? res.text() : res.json();
    if (res.status >= 500) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    console.warn(`  ${url}: HTTP ${res.status}`);
    return null;
  }
  return null;
}

function firstLine(s) { return (s || "").split("\n")[0].trim(); }

async function live(app) {
  const r = `/repos/${owner}/${app.repo}`;
  const repo = await gh(r);
  if (!repo) {
    console.warn(`  ${app.repo}: kein Zugriff (privat ohne passenden Token?)`);
    return { reachable: false };
  }
  const since = new Date(Date.now() - WEEKS * 7 * 864e5).toISOString();
  const [commits, recent, releases, versionFile] = await Promise.all([
    gh(`${r}/commits?per_page=5`),
    gh(`${r}/commits?per_page=100&since=${since}`),
    gh(`${r}/releases?per_page=5`),
    app.versionFile ? gh(`${r}/contents/${app.versionFile}`, { raw: true }) : null,
  ]);

  // Commits je Woche, älteste zuerst
  const activity = new Array(WEEKS).fill(0);
  for (const c of recent || []) {
    const age = (Date.now() - new Date(c.commit.committer.date)) / (7 * 864e5);
    const i = WEEKS - 1 - Math.floor(age);
    if (i >= 0 && i < WEEKS) activity[i]++;
  }

  const rel = (releases || []).find(x => !x.draft);
  const apkAsset = rel?.assets?.find(a => a.name.toLowerCase().endsWith(".apk"));
  let version = rel ? rel.tag_name.replace(/^v/, "") : null;
  let notes = rel?.body ? rel.body.slice(0, 1500) : null;
  if (versionFile) {
    try {
      const v = JSON.parse(versionFile);
      version = v.versionName || version;
      if (Array.isArray(v.notes)) notes = v.notes.map(n => `- ${n}`).join("\n");
    } catch { /* egal */ }
  }

  return {
    reachable: true,
    private: repo.private,
    repoUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
    stars: repo.stargazers_count,
    lastCommit: commits?.[0] ? {
      date: commits[0].commit.committer.date,
      message: firstLine(commits[0].commit.message),
      url: commits[0].html_url,
    } : null,
    commits: (commits || []).map(c => ({ date: c.commit.committer.date, message: firstLine(c.commit.message) })),
    activity,
    release: rel ? {
      tag: rel.tag_name,
      name: rel.name || rel.tag_name,
      date: rel.published_at,
      url: rel.html_url,
      prerelease: rel.prerelease,
      apk: apkAsset ? { url: apkAsset.browser_download_url, name: apkAsset.name, size: apkAsset.size, downloads: apkAsset.download_count } : null,
    } : null,
    version,
    notes,
  };
}

// Für die öffentliche Seite: nur ausgewählte Apps, Links in private Repos entfernen.
function publicView(app) {
  const a = { ...app };
  delete a.public;
  if (a.live?.private) {
    a.live = {
      reachable: true, private: true, lastCommit: a.live.lastCommit ? { date: a.live.lastCommit.date } : null,
      activity: a.live.activity, version: a.live.version, release: null, commits: [], notes: null,
    };
    a.apk = a.apk && !a.apk.includes(`github.com/${owner}/${a.repo}`) ? a.apk : null;
  }
  return a;
}

async function encrypt(obj, pass) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 310000;
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  const b64 = u => Buffer.from(u).toString("base64");
  return { v: 1, kdf: "PBKDF2-SHA256", iterations, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) };
}

// ---------- Neue Repos automatisch finden ----------
// Repos, die weder in apps.json noch in hidden stehen, kommen als Entwurf in die private Ansicht (nie öffentlich).

function cleanMd(s) {
  return s.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseReadme(md) {
  const lines = (md || "").replace(/\r/g, "").split("\n");
  const title = cleanMd((lines.find(l => /^#\s/.test(l)) || "").replace(/^#\s*/, ""));
  // erster echter Absatz nach dem Titel
  let para = "";
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { if (para) break; continue; }
    if (/^(#|!\[|\||>|```|---|- |\* |\d+\. )/.test(l) || /^\*\*[^*]+:\*\*/.test(l)) { if (para) break; continue; }
    const c = cleanMd(l);
    if (c) para += (para ? " " : "") + c;
  }
  // Stichpunkte unter einer Überschrift mit „Funktion“ oder „Features“
  const features = [];
  let inF = false;
  for (const raw of lines) {
    if (/^#{2,3}\s/.test(raw)) { if (inF && features.length) break; inF = /funktion|feature/i.test(raw); continue; }
    if (inF && /^\s*[-*]\s+/.test(raw)) {
      const c = cleanMd(raw.replace(/^\s*[-*]\s+/, ""));
      if (c) features.push(c.length > 140 ? c.slice(0, 137) + "…" : c);
    }
    if (features.length >= 8) break;
  }
  return { title, para, features };
}

function monoFor(name) {
  const words = name.replace(/[^A-Za-z0-9ÄÖÜäöü ]+/g, " ").split(/\s+/).filter(Boolean);
  const m = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "??").slice(0, 2);
  return m.toUpperCase();
}

async function discover() {
  const known = new Set([...catalog.apps.map(a => a.repo.toLowerCase()), ...(catalog.hidden || []).map(r => r.toLowerCase())]);
  const self = (process.env.GITHUB_REPOSITORY || `${owner}/App-dashboard`).split("/")[1].toLowerCase();
  known.add(self);
  let list = null;
  if (useToken) list = await gh(`/user/repos?per_page=100&affiliation=owner&sort=pushed`);
  if (!Array.isArray(list)) list = await gh(`/users/${owner}/repos?per_page=100&sort=pushed`);
  if (!Array.isArray(list)) return [];
  const found = [];
  for (const repo of list) {
    if (repo.owner?.login?.toLowerCase() !== owner.toLowerCase()) continue;
    if (repo.fork || repo.archived || known.has(repo.name.toLowerCase())) continue;
    const r = `/repos/${owner}/${repo.name}`;
    const [readme, rootList] = await Promise.all([
      gh(`${r}/readme`, { raw: true }),
      gh(`${r}/contents/`),
    ]);
    const files = new Set((Array.isArray(rootList) ? rootList : []).map(f => f.name));
    const android = files.has("app") && (files.has("build.gradle.kts") || files.has("build.gradle")) || files.has("android");
    const web = repo.has_pages || files.has("index.html") || files.has("web");
    const info = parseReadme(readme);
    const [titleName, titleSub] = info.title.split(/\s+[–—-]\s+/, 2);
    const name = titleName || repo.name.replace(/[-_]+/g, " ");
    found.push({
      id: `auto-${repo.name.toLowerCase()}`,
      name,
      repo: repo.name,
      public: false,
      auto: true,
      kind: android && web ? "web+android" : android ? "android" : "web",
      category: "Neu",
      mono: monoFor(name),
      tagline: repo.description || titleSub || info.para.split(/(?<=\.)\s/)[0] || "Noch ohne Beschreibung.",
      description: info.para || repo.description || "Noch ohne Beschreibung. In apps.json ergänzen.",
      features: info.features,
      tutorial: [],
      ...(repo.has_pages ? { web: `https://${owner.toLowerCase()}.github.io/${repo.name}/` } : {}),
      links: [],
    });
  }
  return found;
}

const discovered = await discover().catch(e => { console.warn(`Suche nach neuen Repos: ${e.message}`); return []; });
if (discovered.length) console.log(`Neue Repos: ${discovered.map(a => a.repo).join(", ")}`);

console.log(`Baue Dashboard für ${owner} (${catalog.apps.length} Apps, Token: ${token ? "ja" : "nein"})`);
const apps = [];
for (const app of [...catalog.apps, ...discovered]) {
  process.stdout.write(`- ${app.name} … `);
  const l = await live(app).catch(e => { console.warn(e.message); return { reachable: false }; });
  console.log(l.reachable ? `${l.version ?? "ohne Version"}, ${l.lastCommit?.date?.slice(0, 10) ?? "?"}` : "ohne Live-Daten");
  apps.push({ ...app, live: l });
}

const generatedAt = new Date().toISOString();
const meta = { owner, title: catalog.title, generatedAt, repo: process.env.GITHUB_REPOSITORY || `${owner}/App-dashboard` };

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "data"), { recursive: true });
await cp(path.join(root, "web"), out, { recursive: true });

const pub = apps.filter(a => a.public).map(publicView);
await writeFile(path.join(out, "data", "public.json"), JSON.stringify({ ...meta, apps: pub }));
console.log(`Öffentlich: ${pub.length} Apps`);

const all = { ...meta, apps };
if (password) {
  await writeFile(path.join(out, "data", "all.enc.json"), JSON.stringify(await encrypt(all, password)));
  console.log(`Privat: ${apps.length} Apps, verschlüsselt`);
} else {
  console.log("Privat: kein DASHBOARD_PASSWORD, private Ansicht wird nicht erzeugt");
}
if (process.env.DASHBOARD_PLAIN === "1") {
  await writeFile(path.join(out, "data", "all.json"), JSON.stringify(all));
  console.log("Lokal: all.json unverschlüsselt geschrieben (nicht veröffentlichen)");
}
await writeFile(path.join(out, ".nojekyll"), "");
