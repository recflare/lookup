/* roomindex UI: search rooms by name or blob, show everything about a room. */
(() => {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const form = $("#search");
  const qInput = $("#q");
  const results = $("#results");
  const detail = $("#detail");
  const layout = $("#layout");
  const tpl = $("#tpl-result");

  const IMG_BASE = "https://img.rec.net/";
  const ROLE_NAMES = { 255: "Owner" };

  // Columns shown in the room header; everything else lands in "All fields".
  const HEAD_FIELDS = new Set([
    "id", "source_room_id", "name", "description", "image_filename", "creator_account_id",
    "created_at", "published_at", "max_players",
  ]);
  const JSON_FIELDS = ["stats", "ranking_context", "localization_context", "promo_images", "promo_external_content", "load_screens"];

  let currentRoomId = null;
  let lastMatches = [];
  let lastResults = [];

  // ---------- helpers ----------------------------------------------------

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function fmtDate(v) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  }

  function fmtBytes(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return String(n);
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  function fmtNum(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x.toLocaleString("en-US") : String(n);
  }

  function roleName(n) {
    if (n === null || n === undefined) return "";
    return ROLE_NAMES[n] ? `${ROLE_NAMES[n]} (${n})` : `Role ${n}`;
  }

  function cell(key, v) {
    if (v === null || v === undefined || v === "") return '<span class="null">empty</span>';
    if (typeof v === "boolean") return `<span class="${v ? "bool-true" : "bool-false"}">${v ? "yes" : "no"}</span>`;
    if (/_at$/.test(key) && typeof v === "string") return esc(fmtDate(v));
    if (/size_bytes$/.test(key)) return `${esc(fmtBytes(v))} <span class="null">(${esc(v)})</span>`;
    if (typeof v === "object") return `<pre class="json">${esc(JSON.stringify(v, null, 2))}</pre>`;
    if (/(account_id|creator_player_id|user_id)$/.test(key)) return `${accountLink(v)}${copyBtn(v)}`;
    if (/(_key|_hash|sha256|_id|filename|replication_id|ranked_entity_id)$/.test(key)) return `<span class="mono">${esc(v)}</span>${copyBtn(v)}`;
    return esc(v);
  }

  function accountLink(id) {
    return `<a class="mono" href="/?by=account&q=${encodeURIComponent(id)}" title="Rooms for this account">${esc(id)}</a>`;
  }

  function copyBtn(text) {
    return `<button type="button" class="copy" data-copy="${esc(text)}" title="Copy">copy</button>`;
  }

  function kvTable(obj, keys) {
    const rows = keys
      .filter((k) => k in obj)
      .map((k) => `<tr><th>${esc(k)}</th><td class="${/(_key|_hash|sha256)$/.test(k) ? "mono" : ""}">${cell(k, obj[k])}</td></tr>`)
      .join("");
    return `<table class="kv">${rows}</table>`;
  }

  function section(title, count, bodyHtml, open) {
    const c = count === null || count === undefined ? "" : `<span class="count">${esc(count)}</span>`;
    return `<details class="section"${open ? " open" : ""}><summary>${esc(title)} ${c}</summary><div class="body">${bodyHtml}</div></details>`;
  }

  function img(filename, cls) {
    if (!filename) return `<img class="${cls} missing" alt="">`;
    return `<img class="${cls}" alt="" loading="lazy" src="${esc(IMG_BASE + filename)}" onerror="this.classList.add('missing')">`;
  }

  async function getJson(url) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
    return body;
  }

  function setStatus(el, text, isError) {
    el.innerHTML = `<div class="status${isError ? " error" : ""}">${esc(text)}</div>`;
  }

  // ---------- URL state --------------------------------------------------

  function readState() {
    const p = new URLSearchParams(location.search);
    const by = ["name", "blob", "account"].includes(p.get("by")) ? p.get("by") : "name";
    return { q: p.get("q") || "", by, room: p.get("room") || "" };
  }

  function writeState(state, push) {
    const p = new URLSearchParams();
    if (state.q) { p.set("by", state.by); p.set("q", state.q); }
    if (state.room) p.set("room", state.room);
    const url = p.toString() ? `/?${p}` : "/";
    if (push) history.pushState(state, "", url); else history.replaceState(state, "", url);
  }

  function currentState() {
    return { q: qInput.value.trim(), by: form.elements.by.value, room: currentRoomId || "" };
  }

  // ---------- search -----------------------------------------------------

  async function runSearch(q, by) {
    if (!q) return [];
    setStatus(results, "Searching…");
    try {
      const data = await getJson(`/api/search?by=${encodeURIComponent(by)}&q=${encodeURIComponent(q)}`);
      lastResults = data.results;
      renderResults(data);
      return data.results;
    } catch (err) {
      setStatus(results, `Search failed: ${err.message}`, true);
      return [];
    }
  }

  function matchesFor(id) {
    const hit = lastResults.find((r) => r.id === String(id));
    return hit ? hit.matches || [] : [];
  }

  function renderResults(data) {
    results.innerHTML = "";
    if (data.results.length === 0) {
      results.innerHTML = `<div class="empty"><p>No rooms match <b>${esc(data.q)}</b> by ${data.by}.</p>
        <p class="hint">${data.by === "blob"
          ? "Try the bare key without its suffix, or the base64 hash. Keys are case-sensitive."
          : data.by === "account"
          ? "Enter the numeric account id. Usernames only work when the accounts table is loaded."
          : "Name search is case-insensitive and matches anywhere in the name. Room ids also work."}</p></div>`;
      return;
    }
    const head = document.createElement("div");
    head.className = "status";
    const cap = data.by === "account" ? 200 : 50;
    head.textContent = `${data.count} room${data.count === 1 ? "" : "s"}${data.count >= cap ? ` (first ${cap})` : ""}`;
    results.appendChild(head);

    for (const r of data.results) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = r.id;
      const im = $(".thumb", node);
      if (r.image_filename) { im.src = IMG_BASE + r.image_filename; im.onerror = () => im.classList.add("missing"); }
      else im.classList.add("missing");
      $(".card-title", node).textContent = r.name;
      const bits = [`#${r.id}`];
      if (r.source_room_id) bits.push(`source ${r.source_room_id}`);
      if (r.subroom_count) bits.push(`${r.subroom_count} subroom${r.subroom_count === 1 ? "" : "s"}`);
      if (r.stats && r.stats.VisitCount != null) bits.push(`${fmtNum(r.stats.VisitCount)} visits`);
      if (r.created_at) bits.push(`created ${fmtDate(r.created_at).slice(0, 10)}`);
      $(".card-meta", node).textContent = bits.join("  ·  ");
      const desc = $(".card-desc", node);
      if (r.description) desc.textContent = r.description; else desc.remove();
      const tags = $(".tags", node);
      if (r.tags && r.tags.length) tags.innerHTML = r.tags.slice(0, 8).map((t) => `<li>${esc(t)}</li>`).join("");
      else tags.remove();
      const m = $(".matches", node);
      if (r.matches && r.matches.length) {
        const accountRelations = r.matches.filter((x) => x.kind === "account");
        m.innerHTML = accountRelations.length
          ? `<div class="match account"><span class="chain">${accountRelations.map(relationText).map(esc).join(" · ")}</span></div>`
          : r.matches.map(matchHtml).join("");
      } else m.remove();
      node.addEventListener("click", () => openRoom(r.id, r.matches || [], true));
      node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRoom(r.id, r.matches || [], true); } });
      results.appendChild(node);
    }
    markActive();
  }

  function relationText(m) {
    return m.relation === "creator" ? "created this room"
      : m.relation === "role" ? `holds ${roleName(m.role)}`
      : m.relation === "subroom_creator" ? `created ${m.count} subroom${m.count === 1 ? "" : "s"}`
      : `saved ${m.count} time${m.count === 1 ? "" : "s"}`;
  }

  function matchHtml(m) {
    const key = m.matched_key || m.matched_hash;
    if (m.kind === "asset_bundle") {
      const when = m.save_created_at ? ` · ${fmtDate(m.save_created_at).slice(0, 10)}` : "";
      return `<div class="match"><span class="key">${esc(key)}</span>
        <div class="chain">bundle (target ${esc(m.bundle_target)}) of unity asset <span class="mono">${esc(m.unity_asset_id)}</span>,
        source of save #${esc(m.save_id)} in subroom <b>${esc(m.subroom_name || m.subroom_id)}</b>${when}</div></div>`;
    }
    if (m.kind === "save") {
      const when = m.save_created_at ? ` · ${fmtDate(m.save_created_at).slice(0, 10)}` : "";
      return `<div class="match"><span class="key">${esc(key)}</span>
        <div class="chain">save #${esc(m.save_id)} of subroom <b>${esc(m.subroom_name || m.subroom_id)}</b>${when}</div></div>`;
    }
    return `<div class="match"><span class="key">${esc(key)}</span><div class="chain">room metadata blob</div></div>`;
  }

  function assetHtml(sv, assetsById, hitKeys) {
    const id = sv.source_unity_asset_id;
    if (!id) return "";
    const a = assetsById.get(id);
    if (!a) return `<div class="asset"><p class="note">Source unity asset <span class="mono">${esc(id)}</span> is not in the unity_assets table.</p></div>`;
    const bundleHit = a.bundles.some((b) => hitKeys.has(b.asset_key) || hitKeys.has(b.asset_hash));
    const bundles = a.bundles.length
      ? `<table><tr><th>target</th><th>version</th><th>asset key</th><th>hash</th><th>size</th><th>uploaded</th></tr>
        ${a.bundles.map((b) => {
          const hit = hitKeys.has(b.asset_key) || hitKeys.has(b.asset_hash);
          return `<tr class="${hit ? "hit" : ""}"><td>${esc(b.target)}</td><td>${esc(b.version ?? "")}</td>
            <td class="mono">${esc(b.asset_key)}${copyBtn(b.asset_key)}</td><td class="mono">${esc(b.asset_hash || "")}</td>
            <td>${b.size_bytes != null ? esc(fmtBytes(b.size_bytes)) : ""}</td><td>${esc(fmtDate(b.uploaded_at) || "")}</td></tr>`;
        }).join("")}</table>`
      : '<p class="null">No bundles recorded.</p>';
    return `<details class="asset"${bundleHit ? " open" : ""}>
      <summary><b>Source unity asset</b> <span class="mono">${esc(a.unity_asset_id)}</span>${copyBtn(a.unity_asset_id)}
        <span class="note">${a.bundles.length} bundle${a.bundles.length === 1 ? "" : "s"} · ${fmtNum(a.subasset_count)} subassets${bundleHit ? " · matched blob" : ""}</span></summary>
      <div class="body">
        ${kvTable(a, ["origin_id", "asset_hash", "created_by_account_id", "first_seen_at", "meta_filled_at", "subasset_count"])}
        <h5>Bundles</h5>
        ${bundles}
        ${a.raw_json ? `<details><summary class="note">raw JSON</summary><pre class="json">${esc(JSON.stringify(a.raw_json, null, 2))}</pre></details>` : ""}
      </div></details>`;
  }

  function markActive() {
    for (const c of results.querySelectorAll(".card")) c.classList.toggle("active", c.dataset.id === currentRoomId);
  }

  // ---------- room detail ------------------------------------------------

  async function openRoom(id, matches, push) {
    currentRoomId = String(id);
    lastMatches = matches && matches.length ? matches : matchesFor(id);
    markActive();
    layout.classList.add("showing-detail");
    writeState(currentState(), push);
    setStatus(detail, "Loading room…");
    try {
      const data = await getJson(`/api/rooms/${encodeURIComponent(id)}`);
      renderRoom(data, push);
    } catch (err) {
      setStatus(detail, `Could not load room ${id}: ${err.message}`, true);
    }
  }

  function closeRoom() {
    currentRoomId = null;
    layout.classList.remove("showing-detail");
    markActive();
    writeState(currentState(), true);
    detail.innerHTML = '<div class="empty quiet"><p>Pick a room to see everything stored about it.</p></div>';
  }

  function renderRoom(d, scrollTo) {
    const r = d.room;
    const hitKeys = new Set(lastMatches.flatMap((m) => [m.matched_key, m.matched_hash]).filter(Boolean));
    const hitAssets = new Set(lastMatches.map((m) => m.unity_asset_id).filter(Boolean));
    const assetsById = new Map((d.unity_assets || []).map((a) => [a.unity_asset_id, a]));

    const creator = d.creator
      ? `${esc(d.creator.display_name || d.creator.username || "")} ${accountLink(d.creator.account_id)}`
      : r.creator_account_id ? `account ${accountLink(r.creator_account_id)}` : '<span class="null">unknown</span>';

    const facts = [
      `<span>creator <b>${creator}</b></span>`,
      r.created_at ? `<span>created <b>${esc(fmtDate(r.created_at))}</b></span>` : "",
      r.published_at ? `<span>published <b>${esc(fmtDate(r.published_at))}</b></span>` : "",
      r.max_players != null ? `<span>max players <b>${esc(r.max_players)}</b></span>` : "",
      r.stats && r.stats.VisitCount != null ? `<span>visits <b>${esc(fmtNum(r.stats.VisitCount))}</b></span>` : "",
      r.stats && r.stats.CheerCount != null ? `<span>cheers <b>${esc(fmtNum(r.stats.CheerCount))}</b></span>` : "",
      r.stats && r.stats.FavoriteCount != null ? `<span>favorites <b>${esc(fmtNum(r.stats.FavoriteCount))}</b></span>` : "",
    ].filter(Boolean).join("");

    const head = `
      <div class="room-head">
        ${img(r.image_filename, "")}
        <div>
          <h2>${esc(r.name)}</h2>
          <p class="ids">room <span class="mono">#${esc(r.id)}</span>${r.source_room_id ? ` · source id <span class="mono">${esc(r.source_room_id)}</span>${copyBtn(r.source_room_id)}` : ""}
             ${r.meta_blob_key ? ` · meta blob <span class="mono${hitKeys.has(r.meta_blob_key) ? " key" : ""}">${esc(r.meta_blob_key)}</span>${copyBtn(r.meta_blob_key)}` : ""}</p>
          ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ""}
          <div class="facts">${facts}</div>
        </div>
      </div>`;

    // Tags
    const tagsHtml = d.tags.length
      ? `<ul class="chips">${d.tags.map((t) => `<li class="${t.is_primary_genre ? "primary" : ""}" title="type ${esc(t.type)}">${esc(t.tag)}${t.is_primary_genre ? " (primary genre)" : ""}</li>`).join("")}</ul>`
      : '<p class="null">No tags.</p>';

    // Subrooms and saves
    const savesBySubroom = new Map();
    for (const s of d.saves) {
      if (!savesBySubroom.has(s.subroom_id)) savesBySubroom.set(s.subroom_id, []);
      savesBySubroom.get(s.subroom_id).push(s);
    }
    const subroomKeys = ["id", "source_subroom_id", "source_unity_scene_id", "creator_account_id", "is_sandbox", "max_players", "accessibility",
      "last_moderated_save_moderation_state", "should_auto_stage_saves", "staged_subroom_data_save_id", "current_save_id"];
    const saveKeys = ["id", "source_save_id", "source_unity_asset_id", "data_blob_key", "data_blob_hash", "persistence_version", "ugc_sub_version",
      "om_version", "saved_by_account_id", "saved_on_platform", "saved_on_device_class", "description", "moderation_state", "tags",
      "created_at", "imported_at", "htr_file_count", "unity_asset_count"];
    const saveHit = (sv) => hitKeys.has(sv.data_blob_key) || hitKeys.has(sv.data_blob_hash) || hitAssets.has(sv.source_unity_asset_id);
    const hasHit = (s) => (savesBySubroom.get(s.id) || []).some(saveHit);
    const orderedSubrooms = [...d.subrooms].sort((a, b) => Number(hasHit(b)) - Number(hasHit(a)));
    const subroomsHtml = orderedSubrooms.length
      ? orderedSubrooms.map((s) => {
          const saves = savesBySubroom.get(s.id) || [];
          const anyHit = hasHit(s);
          const savesHtml = saves.length
            ? saves.map((sv) => {
                const isCurrent = s.current_save_id && sv.id === s.current_save_id;
                const isHit = saveHit(sv);
                return `<div class="save${isCurrent ? " current" : ""}${isHit ? " hit" : ""}">
                  <div class="head"><b>save #${esc(sv.id)}</b>
                    ${isCurrent ? '<span class="tag">current</span>' : ""}${isHit ? '<span class="tag hit">matched blob</span>' : ""}
                    <span class="mono">${esc(sv.data_blob_key)}</span>${copyBtn(sv.data_blob_key)}
                    ${sv.created_at ? `<span class="null">${esc(fmtDate(sv.created_at))}</span>` : ""}</div>
                  ${kvTable(sv, saveKeys)}
                  ${assetHtml(sv, assetsById, hitKeys)}
                  ${sv.raw_json ? `<details><summary class="note">raw JSON</summary><pre class="json">${esc(JSON.stringify(sv.raw_json, null, 2))}</pre></details>` : ""}
                </div>`;
              }).join("")
            : '<p class="null">No saves recorded.</p>';
          return `<details class="subroom"${anyHit || (!hitKeys.size && d.subrooms.length <= 3) ? " open" : ""}>
            <summary><h4>${esc(s.name || "(unnamed)")}</h4>
              <span class="meta">#${esc(s.id)} · source ${esc(s.source_subroom_id)} · ${saves.length} save${saves.length === 1 ? "" : "s"}${s.is_sandbox ? " · sandbox" : ""}${anyHit ? " · contains matched blob" : ""}</span></summary>
            <div class="body">
              ${kvTable(s, subroomKeys)}
              ${s.raw_json ? `<details><summary class="note">raw JSON</summary><pre class="json">${esc(JSON.stringify(s.raw_json, null, 2))}</pre></details>` : ""}
              <h5>Saves</h5>
              ${savesHtml}
            </div></details>`;
        }).join("")
      : '<p class="null">No subrooms recorded.</p>';

    // Roles
    const rolesHtml = d.roles.length
      ? `<table><tr><th>account</th><th>name</th><th>role</th><th>invited role</th><th>changed by</th></tr>
        ${d.roles.map((x) => `<tr><td>${accountLink(x.account_id)}</td><td>${esc(x.display_name || x.username || "")}</td>
          <td>${esc(roleName(x.role))}</td><td>${x.invited_role ? esc(roleName(x.invited_role)) : ""}</td><td>${x.last_changed_by_account_id ? accountLink(x.last_changed_by_account_id) : ""}</td></tr>`).join("")}</table>
        ${d.roles_total > d.roles.length ? `<p class="note">Showing ${d.roles.length} of ${d.roles_total}.</p>` : ""}`
      : '<p class="null">No roles recorded.</p>';

    // Inventions
    const invHtml = d.inventions.length
      ? `<table><tr><th>id</th><th>name</th><th>creator</th><th>published</th><th>downloads</th><th>cheers</th><th>created</th></tr>
        ${d.inventions.map((i) => `<tr><td class="mono">${esc(i.source_invention_id || i.id)}</td><td>${esc(i.name)}</td><td>${i.creator_player_id ? accountLink(i.creator_player_id) : ""}</td>
          <td>${cell("is_published", i.is_published)}</td><td>${esc(fmtNum(i.num_downloads))}</td><td>${esc(fmtNum(i.cheer_count))}</td><td>${esc(fmtDate(i.created_at) || "")}</td></tr>`).join("")}</table>
        ${d.inventions_total > d.inventions.length ? `<p class="note">Showing ${d.inventions.length} of ${d.inventions_total}.</p>` : ""}`
      : '<p class="null">No inventions were created in this room.</p>';

    // All scalar fields
    const scalarKeys = Object.keys(r).filter((k) => !HEAD_FIELDS.has(k) && !JSON_FIELDS.includes(k) && k !== "raw_json");
    const fieldsHtml = kvTable(r, scalarKeys);

    const jsonHtml = JSON_FIELDS.map((k) => r[k] == null
      ? `<p><span class="mono">${esc(k)}</span> <span class="null">empty</span></p>`
      : `<details open><summary class="note">${esc(k)}</summary><pre class="json">${esc(JSON.stringify(r[k], null, 2))}</pre></details>`).join("");

    const archiveHtml = r.archived_at
      ? kvTable(r, ["archived_at", "archive_size_bytes", "archive_sha256"])
      : '<p class="null">Not archived.</p>';

    const rawHtml = r.raw_json
      ? `<pre class="json">${esc(JSON.stringify(r.raw_json, null, 2))}</pre>`
      : '<p class="null">No raw JSON stored.</p>';

    detail.innerHTML = `
      <button type="button" class="back" id="back">Back to results</button>
      <article class="room">
        ${head}
        ${section("Tags", d.tags.length, tagsHtml, true)}
        ${section("Subrooms and saves", `${d.subrooms.length} subroom${d.subrooms.length === 1 ? "" : "s"}, ${d.saves.length} save${d.saves.length === 1 ? "" : "s"}`, subroomsHtml, true)}
        ${section("Roles", d.roles_total, rolesHtml, false)}
        ${section("Inventions created here", d.inventions_total, invHtml, false)}
        ${section("All fields", scalarKeys.length, fieldsHtml, false)}
        ${section("Stats and JSON fields", null, jsonHtml, false)}
        ${section("Archive", null, archiveHtml, false)}
        ${section("Raw JSON", r.raw_json ? fmtBytes(JSON.stringify(r.raw_json).length) : 0, rawHtml, false)}
      </article>`;
    $("#back").addEventListener("click", closeRoom);
    if (scrollTo) detail.scrollIntoView({ block: "start" });
  }

  // ---------- wiring -----------------------------------------------------

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const s = currentState();
    writeState({ ...s, room: "" }, true);
    currentRoomId = null;
    layout.classList.remove("showing-detail");
    runSearch(s.q, s.by);
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    e.stopPropagation();
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "copied"; setTimeout(() => (b.textContent = "copy"), 1200); }
    catch { b.textContent = "copy failed"; }
  });

  window.addEventListener("popstate", () => boot(false));

  async function boot() {
    const s = readState();
    qInput.value = s.q;
    form.elements.by.value = s.by;
    if (s.room) {
      currentRoomId = s.room;
      layout.classList.add("showing-detail");
      setStatus(detail, "Loading room…");
    } else {
      currentRoomId = null;
      layout.classList.remove("showing-detail");
    }
    // Wait for blob matches so the room view can highlight the matching save.
    if (s.q) await runSearch(s.q, s.by);
    if (s.room) openRoom(s.room, [], false);
    if (!s.q && !s.room) qInput.focus();
  }
  boot();
})();
