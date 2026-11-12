// VOID Apps · Dashboard
// Öffentlich: data/public.json. Privat (/mein/): data/all.enc.json, mit Passwort entschlüsselt.
(() => {
  "use strict";

  const MODE = document.body.dataset.mode === "private" ? "private" : "public";
  const BASE = MODE === "private" ? "../" : "./";
  const LS = {
    pw: "voidapps.pw",
    token: "voidapps.token",
    sort: "voidapps.sort",
  };

  const state = {
    data: null,
    filter: "alle",
    query: "",
    sort: store(LS.sort) || "update",
    saving: new Map(),
  };

  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch { return null; }
  }

  // ---------- Zeit ----------
  const DAY = 864e5;
  function ago(iso) {
    if (!iso) return "unbekannt";
    const d = new Date(iso);
    const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / DAY);
    if (days <= 0) return "heute";
    if (days === 1) return "gestern";
    if (days < 7) return `vor ${days} Tagen`;
    if (days < 14) return "vor 1 Woche";
    if (days < 60) return `vor ${Math.floor(days / 7)} Wochen`;
    if (days < 365) return `vor ${Math.floor(days / 30)} Monaten`;
    return dateStr(iso);
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function dateStr(iso) { return iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : ""; }
  function timeStr(iso) { return iso ? new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; }
  function lastUpdate(a) { return a.live?.lastCommit?.date || a.live?.pushedAt || a.live?.release?.date || null; }
  function bytes(n) { return n > 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} MB` : `${Math.round(n / 1e3)} KB`; }

  // ---------- Links ----------
  const KIND = { android: "Android", web: "Web", "web+android": "Web + Android" };
  function apkLink(a) { return a.apk || a.live?.release?.apk?.url || null; }
  function repoLink(a) {
    if (a.live?.repoUrl) return a.live.repoUrl;
    if (MODE === "private" || !a.live?.private) return `https://github.com/${state.data.owner}/${a.repo}`;
    return null;
  }

  // ---------- Darstellung ----------
  function activity(a) {
    const w = a.live?.activity;
    if (!w) return "";
    const max = Math.max(1, ...w);
    const dots = w.map((n, i) => {
      const lvl = n === 0 ? "" : n / max > .66 ? "l3" : n / max > .33 ? "l2" : "l1";
      return `<i class="${lvl}${i === w.length - 1 && n ? " now" : ""}" title="${n} Änderungen"></i>`;
    }).join("");
    const sum = w.reduce((s, n) => s + n, 0);
    return `<span class="activity" aria-label="${sum} Änderungen in 13 Wochen" title="${sum} Änderungen in 13 Wochen">${dots}</span>`;
  }

  function pills(a, { vis = false } = {}) {
    const p = [`<span class="pill">${esc(KIND[a.kind] || a.kind)}</span>`, `<span class="pill">${esc(a.category)}</span>`];
    if (a.live?.version) p.push(`<span class="pill solid">v${esc(a.live.version)}</span>`);
    if (vis) p.push(a.public ? `<span class="pill red">Öffentlich</span>` : `<span class="pill">Nur ich</span>`);
    if (MODE === "private" && a.live?.private) p.push(`<span class="pill">Privates Repo</span>`);
    return `<div class="pills">${p.join("")}</div>`;
  }

  function actions(a, big = false) {
    const cls = big ? "btn" : "btn small";
    const out = [];
    if (a.web) out.push(`<a class="${cls} primary" href="${esc(a.web)}" target="_blank" rel="noopener">Öffnen ↗</a>`);
    const apk = apkLink(a);
    if (apk) out.push(`<a class="${cls}${a.web ? "" : " primary"}" href="${esc(apk)}" rel="noopener">APK ↓</a>`);
    const repo = repoLink(a);
    if (big && a.live?.release?.url && (MODE === "private" || !a.live.private)) out.push(`<a class="${cls}" href="${esc(a.live.release.url)}" target="_blank" rel="noopener">Release</a>`);
    if (repo) out.push(`<a class="${cls}" href="${esc(repo)}" target="_blank" rel="noopener">GitHub</a>`);
    for (const l of a.links || []) out.push(`<a class="${cls}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`);
    return `<div class="actions">${out.join("")}</div>`;
  }

  function card(a) {
    const upd = lastUpdate(a);
    const msg = MODE === "private" ? a.live?.lastCommit?.message : "";
    const vis = MODE === "private" ? `
      <div class="vis" title="Auf der öffentlichen Seite zeigen">
        <button class="switch" role="switch" aria-checked="${state.saving.has(a.id) ? state.saving.get(a.id) : a.public}" aria-label="Öffentlich: ${esc(a.name)}" data-toggle="${esc(a.id)}" ${state.saving.has(a.id) ? "disabled" : ""}></button>
      </div>` : "";
    return `
      <article class="card${vis ? " has-vis" : ""}" data-id="${esc(a.id)}" tabindex="0" aria-label="${esc(a.name)}">
        ${vis}
        <div class="card-top">
          <div class="mono" aria-hidden="true">${esc(a.mono)}</div>
          <div style="min-width:0">
            <h2>${esc(a.name)}</h2>
            <p class="tagline">${esc(a.tagline)}</p>
          </div>
        </div>
        ${pills(a, { vis: MODE === "private" })}
        <div class="card-meta">
          <div class="updated">Update <b>${esc(ago(upd))}</b>${msg ? `<span class="msg">${esc(msg)}</span>` : ""}</div>
          ${activity(a)}
        </div>
        ${actions(a)}
      </article>`;
  }

  function categories() {
    const set = new Set();
    for (const a of state.data.apps) set.add(a.category);
    const base = ["alle", "android", "web"];
    if (MODE === "private") base.push("öffentlich", "nur ich");
    return [...base, ...[...set].sort((x, y) => x.localeCompare(y, "de"))];
  }

  function matches(a) {
    const f = state.filter;
    if (f === "android" && !a.kind.includes("android")) return false;
    if (f === "web" && !a.kind.includes("web")) return false;
    if (f === "öffentlich" && !a.public) return false;
    if (f === "nur ich" && a.public) return false;
    if (!["alle", "android", "web", "öffentlich", "nur ich"].includes(f) && a.category !== f) return false;
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    return [a.name, a.tagline, a.description, a.category, a.repo, ...(a.features || [])].join(" ").toLowerCase().includes(q);
  }

  function sorted(list) {
    const l = [...list];
    if (state.sort === "name") l.sort((x, y) => x.name.localeCompare(y.name, "de"));
    else l.sort((x, y) => new Date(lastUpdate(y) || 0) - new Date(lastUpdate(x) || 0));
    return l;
  }

  function renderGrid() {
    const list = sorted(state.data.apps.filter(matches));
    $("#grid").innerHTML = list.length ? list.map(card).join("") : `<div class="empty">Keine App gefunden.</div>`;
  }

  function renderChips() {
    $("#chips").innerHTML = categories().map(c =>
      `<button class="chip" data-filter="${esc(c)}" aria-pressed="${c === state.filter}">${esc(c)}</button>`).join("");
  }

  function renderStats() {
    const apps = state.data.apps;
    const newest = apps.map(lastUpdate).filter(Boolean).sort().pop();
    const week = apps.filter(a => { const d = lastUpdate(a); return d && Date.now() - new Date(d) < 7 * DAY; }).length;
    const items = [
      ["Apps", apps.length],
      ["Diese Woche aktiv", week],
      ["Zuletzt", ago(newest)],
    ];
    if (MODE === "private") items.splice(1, 0, ["Öffentlich", apps.filter(a => a.public).length]);
    $("#stats").innerHTML = items.map(([k, v]) => `<div class="stat"><span class="label">${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
  }

  function render() {
    renderStats();
    renderChips();
    renderGrid();
    $("#generated").textContent = `Stand ${timeStr(state.data.generatedAt)}`;
    $("#sort").value = state.sort;
  }

  // ---------- Detail ----------
  function mdLite(s) {
    // Release-Notizen: Markdown grob in Text verwandeln
    return esc(String(s || "")
      .replace(/\r/g, "")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*[-*]\s+/gm, "· ")
      .replace(/\n{3,}/g, "\n\n")
      .trim());
  }

  function openDetail(id, push = true) {
    const a = state.data.apps.find(x => x.id === id);
    if (!a) return;
    const l = a.live || {};
    const rel = l.release;
    const facts = [
      ["Letztes Update", lastUpdate(a) ? `${dateStr(lastUpdate(a))} · ${ago(lastUpdate(a))}` : "unbekannt"],
      ["Version", l.version ? `v${l.version}` : "–"],
    ];
    if (rel?.date) facts.push(["Release", dateStr(rel.date)]);
    if (rel?.apk?.size) facts.push(["APK", bytes(rel.apk.size)]);
    if (MODE === "private" && rel?.apk?.downloads != null) facts.push(["Downloads", rel.apk.downloads]);
    facts.push(["Plattform", KIND[a.kind] || a.kind]);

    const commits = MODE === "private" && l.commits?.length ? `
      <div class="section"><div class="label">Letzte Änderungen</div>
        <ul class="log">${l.commits.map(c => `<li><time>${esc(dateStr(c.date))}</time><span>${esc(c.message)}</span></li>`).join("")}</ul>
      </div>` : "";
    const notes = l.notes ? `
      <div class="section"><div class="label">Neu in v${esc(l.version || "")}</div><pre class="notes">${mdLite(l.notes)}</pre></div>` : "";

    $("#detail").innerHTML = `
      <div class="sheet">
        <button class="close" data-close aria-label="Schließen">✕</button>
        <div class="sheet-head">
          <div class="mono lg" aria-hidden="true">${esc(a.mono)}</div>
          <div style="min-width:0"><h2>${esc(a.name)}</h2>${pills(a, { vis: MODE === "private" })}</div>
        </div>
        <div class="section">${actions(a, true)}</div>
        <div class="section"><div class="label">Beschreibung</div><p>${esc(a.description)}</p></div>
        <div class="section"><div class="label">Stand</div>
          <div class="kv">${facts.map(([k, v]) => `<div><span class="label">${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>
        </div>
        ${a.features?.length ? `<div class="section"><div class="label">Funktionen</div><ul class="features">${a.features.map(f => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
        ${a.tutorial?.length ? `<div class="section"><div class="label">Anleitung</div><ol class="steps">${a.tutorial.map(s => `<li><span>${esc(s)}</span></li>`).join("")}</ol></div>` : ""}
        ${notes}
        ${commits}
      </div>`;
    const dlg = $("#detail");
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    if (push) history.replaceState(null, "", `#${encodeURIComponent(a.id)}`);
  }

  function closeDetail() {
    const dlg = $("#detail");
    if (dlg.open) dlg.close();
  }

  // ---------- Hinweis ----------
  let toastTimer;
  function toast(msg, bad = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("bad", bad);
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), 4200);
  }

  // ---------- Daten laden ----------
  async function loadPublic() {
    const res = await fetch(`${BASE}data/public.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decrypt(blob, pass) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: b64(blob.salt), iterations: blob.iterations },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.iv) }, key, b64(blob.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function loadPrivate(pass) {
    let res = await fetch(`${BASE}data/all.enc.json`, { cache: "no-cache" });
    if (res.ok) return decrypt(await res.json(), pass);
    res = await fetch(`${BASE}data/all.json`, { cache: "no-cache" }); // nur lokal
    if (res.ok) return res.json();
    throw Object.assign(new Error("missing"), { missing: true });
  }

  // ---------- GitHub (privat, optional) ----------
  async function ghApi(path, opts = {}) {
    const token = store(LS.token);
    if (!token) throw new Error("Kein Token hinterlegt");
    const res = await fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
    });
    if (!res.ok) {
      let m = `HTTP ${res.status}`;
      try { m += `: ${(await res.json()).message}`; } catch { /* egal */ }
      throw new Error(m);
    }
    return res.status === 204 ? null : res.json();
  }

  const utf8ToB64 = s => { const b = new TextEncoder().encode(s); let x = ""; for (const c of b) x += String.fromCharCode(c); return btoa(x); };
  const b64ToUtf8 = s => new TextDecoder().decode(b64(s.replace(/\n/g, "")));

  // Schreibzugriffe auf apps.json nacheinander. Die zuletzt geschriebene Fassung (sha) wird gemerkt,
  // weil die Contents-API kurz nach einem Commit noch die alte Fassung liefern kann (sonst HTTP 409).
  let writeQueue = Promise.resolve();
  let lastFile = null; // { sha, json, branch }

  async function readAppsJson() {
    const repo = state.data.repo;
    const branch = lastFile?.branch || (await ghApi(`/repos/${repo}`)).default_branch;
    const file = await ghApi(`/repos/${repo}/contents/apps.json?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, { cache: "no-store" });
    return { sha: file.sha, json: JSON.parse(b64ToUtf8(file.content)), branch };
  }

  async function writePublic(a, value) {
    const repo = state.data.repo;
    let file = lastFile || await readAppsJson();
    for (let attempt = 0; ; attempt++) {
      const json = structuredClone(file.json);
      const entry = json.apps.find(x => x.id === a.id);
      if (!entry) throw new Error(`${a.id} fehlt in apps.json`);
      entry.public = value;
      try {
        const res = await ghApi(`/repos/${repo}/contents/apps.json`, {
          method: "PUT",
          body: JSON.stringify({
            message: `${a.name} ${value ? "öffentlich zeigen" : "nur privat zeigen"}`,
            content: utf8ToB64(JSON.stringify(json, null, 2) + "\n"),
            sha: file.sha,
            branch: file.branch,
          }),
        });
        lastFile = { sha: res.content.sha, json, branch: file.branch };
        return;
      } catch (e) {
        if (!/^HTTP 409/.test(e.message) || attempt >= 4) throw e;
        lastFile = null;
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        file = await readAppsJson();
      }
    }
  }

  function setPublic(id, value) {
    const a = state.data.apps.find(x => x.id === id);
    if (!a) return;
    if (!store(LS.token)) {
      toast("Zum Umschalten erst unten einen GitHub-Token eintragen.", true);
      $("#settings")?.scrollIntoView({ behavior: "smooth" });
      renderGrid();
      return;
    }
    state.saving.set(id, value);
    renderGrid();
    writeQueue = writeQueue.then(async () => {
      try {
        await writePublic(a, value);
        a.public = value;
        toast(`${a.name}: ${value ? "öffentlich" : "nur für dich"}. Die Seite ist in 1 bis 2 Minuten aktuell.`);
      } catch (e) {
        lastFile = null;
        toast(`Nicht gespeichert. ${e.message}`, true);
      } finally {
        state.saving.delete(id);
        renderStats();
        renderGrid();
      }
    });
  }

  async function refreshNow() {
    try {
      const repo = state.data.repo;
      const info = await ghApi(`/repos/${repo}`);
      await ghApi(`/repos/${repo}/actions/workflows/pages.yml/dispatches`, {
        method: "POST", body: JSON.stringify({ ref: info.default_branch }),
      });
      toast("Aktualisierung gestartet. In 1 bis 2 Minuten neu laden.");
    } catch (e) {
      toast(`Start nicht möglich. ${e.message}`, true);
    }
  }

  function renderSettings() {
    const el = $("#settings");
    if (!el) return;
    const has = !!store(LS.token);
    el.innerHTML = `
      <h3>Bearbeiten</h3>
      <p>${has ? "Token ist auf diesem Gerät hinterlegt. Die Schalter oben rechts auf jeder Karte legen fest, was öffentlich erscheint." :
        "Für die Schalter Öffentlich und Nur ich braucht die Seite einen GitHub-Token. Er bleibt nur in diesem Browser."}</p>
      <div class="row">
        ${has ? `<button class="btn small" data-act="refresh">Daten jetzt aktualisieren</button>
                 <button class="btn small" data-act="forget-token">Token entfernen</button>` :
          `<input class="field" id="tokenField" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false">
           <button class="btn small light" data-act="save-token">Speichern</button>`}
        <button class="btn small" data-act="logout">Abmelden</button>
        <a class="btn small" href="../">Öffentliche Seite ↗</a>
      </div>
      ${has ? "" : `<ol>
        <li>GitHub, Settings, Developer settings, Fine-grained tokens, Generate new token.</li>
        <li>Repository access: Only select repositories, nur <code>${esc(state.data.repo.split("/")[1])}</code>.</li>
        <li>Permissions: Contents Read and write, Actions Read and write.</li>
      </ol>`}`;
  }

  // ---------- Ereignisse ----------
  function bind() {
    $("#search").addEventListener("input", e => { state.query = e.target.value; renderGrid(); });
    $("#sort").addEventListener("change", e => { state.sort = e.target.value; store(LS.sort, state.sort); renderGrid(); });
    $("#chips").addEventListener("click", e => {
      const b = e.target.closest("[data-filter]");
      if (!b) return;
      state.filter = b.dataset.filter;
      renderChips();
      renderGrid();
    });
    $("#grid").addEventListener("click", e => {
      const t = e.target.closest("[data-toggle]");
      if (t) { e.stopPropagation(); setPublic(t.dataset.toggle, t.getAttribute("aria-checked") !== "true"); return; }
      if (e.target.closest("a")) return;
      const c = e.target.closest(".card");
      if (c) openDetail(c.dataset.id);
    });
    $("#grid").addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("card")) { e.preventDefault(); openDetail(e.target.dataset.id); }
    });
    const dlg = $("#detail");
    dlg.addEventListener("click", e => {
      if (e.target === dlg || e.target.closest("[data-close]")) closeDetail();
    });
    dlg.addEventListener("close", () => history.replaceState(null, "", location.pathname + location.search));
    window.addEventListener("hashchange", () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (id) openDetail(id, false); else closeDetail();
    });
    $("#settings")?.addEventListener("click", e => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "save-token") {
        const v = $("#tokenField").value.trim();
        if (!v) return;
        store(LS.token, v);
        renderSettings();
        toast("Token gespeichert.");
      } else if (act === "forget-token") {
        store(LS.token, null); renderSettings();
      } else if (act === "refresh") {
        refreshNow();
      } else if (act === "logout") {
        store(LS.pw, null); location.reload();
      }
    });
  }

  function start(data) {
    state.data = data;
    document.title = MODE === "private" ? `Alle Apps · ${data.title}` : data.title;
    $("#app").classList.remove("hidden");
    $("#lock")?.classList.add("hidden");
    render();
    renderSettings();
    bind();
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) openDetail(id, false);
  }

  // ---------- Start ----------
  async function boot() {
    if (MODE === "public") {
      try { start(await loadPublic()); }
      catch (e) {
        $("#app").classList.remove("hidden");
        $("#grid").innerHTML = `<div class="empty">Daten konnten nicht geladen werden (${esc(e.message)}).</div>`;
      }
      return;
    }

    const form = $("#lockForm");
    const err = $("#lockErr");
    const tryPass = async (pass, remember) => {
      err.textContent = "";
      form.querySelector("button").disabled = true;
      try {
        const data = await loadPrivate(pass);
        if (remember) store(LS.pw, pass);
        start(data);
      } catch (e) {
        store(LS.pw, null);
        err.textContent = e.missing
          ? "Noch keine privaten Daten. Secret DASHBOARD_PASSWORD anlegen und den Bau neu starten."
          : "Passwort falsch.";
      } finally {
        form.querySelector("button").disabled = false;
      }
    };
    form.addEventListener("submit", e => {
      e.preventDefault();
      tryPass($("#pw").value, $("#remember").checked);
    });
    const saved = store(LS.pw);
    if (saved) tryPass(saved, true);
    else $("#pw").focus();
  }

  boot();
})();
