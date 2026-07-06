/* ============================================================
   DISPOSABLE — prototype logic
   One shared local store simulates the backend, so the Host
   and Guest experiences talk to each other in the same browser
   (and even across two tabs, via the storage event).
   ============================================================ */

"use strict";

/* ---------- tiny utils ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9);
const pad = (n) => String(n).padStart(2, "0");
const fmtNum = (n) => n.toLocaleString("en-US");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function fmtDT(ts) {
  const d = new Date(ts);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtCountdown(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function stampText(ts) {
  const d = new Date(ts);
  return `'${String(d.getFullYear()).slice(2)} ${pad(d.getMonth() + 1)} ${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocalDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toLocalTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- store ---------- */
const KEY = "disposable_proto_v1";
const ROLE_KEY = "disposable_proto_role"; // per-tab, so one tab can be host and another guest

function initialState() {
  return {
    role: null,
    event: null,          // {name, cover, start, end, unlock, revealAt, pkg, max, code, shared, revealed, revealedAt, createdAt}
    guests: [],           // {id, name, sim}
    moments: [],          // {id, guestId, name, kind, ts, removed, sim, seed | frames[]}
    you: { joined: false },
    simRequest: null,     // scripted request {name}
    request: null,        // real guest request {name, contact}
    requestDone: false,
    notifSeen: false,
  };
}

let S = load() || initialState();

function load() {
  let rest = null;
  try { rest = JSON.parse(localStorage.getItem(KEY)); } catch {}
  const role = sessionStorage.getItem(ROLE_KEY) || null;
  if (!rest) return role ? { ...initialState(), role } : null;
  return { ...rest, role };
}
function save() {
  if (S.role) sessionStorage.setItem(ROLE_KEY, S.role);
  const { role, ...shared } = S;
  try {
    localStorage.setItem(KEY, JSON.stringify(shared));
  } catch (e) {
    // storage full: trim the oldest real capture and retry once
    const idx = S.moments.findIndex((m) => !m.sim);
    if (idx > -1) {
      S.moments.splice(idx, 1);
      toast("STORAGE TIGHT — OLDEST MOMENT TRIMMED");
      const retry = { ...S };
      delete retry.role;
      try { localStorage.setItem(KEY, JSON.stringify(retry)); } catch {}
    }
  }
}

/* ---------- constants ---------- */
const PKGS = {
  free:     { label: "Free",     max: 10,  price: 0 },
  starter:  { label: "Starter",  max: 20,  price: 49 },
  standard: { label: "Standard", max: 50,  price: 99 },
  premium:  { label: "Premium",  max: 100, price: 199 },
};
const EXPOSURES = 24;
const SIM_NAMES = ["Lucas", "Elsa", "Hugo", "Alice", "Oscar", "Maja", "Liam", "Astrid", "Noah", "Freja", "William", "Saga", "Elias", "Vera", "Axel", "Stina", "Leo", "Ines", "Melvin", "Tuva"];
const FILM_PAIRS = [
  ["#e8b27c", "#31404f"], ["#dfa08a", "#3d4a33"], ["#e6c98f", "#5a3a3a"],
  ["#c9906a", "#26343d"], ["#e0b4a0", "#454037"], ["#d9a05b", "#3a2f42"],
];
const BLOB_COLORS = ["#ff8a50", "#ffd9a0", "#7fa8a0", "#e8e0c8", "#c47a5a", "#9db3a8"];

/* ============================================================
   CAPTURE PIPELINE — store the raw photo; the film look is CSS
   ============================================================ */
// capture the RAW photo (cover-cropped, good quality). The disposable look
// (grain / warm-green tint / vignette / date stamp) is applied at DISPLAY time
// with CSS, so the stored image stays sharp and the filter can be toggled off.
function captureRaw(source, sw, sh, W, H, mirror, quality = 0.82) {
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const scale = Math.max(W / sw, H / sh);
  const dw = sw * scale, dh = sh * scale;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, dx, dy, dw, dh);
  return cv.toDataURL("image/jpeg", quality);
}

/* ---------- simulated guest "photos" (abstract memories, clean gradients) ---------- */
const simCache = new Map();

function genSimFrame(seed, frame) {
  const key = `${seed}:${frame}`;
  if (simCache.has(key)) return simCache.get(key);

  const W = 540, H = 720;
  const base = mulberry32(seed);
  const jit = mulberry32(seed * 31 + frame * 7);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  const pair = FILM_PAIRS[Math.floor(base() * FILM_PAIRS.length)];
  const bg = ctx.createLinearGradient(0, 0, W * (base() - 0.5), H);
  bg.addColorStop(0, pair[0]);
  bg.addColorStop(1, pair[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const blobs = 2 + Math.floor(base() * 3);
  for (let i = 0; i < blobs; i++) {
    const cx = W * base() + (jit() - 0.5) * 26;
    const cy = H * base() + (jit() - 0.5) * 26;
    const r = W * (0.18 + base() * 0.4);
    const col = BLOB_COLORS[Math.floor(base() * BLOB_COLORS.length)];
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, col + "cc");
    grad.addColorStop(1, col + "00");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  if (base() < 0.45) { // horizon band
    ctx.fillStyle = "rgba(20,15,10,0.32)";
    ctx.fillRect(0, H * (0.62 + base() * 0.2), W, H);
  }

  const url = cv.toDataURL("image/jpeg", 0.72);
  simCache.set(key, url);
  return url;
}

function framesOf(m) {
  if (!m.sim) return m.frames;
  const n = m.kind === "clip" ? 4 : 1;
  return Array.from({ length: n }, (_, i) => genSimFrame(m.seed, i));
}

/* ============================================================
   SCREENS & NAVIGATION
   ============================================================ */
let currentScreen = null;
let draft = null;          // event being created (pre-payment)
let coverData = null;
let albumScope = "all";
let albumView = "feed";

function screenForRole(role) {
  const e = S.event;
  if (role === "host") {
    if (!e) return "s-host-create";
    if (e.revealed) return "s-album";
    if (!e.shared) return "s-host-share";
    return "s-host-dash";
  }
  if (!e) return "s-guest-gate";
  if (e.revealed) return S.you.joined ? "s-album" : "s-guest-join";
  if (S.you.joined) return "s-guest-main";
  if (S.you.requested) return "s-guest-full";
  return "s-guest-join";
}

const enterHooks = {
  "s-host-create": renderCreate,
  "s-host-unlock": renderUnlock,
  "s-host-share": renderShare,
  "s-host-dash": renderDash,
  "s-host-review": enterReview,
  "s-guest-join": renderJoin,
  "s-guest-main": renderGuestMain,
  "s-album": renderAlbum,
};

function go(id) {
  currentScreen = id;
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  if (id !== "s-guest-main") stopCam();
  closeLightbox();
  closeRecap();
  (enterHooks[id] || (() => {}))();
  const stage = $("#" + id);
  if (stage) stage.scrollTop = 0;
}

function setRole(role) {
  S.role = role;
  save();
  $$("#role-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.role === role));
  go(screenForRole(role));
}

function refreshActive() {
  if (currentScreen && enterHooks[currentScreen]) enterHooks[currentScreen]();
}

/* ---------- toast / flash ---------- */
function toast(msg) {
  const t = el("div", "toast", msg);
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
function flashFx() {
  const f = $("#flash-fx");
  f.classList.remove("pop");
  void f.offsetWidth;
  f.classList.add("pop");
}

/* ---------- payment sheet ---------- */
function openPay({ title, eyebrow, price, onDone }) {
  $("#pay-eyebrow").textContent = eyebrow || "PAYMENT · DEMO";
  $("#pay-title").textContent = title;
  const btn = $("#pay-btn");
  btn.textContent = `Pay ${price} SEK`;
  btn.classList.remove("paying");
  $("#sheet-pay").hidden = false;
  btn.onclick = () => {
    btn.classList.add("paying");
    btn.textContent = "Processing…";
    setTimeout(() => {
      btn.textContent = "Paid ✓";
      setTimeout(() => {
        $("#sheet-pay").hidden = true;
        onDone();
      }, 550);
    }, 1100);
  };
}

/* ============================================================
   HOST · CREATE
   ============================================================ */
function renderCreate() {
  const now = Date.now();
  if (!$("#in-date").value) $("#in-date").value = toLocalDate(now);
  if (!$("#in-start").value) $("#in-start").value = toLocalTime(now);
  if (!$("#in-end").value) $("#in-end").value = toLocalTime(now + 3 * 3600e3);
  updateOvernightHint();
}

// combine the date field + a HH:MM time into a timestamp
function combineDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return NaN;
  return new Date(`${dateStr}T${timeStr}`).getTime();
}

function updateOvernightHint() {
  const d = $("#in-date").value, s = $("#in-start").value, e = $("#in-end").value;
  const start = combineDateTime(d, s);
  const end = combineDateTime(d, e);
  $("#overnight-hint").hidden = !(start && end && end <= start);
}

function bindCreate() {
  $("#cover-drop").addEventListener("click", (e) => { e.preventDefault(); $("#in-cover").click(); });
  $("#in-cover").addEventListener("change", () => {
    const f = $("#in-cover").files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      const sc = Math.min(1, 640 / img.width);
      cv.width = img.width * sc; cv.height = img.height * sc;
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      coverData = cv.toDataURL("image/jpeg", 0.7);
      const drop = $("#cover-drop");
      drop.style.backgroundImage = `url(${coverData})`;
      drop.classList.add("has-img");
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });

  ["#in-date", "#in-start", "#in-end"].forEach((sel) =>
    $(sel).addEventListener("change", updateOvernightHint));

  $("#form-create").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#in-name").value.trim();
    const dateStr = $("#in-date").value;
    const start = combineDateTime(dateStr, $("#in-start").value);
    let end = combineDateTime(dateStr, $("#in-end").value);
    if (end <= start) end += 24 * 3600e3; // party runs past midnight → next day

    let ok = true;
    if (!name) { err($("#in-name")); ok = false; }
    if (!dateStr || isNaN(start)) { err($("#in-date")); ok = false; }
    if (isNaN(end)) { err($("#in-end")); ok = false; }
    if (!ok) return;

    // keep any unlock choice already made if the host went back and forth
    draft = { ...(draft || {}), name, cover: coverData, start, end };
    if (!draft.unlock) draft.unlock = "end";
    go("s-host-unlock");
  });
}
function err(input) {
  input.classList.add("err");
  setTimeout(() => input.classList.remove("err"), 500);
}

/* ============================================================
   HOST · ALBUM UNLOCK (its own step)
   ============================================================ */
function renderUnlock() {
  if (!draft) { go("s-host-create"); return; }
  const chosen = draft.unlock || "end";
  const radio = document.querySelector(`input[name="unlock"][value="${chosen}"]`);
  if (radio) radio.checked = true;
  syncRevealField();
}

function syncRevealField() {
  const v = document.querySelector('input[name="unlock"]:checked').value;
  $("#reveal-time-field").hidden = v !== "time";
  if (v === "time" && !$("#in-revealat").value && draft) {
    $("#in-revealat").value = toLocalInput(draft.end + 30 * 60e3);
  }
}

function bindUnlock() {
  $("#unlock-cards").addEventListener("change", syncRevealField);
  $("#btn-unlock-continue").addEventListener("click", () => {
    if (!draft) { go("s-host-create"); return; }
    const unlock = document.querySelector('input[name="unlock"]:checked').value;
    draft.unlock = unlock;
    draft.revealAt = unlock === "time"
      ? (new Date($("#in-revealat").value).getTime() || draft.end + 30 * 60e3)
      : null;
    go("s-host-package");
  });
}

/* ============================================================
   HOST · PACKAGE
   ============================================================ */
function bindPackage() {
  $("#pkg-list").addEventListener("change", updatePkgBtn);
  $("#btn-pkg-continue").addEventListener("click", () => {
    if (!draft) { go("s-host-create"); return; }
    const key = document.querySelector('input[name="pkg"]:checked').value;
    const pkg = PKGS[key];
    const finalize = () => {
      S.event = {
        ...draft,
        pkg: key,
        max: pkg.max,
        code: uid().slice(0, 4).toUpperCase(),
        createdAt: Date.now(),
        shared: false,
        revealed: false,
        revealedAt: null,
      };
      save();
      if (pkg.price > 0) toast(`✓ PAID ${pkg.price} SEK — EVENT CREATED`);
      go("s-host-share");
    };
    if (pkg.price > 0) {
      openPay({ title: `${pkg.label} — up to ${pkg.max} guests`, price: pkg.price, onDone: finalize });
    } else {
      finalize();
    }
  });
}
function updatePkgBtn() {
  const key = document.querySelector('input[name="pkg"]:checked').value;
  const pkg = PKGS[key];
  $("#btn-pkg-continue").textContent = pkg.price > 0 ? `Pay ${pkg.price} SEK →` : "Create event — free";
}

/* ============================================================
   HOST · INVITE CARD DESIGNER
   ============================================================ */
const invImgCache = { logo: null, cover: null };

function defaultInvite() {
  return { accent: "#E5352B", font: "grotesk", cover: null, logo: null, showQR: true };
}

function invFontFamily(kind) {
  if (kind === "serif") return 'Georgia, "Times New Roman", serif';
  if (kind === "mono") return '"Azeret Mono", monospace';
  return '"Schibsted Grotesk", system-ui, sans-serif';
}

function hexA(hex, a) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function coverDraw(ctx, img, W, H) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, cx, y, maxW, lh) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lh));
  return y + (lines.length - 1) * lh;
}
function inviteDateStr(e) {
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const d = new Date(e.start);
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// left-aligned word wrap, returns the y of the last line
function wrapLeft(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + (lines.length - 1) * lh;
}

// the invite = a cover photo with the event details + QR, bottom-anchored.
// one accent colour drives the label, divider, frame and link ("one unit").
function drawInvite() {
  const e = S.event;
  if (!e || !e.invite) return;
  const cfg = e.invite;
  const cv = $("#invite-canvas");
  const W = cv.width, H = cv.height;
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // background: cover photo, or a dark base with a faint accent glow
  if (cfg.cover && invImgCache.cover) {
    coverDraw(ctx, invImgCache.cover, W, H);
  } else {
    ctx.fillStyle = "#141210";
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.5, H * 0.26, 0, W * 0.5, H * 0.26, W * 0.95);
    g.addColorStop(0, hexA(cfg.accent, 0.34));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // legibility scrim toward the bottom
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  scrim.addColorStop(0, "rgba(10,8,5,0.12)");
  scrim.addColorStop(0.42, "rgba(10,8,5,0.02)");
  scrim.addColorStop(1, "rgba(8,6,4,0.92)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);

  // accent frame
  ctx.strokeStyle = hexA(cfg.accent, 0.9);
  ctx.lineWidth = 5;
  ctx.strokeRect(38, 38, W - 76, H - 76);

  const pad = 92;
  const font = invFontFamily(cfg.font);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // logo top-left (optional)
  if (cfg.logo && invImgCache.logo) {
    const im = invImgCache.logo;
    const mh = 120, mw = W * 0.5;
    const s = Math.min(mw / im.width, mh / im.height);
    ctx.drawImage(im, pad, 100, im.width * s, im.height * s);
  }

  // bottom-anchored details
  let y = H - 720;

  ctx.fillStyle = cfg.accent;
  ctx.font = `700 26px "Azeret Mono", monospace`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "5px";
  ctx.fillText("YOU’RE INVITED", pad, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  y += 96;

  ctx.fillStyle = "#F8F6F0";
  ctx.font = `800 100px ${font}`;
  y = wrapLeft(ctx, e.name, pad, y, W - pad * 2, 102) + 46;

  ctx.fillStyle = "rgba(248,246,240,0.82)";
  ctx.font = `500 30px "Azeret Mono", monospace`;
  ctx.fillText(`${inviteDateStr(e)}  ·  ${EXPOSURES} SHOTS`, pad, y);
  y += 46;

  ctx.strokeStyle = cfg.accent;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + 100, y); ctx.stroke();
  y += 56;

  if (cfg.showQR) {
    drawQR($("#qr-canvas"), e.code, "#FFFFFF", "#15140F");
    const q = 236, p = 18;
    roundRect(ctx, pad, y, q + p * 2, q + p * 2, 22);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.drawImage($("#qr-canvas"), pad + p, y + p, q, q);
    const tx = pad + q + p * 2 + 36;
    ctx.fillStyle = "rgba(248,246,240,0.75)";
    ctx.font = `700 25px "Azeret Mono", monospace`;
    ctx.fillText("SCAN OR TAP", tx, y + 96);
    ctx.fillStyle = cfg.accent;
    ctx.font = `700 31px "Azeret Mono", monospace`;
    ctx.fillText(`dsp.app/e/${e.code}`, tx, y + 140);
    ctx.fillStyle = "rgba(248,246,240,0.45)";
    ctx.font = `700 21px "Azeret Mono", monospace`;
    ctx.fillText("NO APP NEEDED", tx, y + 178);
  } else {
    ctx.fillStyle = cfg.accent;
    ctx.font = `700 32px "Azeret Mono", monospace`;
    ctx.fillText(`dsp.app/e/${e.code}`, pad, y + 32);
  }
}

function drawQR(canvas, code, light = "#F3EEE4", dark = "#17140F") {
  const cells = 29, px = 10; // 25 modules + 2 quiet each side
  canvas.width = cells * px; canvas.height = cells * px;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark;
  const rnd = mulberry32(hashStr(code));
  const mod = (x, y) => ctx.fillRect((x + 2) * px, (y + 2) * px, px, px);
  const finder = (fx, fy) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const edge = x === 0 || x === 6 || y === 0 || y === 6;
      const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      if (edge || core) mod(fx + x, fy + y);
    }
  };
  finder(0, 0); finder(18, 0); finder(0, 18);
  for (let i = 8; i < 17; i += 2) { mod(i, 6); mod(6, i); } // timing
  for (let y = 0; y < 25; y++) {
    for (let x = 0; x < 25; x++) {
      const inFinder = (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);
      if (inFinder || x === 6 || y === 6) continue;
      if (rnd() < 0.46) mod(x, y);
    }
  }
}

function renderShare() {
  const e = S.event;
  if (!e) return;
  if (!e.invite) e.invite = defaultInvite();
  if (e.invite.bgImage && !e.invite.cover) e.invite.cover = e.invite.bgImage; // migrate
  if (!e.invite.cover && e.cover) e.invite.cover = e.cover; // reuse the step-1 cover photo
  syncInviteControls();
  loadInviteImage("cover", e.invite.cover);
  if (document.fonts?.ready) document.fonts.ready.then(drawInvite);
  drawInvite();
}

function loadInviteImage(slot, dataURL) {
  if (!dataURL) { invImgCache[slot] = null; return; }
  const img = new Image();
  img.onload = () => { invImgCache[slot] = img; drawInvite(); };
  img.src = dataURL;
}

function syncInviteControls() {
  const cfg = S.event.invite;
  const fontLabels = { grotesk: "Modern", serif: "Classic", mono: "Mono" };
  $$("#font-menu button").forEach((b) => b.classList.toggle("on", b.dataset.font === cfg.font));
  $("#font-current").textContent = fontLabels[cfg.font] || "Modern";
  $("#tg-qr").classList.toggle("on", cfg.showQR);
  $("#tg-qr").textContent = cfg.showQR ? "QR ✓" : "QR";
  $("#color-dot").style.background = cfg.accent;
  $("#cover-label").textContent = cfg.cover ? "Change cover photo" : "＋ Add cover photo";
  const c = document.querySelector(".inv-cover");
  if (c) c.classList.toggle("has", !!cfg.cover);
}

/* ---------- colour picker (hue + saturation/value) ---------- */
let cpState = { h: 0, s: 1, v: 1 };
function hsvToHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}
function hexToHsv(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60; if (hue < 0) hue += 360;
  }
  return { h: hue, s: max ? d / max : 0, v: max };
}
function openColorPicker() {
  cpState = hexToHsv(S.event.invite.accent);
  cpRender();
  $("#color-pop").hidden = false;
}
function cpRender() {
  const { h, s, v } = cpState;
  $("#cp-sv").style.background = `hsl(${h}, 100%, 50%)`;
  $("#cp-cursor").style.left = (s * 100) + "%";
  $("#cp-cursor").style.top = ((1 - v) * 100) + "%";
  $("#cp-hue-thumb").style.left = (h / 360 * 100) + "%";
  $("#cp-hue").style.color = `hsl(${h}, 100%, 50%)`;
  const hex = hsvToHex(h, s, v);
  $("#cp-hex").textContent = hex.toUpperCase();
  $("#cp-preview").style.background = hex;
  S.event.invite.accent = hex;
  $("#color-dot").style.background = hex;
  drawInvite();
}
function cpDragBind(elm, move) {
  const onMove = (e) => move(e.touches ? e.touches[0] : e);
  elm.addEventListener("pointerdown", (e) => {
    onMove(e);
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  });
}
function bindColorPicker() {
  const sv = $("#cp-sv");
  cpDragBind(sv, (p) => {
    const r = sv.getBoundingClientRect();
    cpState.s = Math.max(0, Math.min(1, (p.clientX - r.left) / r.width));
    cpState.v = Math.max(0, Math.min(1, 1 - (p.clientY - r.top) / r.height));
    cpRender();
  });
  const hue = $("#cp-hue");
  cpDragBind(hue, (p) => {
    const r = hue.getBoundingClientRect();
    cpState.h = Math.max(0, Math.min(1, (p.clientX - r.left) / r.width)) * 360;
    cpRender();
  });
  const close = () => { save(); $("#color-pop").hidden = true; };
  $("#cp-done").addEventListener("click", close);
  $("#cp-backdrop").addEventListener("click", close);
  $("#open-color").addEventListener("click", openColorPicker);
}

function scaleImageToDataURL(file, maxDim, cb) {
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, maxDim / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * s);
    cv.height = Math.round(img.height * s);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    cb(cv.toDataURL("image/png"));
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
}

function bindShare() {
  const closeEdit = () => { save(); $("#invite-edit").hidden = true; $("#font-menu").hidden = true; };
  $("#btn-customize").addEventListener("click", () => {
    syncInviteControls();
    $("#invite-edit").hidden = false;
  });
  $("#es-done").addEventListener("click", closeEdit);
  $("#es-apply").addEventListener("click", closeEdit);
  $("#es-backdrop").addEventListener("click", closeEdit);
  $("#font-dd-btn").addEventListener("click", () => {
    $("#font-menu").hidden = !$("#font-menu").hidden;
  });
  $("#font-menu").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    S.event.invite.font = b.dataset.font;
    $("#font-menu").hidden = true;
    save(); syncInviteControls(); drawInvite();
  });
  $("#tg-qr").addEventListener("click", () => {
    S.event.invite.showQR = !S.event.invite.showQR;
    save(); syncInviteControls(); drawInvite();
  });
  $("#up-cover").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    scaleImageToDataURL(f, 1400, (url) => {
      S.event.invite.cover = url; save();
      syncInviteControls(); loadInviteImage("cover", url); toast("COVER ADDED ✓");
    });
  });
  $("#inv-clear").addEventListener("click", () => {
    S.event.invite = defaultInvite();
    invImgCache.logo = invImgCache.cover = null;
    save(); syncInviteControls(); drawInvite();
  });
  bindColorPicker();
  $("#btn-open-dash").addEventListener("click", () => {
    S.event.shared = true;
    save();
    go("s-host-dash");
  });
}

/* ============================================================
   HOST · DASHBOARD
   ============================================================ */
let prevStats = {};

function renderDash() {
  const e = S.event;
  if (!e) { go("s-host-create"); return; }
  $("#dash-name").textContent = e.name;
  renderStats();
  renderRequests();
}

function eventPhase() {
  const e = S.event, now = Date.now();
  if (!e) return "none";
  if (e.revealed) return "revealed";
  if (now < e.start) return "upcoming";
  if (now > e.end) return "ended";
  return "live";
}

function renderStats() {
  const e = S.event;
  if (!e || currentScreen !== "s-host-dash") return;
  const phase = eventPhase();
  const now = Date.now();

  setNum("#st-guests", S.guests.length);
  $("#st-max").textContent = `/${e.max}`;
  setNum("#st-moments", S.moments.length);

  const chip = $("#dash-chip");
  chip.textContent = { upcoming: "UPCOMING", live: "ONGOING", ended: "DEVELOPING", revealed: "REVEALED" }[phase];

  const label = $("#st-clock-label"), clock = $("#st-clock");
  if (phase === "upcoming") {
    label.textContent = "STARTS IN";
    clock.textContent = fmtCountdown(e.start - now);
  } else if (phase === "live") {
    label.textContent = "TIME REMAINING";
    clock.textContent = fmtCountdown(e.end - now);
  } else if (e.unlock === "time" && !e.revealed) {
    label.textContent = "REVEAL IN";
    clock.textContent = fmtCountdown(e.revealAt - now);
  } else {
    label.textContent = "REVEAL";
    styleTextNum(clock, "Up to you");
    return;
  }
  clock.style.fontSize = "";
  clock.style.fontFamily = "";
  clock.style.fontStyle = "";
  clock.style.fontWeight = "";
}

function setNum(sel, val) {
  const node = $(sel);
  const txt = fmtNum(val);
  if (prevStats[sel] !== undefined && prevStats[sel] !== txt) {
    node.classList.remove("bump");
    void node.offsetWidth;
    node.classList.add("bump");
  }
  node.textContent = txt;
  prevStats[sel] = txt;
}

function renderRequests() {
  const slot = $("#request-slot");
  slot.textContent = "";
  const reqs = [];
  if (S.simRequest) reqs.push({ ...S.simRequest, kind: "sim" });
  if (S.request) reqs.push({ ...S.request, kind: "real" });
  for (const rq of reqs) {
    const full = S.guests.length >= S.event.max;
    const card = el("div", "request-card");

    const p = el("p");
    p.appendChild(el("b", "", rq.name));
    p.appendChild(document.createTextNode(" wants to join your event."));
    card.appendChild(p);

    const row = el("div", "rq-row");
    const acc = el("button", "btn flash sm", "Accept");
    const dec = el("button", "btn ghost sm", "Decline");
    acc.addEventListener("click", () => acceptRequest(rq.kind));
    dec.addEventListener("click", () => {
      if (rq.kind === "sim") S.simRequest = null;
      else { S.request = null; S.you.requested = false; }
      save();
      renderRequests();
    });
    row.append(acc, dec);
    card.appendChild(row);

    if (full) card.appendChild(el("p", "rq-note", "EVENT FULL — ACCEPTING OFFERS AN UPGRADE: +10 GUESTS · 19 SEK"));
    slot.appendChild(card);
  }
}

function acceptRequest(kind) {
  const doAccept = () => {
    if (kind === "sim") {
      S.guests.push({ id: uid(), name: S.simRequest.name, sim: true });
      toast(`✓ ${S.simRequest.name.toUpperCase()} JOINED`);
      S.simRequest = null;
    } else {
      S.you.joined = true;
      if (!S.guests.find((g) => g.id === "you")) S.guests.push({ id: "you", name: S.you.name });
      toast(`✓ ${(S.you.name || "GUEST").toUpperCase()} JOINED`);
      S.request = null;
    }
    save();
    renderDash();
  };
  if (S.guests.length >= S.event.max) {
    openPay({
      title: "+10 guests",
      eyebrow: "UPGRADE EVENT",
      price: 19,
      onDone: () => { S.event.max += 10; save(); toast("✓ EVENT UPGRADED +10 GUESTS"); doAccept(); },
    });
  } else {
    doAccept();
  }
}

function bindDash() {
  $("#btn-review").addEventListener("click", () => go("s-host-review"));
  $("#btn-reshare").addEventListener("click", () => go("s-host-share"));
  $("#btn-host-cam").addEventListener("click", () => {
    if (!S.you.name) S.you.name = "Host";
    go("s-guest-main"); // host can capture too; their shots stay hidden like everyone's
  });
  const openReveal = () => {
    $("#reveal-sub").textContent =
      `All ${S.guests.length} guests get the album link by email & SMS. There’s no going back to hidden.`;
    $("#sheet-reveal").hidden = false;
  };
  $("#btn-reveal").addEventListener("click", openReveal);
  $("#btn-reveal-2").addEventListener("click", openReveal);
  $("#reveal-cancel").addEventListener("click", () => { $("#sheet-reveal").hidden = true; });
  $("#reveal-confirm").addEventListener("click", () => {
    $("#sheet-reveal").hidden = true;
    doReveal();
  });
}

function doReveal() {
  const e = S.event;
  if (!e || e.revealed) return;
  e.revealed = true;
  e.revealedAt = Date.now();
  save();
  if (S.role === "host") {
    toast(`→ ALBUM LINK SENT TO ${S.guests.length} GUESTS`);
    go("s-album");
  }
  // guest side is picked up by the tick → notification bubble
}

/* ============================================================
   HOST · REVIEW — iOS Photos-style multi-select
   ============================================================ */
let reviewSelecting = false;
const reviewSel = new Set();

function enterReview() {
  reviewSelecting = false;
  reviewSel.clear();
  renderReview();
}

// clone the filled heart from the action bar (avoids inline innerHTML)
function favBadge() {
  const span = el("span", "fav-badge");
  span.appendChild($("#act-fav svg").cloneNode(true));
  return span;
}

// the framed photo/clip with the disposable look applied via CSS.
// opts: { who:bool (show capturer name), stamp:bool, raw:bool (original, no filter) }
function filmEl(m, opts = {}) {
  const film = el("div", "film" + (opts.raw ? " raw" : ""));
  const frames = framesOf(m);
  if (m.kind === "clip" && frames.length > 1) {
    const stack = el("div", "clipstack");
    frames.slice(0, 26).forEach((f, i) => {
      const im = el("img", i === 0 ? "on" : "");
      im.src = f; im.alt = ""; im.loading = "lazy";
      stack.appendChild(im);
    });
    film.appendChild(stack);
  } else {
    const im = el("img");
    im.src = frames[0]; im.alt = `Moment by ${m.name}`; im.loading = "lazy";
    film.appendChild(im);
  }
  if (opts.stamp !== false) film.appendChild(el("span", "stamp", stampText(m.ts)));
  if (opts.who) film.appendChild(el("span", "who", m.name));
  return film;
}

function renderReview() {
  const grid = $("#review-grid");
  grid.textContent = "";
  grid.classList.toggle("selecting", reviewSelecting);
  const ms = [...S.moments].reverse();
  const removed = ms.filter((m) => m.removed).length;

  $("#btn-review-select").textContent = reviewSelecting ? "Done" : "Select";
  $("#btn-reveal-2").style.display = reviewSelecting ? "none" : "";
  $("#select-bar").hidden = !(reviewSelecting && reviewSel.size > 0);
  updateReviewHeader(ms.length, removed);

  if (!ms.length) {
    grid.appendChild(el("p", "empty-note", "Nothing captured yet — the film is blank."));
    return;
  }
  for (const m of ms) {
    let cls = "rv-item";
    if (m.removed) cls += " removed";
    if (reviewSel.has(m.id)) cls += " selected";
    const item = el("div", cls);

    item.appendChild(filmEl(m, { who: true }));
    if (m.kind === "clip") item.appendChild(el("span", "vid-dot"));
    if (m.favorite) item.appendChild(favBadge());
    item.appendChild(el("span", "sel-check"));

    item.addEventListener("click", () => {
      if (reviewSelecting) toggleSel(m.id, item);
      else openLightbox(m, { host: true }); // tap → full-screen review
    });
    grid.appendChild(item);
  }
}

function updateReviewHeader(total, removed) {
  if (reviewSelecting) {
    $("#review-count").textContent = reviewSel.size
      ? `${reviewSel.size} selected`
      : "Select moments";
    $("#review-hint").textContent = "TAP TO SELECT · THEN FAVOURITE, KEEP OR REMOVE.";
  } else {
    $("#review-count").textContent = `${total} moments · ${removed} removed`;
    $("#review-hint").textContent = "GUESTS STILL CAN’T SEE ANY OF THIS. TAP “SELECT” TO CHOOSE, FAVOURITE OR REMOVE.";
  }
}

function toggleSel(id, item) {
  if (reviewSel.has(id)) reviewSel.delete(id);
  else reviewSel.add(id);
  item.classList.toggle("selected", reviewSel.has(id));
  const ms = S.moments;
  updateReviewHeader(ms.length, ms.filter((m) => m.removed).length);
  $("#select-bar").hidden = reviewSel.size === 0; // only shows with a selection
}

function applyToSelected(fn, word) {
  if (!reviewSel.size) return;
  const n = reviewSel.size;
  S.moments.forEach((m) => { if (reviewSel.has(m.id)) fn(m); });
  save();
  reviewSel.clear();
  renderReview();
  toast(`${n} ${word}`);
}

function bindReview() {
  $("#btn-review-select").addEventListener("click", () => {
    reviewSelecting = !reviewSelecting;
    reviewSel.clear();
    renderReview();
  });
  $("#act-fav").addEventListener("click", () => applyToSelected((m) => { m.favorite = true; }, "FAVOURITED"));
  $("#act-keep").addEventListener("click", () => applyToSelected((m) => { m.removed = false; }, "KEPT"));
  $("#act-remove").addEventListener("click", () => applyToSelected((m) => { m.removed = true; }, "REMOVED"));
}

/* ============================================================
   LIGHTBOX — tap a moment to view it big; toggle filtered / original
   ============================================================ */
let lbState = null;

function openLightbox(m, opts = {}) {
  lbState = { m, raw: false, opts };
  renderLightbox();
  $("#lightbox").hidden = false;
}
function closeLightbox() {
  $("#lightbox").hidden = true;
  lbState = null;
}
function renderLightbox() {
  if (!lbState) return;
  const { m, raw, opts } = lbState;
  const stage = $("#lb-stage");
  stage.textContent = "";
  stage.appendChild(filmEl(m, { who: true, raw }));
  $("#lb-toggle").textContent = raw ? "View filtered" : "View original";

  const actions = $("#lb-actions");
  actions.textContent = "";
  if (opts.host) {
    actions.appendChild(lbAction("act-fav", m.favorite ? "Favourited" : "Favourite", () => {
      m.favorite = !m.favorite; save(); renderLightbox(); renderReview();
    }));
    actions.appendChild(lbAction(m.removed ? "act-keep" : "act-remove", m.removed ? "Keep" : "Remove", () => {
      m.removed = !m.removed; save(); renderReview();
      toast(m.removed ? "REMOVED" : "KEPT"); closeLightbox();
    }));
  } else if (opts.own) {
    actions.appendChild(lbAction("act-remove", "Delete", () => { deleteMoment(m.id); closeLightbox(); }));
  }
}
function lbAction(iconId, label, cb) {
  const b = el("button", "sel-act");
  b.appendChild($("#" + iconId + " svg").cloneNode(true));
  b.appendChild(el("span", "", label));
  b.addEventListener("click", cb);
  return b;
}
function bindLightbox() {
  $("#lb-close").addEventListener("click", closeLightbox);
  $("#lb-backdrop").addEventListener("click", closeLightbox);
  $("#lb-toggle").addEventListener("click", () => {
    if (lbState) { lbState.raw = !lbState.raw; renderLightbox(); }
  });
}

/* ============================================================
   RECAP FILM — post-event animated slideshow with music
   ============================================================ */
const recapCfg = { sec: 15, vibe: "warm", scope: "fav" };
let recapPlaying = false;
let recapTimer = null, recapRaf = 0;
let audioCtx = null, arpTimer = null, recapMuted = false;

function recapMoments() {
  const all = S.moments.filter((m) => !m.removed);
  let list = recapCfg.scope === "fav" ? all.filter((m) => m.favorite) : all;
  if (!list.length) list = all; // fall back if no favourites
  list = [...list].sort((a, b) => a.ts - b.ts);
  return list.slice(0, 14);
}

function openRecap() {
  recapStop();
  $("#recap").hidden = false;
  $("#recap-controls").hidden = false;
  $("#recap-progress").hidden = true;
  $("#recap-play").textContent = "▶ Play recap";
  posterRecap();
}
function closeRecap() {
  recapStop();
  $("#recap").hidden = true;
  $("#recap-stage").textContent = "";
}
function posterRecap() {
  // show a still poster of the first few moments while in the builder
  const stage = $("#recap-stage");
  stage.textContent = "";
  const ms = recapMoments();
  if (ms[0]) {
    const s = el("div", "r-slide show");
    s.appendChild(filmEl(ms[0], { who: false, stamp: false }));
    s.style.opacity = "0.5";
    stage.appendChild(s);
  }
  showCard("RECAP FILM", S.event?.name || "", `${ms.length} MOMENTS · READY TO PLAY`);
}

function showCard(eyebrow, title, sub) {
  const c = $("#recap-card");
  c.textContent = "";
  c.appendChild(el("p", "rc-eyebrow", eyebrow));
  c.appendChild(el("p", "rc-title", title));
  c.appendChild(el("p", "rc-sub", sub));
  c.classList.add("show");
}
function hideCard() { $("#recap-card").classList.remove("show"); }

function recapPlay() {
  const moments = recapMoments();
  if (!moments.length) { toast("NO MOMENTS TO RECAP YET"); return; }
  recapStop();
  recapPlaying = true;
  $("#recap-controls").hidden = true;
  $("#recap-progress").hidden = false;
  startMusic(recapCfg.vibe);

  const stage = $("#recap-stage");
  stage.textContent = "";
  const slides = moments.map((m) => {
    const s = el("div", "r-slide");
    s.appendChild(filmEl(m, { who: true, stamp: false }));
    stage.appendChild(s);
    return s;
  });

  const total = recapCfg.sec * 1000;
  const titleMs = 2200, endMs = 2800;
  const per = Math.max(850, (total - titleMs - endMs) / slides.length);
  const dur = titleMs + per * slides.length + endMs;
  const startT = performance.now();

  const bar = $("#recap-bar");
  const tick = () => {
    const p = Math.min(1, (performance.now() - startT) / dur);
    bar.style.width = (p * 100) + "%";
    if (p < 1 && recapPlaying) recapRaf = requestAnimationFrame(tick);
  };
  recapRaf = requestAnimationFrame(tick);

  showCard("THE RECAP", S.event.name, inviteDateStr(S.event));
  let idx = 0;
  const advance = () => {
    if (!recapPlaying) return;
    hideCard();
    if (idx > 0) slides[idx - 1].classList.remove("show");
    if (idx < slides.length) {
      slides[idx].classList.add("show");
      idx++;
      recapTimer = setTimeout(advance, per);
    } else {
      const vis = S.moments.filter((m) => !m.removed).length;
      showCard("THAT’S A WRAP", S.event.name, `${vis} MOMENTS · ${S.guests.length} GUESTS`);
      recapTimer = setTimeout(recapFinish, endMs);
    }
  };
  recapTimer = setTimeout(advance, titleMs);
}

function recapFinish() {
  recapPlaying = false;
  stopMusic();
  $("#recap-controls").hidden = false;
  $("#recap-progress").hidden = true;
  $("#recap-play").textContent = "↻ Play again";
}
function recapStop() {
  recapPlaying = false;
  clearTimeout(recapTimer);
  cancelAnimationFrame(recapRaf);
  stopMusic();
}

/* ---- simple WebAudio music bed (no audio files needed) ---- */
function startMusic(vibe) {
  if (vibe === "none" || recapMuted) return;
  stopMusic();
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { audioCtx = null; return; }
  const ctx = audioCtx;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 1.4);
  master.connect(ctx.destination);

  const scales = {
    warm: [220, 277.18, 329.63, 440],
    dreamy: [261.63, 329.63, 392, 493.88],
    upbeat: [261.63, 329.63, 392, 523.25],
  };
  const notes = scales[vibe] || scales.warm;

  // soft pad
  notes.slice(0, 3).forEach((f) => {
    const o = ctx.createOscillator();
    o.type = "sine"; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0.1;
    o.connect(g); g.connect(master); o.start();
    padNodes.push(o);
  });

  // gentle arpeggio
  let step = 0;
  const beat = vibe === "upbeat" ? 300 : 520;
  arpTimer = setInterval(() => {
    if (!audioCtx) return;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = notes[step % notes.length] * 2;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(g); g.connect(master);
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(0.09, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.start(t); o.stop(t + 0.55);
    step++;
  }, beat);
}
const padNodes = [];
function stopMusic() {
  if (arpTimer) { clearInterval(arpTimer); arpTimer = null; }
  padNodes.splice(0).forEach((o) => { try { o.stop(); } catch {} });
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
}

function bindRecap() {
  $("#btn-recap").addEventListener("click", openRecap);
  $("#recap-close").addEventListener("click", closeRecap);
  $("#recap-play").addEventListener("click", recapPlay);
  $("#recap-mute").addEventListener("click", () => {
    recapMuted = !recapMuted;
    $("#recap-mute").textContent = recapMuted ? "♪̸" : "♪";
    $("#recap-mute").style.opacity = recapMuted ? "0.5" : "1";
    if (recapMuted) stopMusic();
    else if (recapPlaying) startMusic(recapCfg.vibe);
  });
  $("#recap-share").addEventListener("click", () => {
    toast(`RECAP SHARED WITH ${S.guests.length} GUESTS`);
  });
  $("#recap-len").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    recapCfg.sec = +b.dataset.sec;
    $$("#recap-len button").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("#recap-music").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    recapCfg.vibe = b.dataset.vibe;
    $$("#recap-music button").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("#recap-scope").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    recapCfg.scope = b.dataset.scope;
    $$("#recap-scope button").forEach((x) => x.classList.toggle("on", x === b));
    posterRecap();
  });
}

/* ============================================================
   GUEST · JOIN / FULL
   ============================================================ */
function renderJoin() {
  const e = S.event;
  if (!e) { go("s-guest-gate"); return; }
  $("#join-name").textContent = e.name;
  $("#join-date").textContent = `${fmtDT(e.start)} — ${fmtDT(e.end)}`;
  const coverSrc = (e.invite && e.invite.cover) || e.cover; // the cover chosen in the invite designer
  const cover = $("#join-cover");
  if (coverSrc) {
    cover.style.backgroundImage = `url(${coverSrc})`;
    cover.classList.add("has-img");
  } else {
    cover.style.backgroundImage = "";
    cover.classList.remove("has-img");
  }
  // tint the join screen with the host's accent
  const accent = e.invite && e.invite.accent;
  if (accent) $("#s-guest-join").style.setProperty("--accent", accent);
}

function bindJoin() {
  $("#form-join").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#jn-name").value.trim();
    const contact = $("#jn-contact").value.trim();
    let ok = true;
    if (!name) { err($("#jn-name")); ok = false; }
    if (!contact) { err($("#jn-contact")); ok = false; }
    if (!ok) return;
    S.you = { ...S.you, name, contact };
    if (S.event.revealed) {
      S.you.joined = true;
      if (!S.guests.find((g) => g.id === "you")) S.guests.push({ id: "you", name });
      save();
      go("s-album");
      return;
    }
    if (S.guests.length >= S.event.max) {
      save();
      go("s-guest-full");
      return;
    }
    S.you.joined = true;
    S.guests.push({ id: "you", name });
    save();
    toast(`WELCOME, ${name.toUpperCase()} — FILM LOADED ✱`);
    go("s-guest-main");
  });

  $("#btn-request").addEventListener("click", () => {
    S.request = { name: S.you.name || "A guest", contact: S.you.contact };
    S.you.requested = true;
    save();
    const btn = $("#btn-request");
    btn.textContent = "Request sent ✓";
    btn.disabled = true;
    toast("REQUEST SENT TO THE HOST");
  });
}

/* ============================================================
   GUEST · MAIN (camera / moments / event)
   ============================================================ */
let galleryOpen = false;
let galleryPage = "moments";

function renderGuestMain() {
  const e = S.event;
  if (!e) { go("s-guest-gate"); return; }
  $("#gm-name").textContent = e.name;
  $("#vf-back").hidden = S.role !== "host"; // host gets a way back to the dashboard
  closeGallery();
  updateCamera();
  updateGuestChip();
}

function updateGuestChip() {
  // the pulsing dot only shows while the event is actively running
  const live = eventPhase() === "live";
  const dot = $("#vf-dot");
  if (dot) dot.style.visibility = live ? "visible" : "hidden";
}

function openGallery(page) {
  galleryOpen = true;
  setGalleryPage(typeof page === "string" ? page : "moments");
  $("#gallery-sheet").classList.add("open");
}
function closeGallery() {
  galleryOpen = false;
  $("#gallery-sheet").classList.remove("open");
}
function setGalleryPage(page) {
  galleryPage = page;
  $$("#gnav .gnav-tab").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  $("#gpage-moments").hidden = page !== "moments";
  $("#gpage-event").hidden = page !== "event";
  if (page === "moments") renderMyMoments();
  if (page === "event") renderEventTab();
  const gs = document.querySelector(".gallery-scroll");
  if (gs) gs.scrollTop = 0;
}

/* ---------- camera lifecycle ---------- */
const cam = { stream: null, demo: false, mirror: false, demoRaf: 0, demoSeed: Math.random() * 1e9, busy: false, warned: false, requesting: false, denied: false, fallback: null };
const videoEl = () => $("#cam");

/* photo / video mode + camera options */
let camMode = "photo";
let recording = false;
let recFrames = null, recTs = 0, recTimer = null;
let camFlash = true;         // disposable-style flash on by default
let camFacing = "environment"; // back camera by default

async function startCam() {
  if (cam.stream || cam.requesting || cam.denied) return;
  if (!window.isSecureContext) { enableDemoCam(); return; } // camera needs https / localhost
  if (!navigator.mediaDevices?.getUserMedia) { enableDemoCam(); return; }
  cam.requesting = true;
  // if the camera doesn't come up quickly (blocked / slow prompt / hung), show demo film meanwhile
  clearTimeout(cam.fallback);
  cam.fallback = setTimeout(() => { if (!cam.stream) enableDemoCam(); }, 1800);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: camFacing, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    clearTimeout(cam.fallback);
    disableDemoCam();               // swap the demo film out for the real feed
    cam.stream = stream;
    const v = videoEl();
    v.srcObject = stream;
    const fm = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
    cam.mirror = (fm || camFacing) === "user";
    v.classList.toggle("mirror", cam.mirror);
  } catch {
    clearTimeout(cam.fallback);
    cam.denied = true;
    enableDemoCam();
  } finally {
    cam.requesting = false;
  }
}

function flipCam() {
  camFacing = camFacing === "environment" ? "user" : "environment";
  toast(camFacing === "user" ? "FRONT CAMERA" : "BACK CAMERA");
  if (!cam.stream) { // demo mode: just mirror
    cam.mirror = camFacing === "user";
    videoEl().classList.toggle("mirror", cam.mirror);
    return;
  }
  stopCam();
  cam.denied = false;
  startCam();
}

function toggleFlash() {
  camFlash = !camFlash;
  const b = $("#btn-flash");
  b.classList.toggle("on", camFlash);
  b.setAttribute("aria-pressed", String(camFlash));
  toast(camFlash ? "FLASH ON" : "FLASH OFF");
}

function disableDemoCam() {
  if (cam.demoRaf) { cancelAnimationFrame(cam.demoRaf); cam.demoRaf = 0; }
  cam.demo = false;
  $("#viewfinder")?.classList.remove("demo");
}

function enableDemoCam() {
  if (cam.demo) return;
  cam.demo = true;
  $("#viewfinder").classList.add("demo");
  if (!cam.warned) { toast("CAMERA PREVIEW — DEMO FILM LOADED"); cam.warned = true; }
  const cv = $("#cam-demo");
  cv.width = 480; cv.height = 640;
  const ctx = cv.getContext("2d");
  const seed = hashStr(String(cam.demoSeed));
  const base = mulberry32(seed);
  const pair = FILM_PAIRS[Math.floor(base() * FILM_PAIRS.length)];
  const blobs = Array.from({ length: 4 }, () => ({
    x: base(), y: base(), r: 0.2 + base() * 0.3,
    c: BLOB_COLORS[Math.floor(base() * BLOB_COLORS.length)],
    sp: 0.15 + base() * 0.3, ph: base() * Math.PI * 2,
  }));
  const loop = () => {
    const t = performance.now() / 1000;
    const bg = ctx.createLinearGradient(0, 0, 0, 640);
    bg.addColorStop(0, pair[0]);
    bg.addColorStop(1, pair[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 480, 640);
    for (const b of blobs) {
      const cx = 480 * (b.x + 0.12 * Math.sin(t * b.sp + b.ph));
      const cy = 640 * (b.y + 0.09 * Math.cos(t * b.sp * 1.3 + b.ph));
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 480 * b.r);
      grad.addColorStop(0, b.c + "bb");
      grad.addColorStop(1, b.c + "00");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 480, 640);
    }
    ctx.fillStyle = "rgba(243,238,228,0.55)";
    ctx.font = '700 11px "Azeret Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText("DEMO FILM — NO CAMERA ACCESS", 240, 40);
    cam.demoRaf = requestAnimationFrame(loop);
  };
  loop();
}

function stopCam() {
  clearTimeout(cam.fallback);
  if (cam.stream) {
    cam.stream.getTracks().forEach((t) => t.stop());
    cam.stream = null;
    videoEl().srcObject = null;
  }
  disableDemoCam();
}

function myMoments() {
  return S.moments.filter((m) => m.guestId === "you");
}

function updateCamera() {
  if (currentScreen !== "s-guest-main") return;
  if (recording) return; // never disturb an in-progress recording
  const e = S.event;
  const phase = eventPhase();
  const lock = $("#vf-lock");
  const cta = $("#vf-lock-cta");
  const left = Math.max(0, EXPOSURES - myMoments().length);
  setFilmCounter(left);
  $("#vf-stamp").textContent = stampText(Date.now());

  if (phase === "live") {
    lock.hidden = true;
    startCam();
    $("#btn-shutter").disabled = left <= 0;
  } else {
    stopCam();
    lock.hidden = false;
    cta.hidden = true;
    $("#btn-shutter").disabled = true;
    if (phase === "upcoming") {
      $("#vf-lock-title").textContent = "Camera locked";
      $("#vf-lock-sub").textContent = `THE EVENT HASN’T STARTED — OPENS IN ${fmtCountdown(e.start - Date.now())}`;
    } else if (phase === "ended") {
      $("#vf-lock-title").textContent = "Film is developing";
      $("#vf-lock-sub").textContent = e.unlock === "manual"
        ? "CAPTURES CLOSED — THE HOST REVEALS WHEN READY"
        : `CAPTURES CLOSED — REVEAL IN ${fmtCountdown((e.unlock === "time" ? e.revealAt : e.end) - Date.now())}`;
    } else if (phase === "revealed") {
      $("#vf-lock-title").textContent = "The album is open";
      $("#vf-lock-sub").textContent = "CAPTURING HAS ENDED — GO RELIVE IT";
      cta.hidden = false;
    }
  }
  updateGuestChip();
  updateThumb();
}

let filmShown = null;
function setFilmCounter(n) {
  $("#r-prev").textContent = n + 1;
  $("#hud-exp").textContent = n;
  $("#r-next").textContent = Math.max(0, n - 1);
  if (filmShown !== null && filmShown !== n) {
    const reel = $("#film-reel");
    reel.classList.remove("roll");
    void reel.offsetWidth; // restart the animation
    reel.classList.add("roll");
  }
  filmShown = n;
}

function updateThumb() {
  const th = $("#cam-thumb");
  const mine = myMoments();
  th.textContent = "";
  if (mine.length) {
    th.style.backgroundImage = `url(${framesOf(mine[mine.length - 1])[0]})`;
    th.appendChild(el("span", "count", String(mine.length)));
  } else {
    th.style.backgroundImage = "";
  }
}

/* ---------- capture ---------- */
function captureSource() {
  if (cam.demo) {
    const cv = $("#cam-demo");
    return { src: cv, w: cv.width, h: cv.height, mirror: false };
  }
  const v = videoEl();
  if (!v.videoWidth) return null;
  return { src: v, w: v.videoWidth, h: v.videoHeight, mirror: cam.mirror };
}

function addMoment(m) {
  S.moments.push(m);
  save();
  updateThumb();
  updateCamera();
}

function setCamMode(mode) {
  if (recording) return;
  camMode = mode;
  $$("#cam-modes button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
}

// flash: the white screen-flash only helps the FRONT camera (lights the selfie);
// for the BACK camera try the real torch/LED (works on Android; iOS has no web torch)
function fireFlash() {
  if (!camFlash) return;
  if (cam.demo || camFacing === "user") { flashFx(); return; }
  const track = cam.stream?.getVideoTracks?.()[0];
  try {
    if (track?.getCapabilities?.().torch) {
      track.applyConstraints({ advanced: [{ torch: true }] });
      setTimeout(() => track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}), 260);
    }
  } catch {}
}

function whoName() {
  return S.you.name || (S.role === "host" ? "Host" : "You");
}

function takePhoto() {
  if (cam.busy || recording) return;
  if (EXPOSURES - myMoments().length <= 0) return;
  const s = captureSource();
  if (!s) { toast("CAMERA WARMING UP…"); return; }
  cam.busy = true;
  fireFlash();
  setTimeout(() => {
    const ts = Date.now();
    const frame = captureRaw(s.src, s.w, s.h, 840, 1120, s.mirror, 0.82);
    addMoment({ id: uid(), guestId: "you", name: whoName(), kind: "photo", ts, frames: [frame], removed: false });
    cam.busy = false;
  }, 120);
}

const CLIP_MS = 3000;   // up to 3 seconds
const CLIP_STEP = 220;  // grab a frame this often
const CLIP_MAX = 16;    // hard cap on captured frames

function toggleVideo() {
  if (recording) { finishVideo(); return; }
  if (EXPOSURES - myMoments().length <= 0) return;
  const s0 = captureSource();
  if (!s0) { toast("CAMERA WARMING UP…"); return; }
  recording = true;
  recFrames = [];
  recTs = Date.now();
  fireFlash();
  $("#btn-shutter").classList.add("recording");
  $("#vf-rec").hidden = false;

  const step = () => {
    if (!recording) return;
    const s = captureSource();
    if (s && recFrames && recFrames.length < CLIP_MAX) {
      recFrames.push(captureRaw(s.src, s.w, s.h, 540, 720, s.mirror, 0.62));
    }
    // wall-clock deadline, so it lasts 3s even if timers get throttled
    if (Date.now() - recTs >= CLIP_MS || (recFrames && recFrames.length >= CLIP_MAX)) finishVideo();
    else recTimer = setTimeout(step, CLIP_STEP);
  };
  step();
}

function finishVideo() {
  if (!recording) return;
  recording = false;
  clearTimeout(recTimer);
  $("#btn-shutter").classList.remove("recording");
  $("#vf-rec").hidden = true;
  const f = recFrames || [];
  recFrames = null;
  if (f.length) {
    // bake a boomerang: forward then back, so a plain forward loop ping-pongs
    const boomer = f.length > 2 ? f.concat(f.slice(1, f.length - 1).reverse()) : f.slice();
    addMoment({ id: uid(), guestId: "you", name: whoName(), kind: "clip", ts: recTs, frames: boomer, removed: false });
  }
  updateCamera();
}

function bindCamera() {
  $("#cam-modes").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setCamMode(b.dataset.mode);
  });
  $("#btn-shutter").addEventListener("click", () => {
    if (eventPhase() !== "live") return;
    if (camMode === "photo") takePhoto();
    else toggleVideo();
  });
  $("#btn-flash").addEventListener("click", toggleFlash);
  $("#btn-flip").addEventListener("click", flipCam);
  $("#vf-back").addEventListener("click", () => go("s-host-dash"));
  $("#vf-lock-cta").addEventListener("click", () => go("s-album"));

  // moments / event live behind a swipe-up / tap-arrow sheet
  $("#cam-thumb").addEventListener("click", () => openGallery("moments"));
  $("#pull-tab").addEventListener("click", () => openGallery("moments"));
  $("#gnav").addEventListener("click", (e) => {
    const t = e.target.closest(".gnav-tab");
    if (t) setGalleryPage(t.dataset.page);
  });
  $("#gnav-cam").addEventListener("click", closeGallery); // camera logo → back to camera

  bindSwipe($("#cam-stage"), "up", () => openGallery("moments"));
  bindSwipe($("#gnav"), "down", closeGallery);
}

// lightweight vertical swipe detection
function bindSwipe(elm, dir, cb) {
  if (!elm) return;
  let y0 = null, x0 = null;
  elm.addEventListener("touchstart", (e) => {
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX;
  }, { passive: true });
  elm.addEventListener("touchend", (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dy) > 55 && Math.abs(dy) > Math.abs(dx)) {
      if (dir === "up" && dy < 0) cb();
      if (dir === "down" && dy > 0) cb();
    }
    y0 = x0 = null;
  }, { passive: true });
}

/* one shared loop cycles every visible video clip (boomerang order baked in) */
function playClips() {
  document.querySelectorAll(".clipstack").forEach((st) => {
    const imgs = st.children;
    if (imgs.length < 2) return;
    let i = ((st._i ?? 0) + 1) % imgs.length;
    st._i = i;
    for (let k = 0; k < imgs.length; k++) imgs[k].classList.toggle("on", k === i);
  });
}

/* ---------- my moments ---------- */
function renderMyMoments() {
  const grid = $("#mm-grid");
  grid.textContent = "";
  const mine = [...myMoments()].reverse();
  $("#mm-note").textContent = S.event?.revealed
    ? "THE ALBUM IS OPEN — EVERYONE CAN SEE THE FULL COLLECTION."
    : "ONLY YOU CAN SEE THESE UNTIL THE REVEAL.";
  if (!mine.length) {
    grid.appendChild(el("p", "empty-note", "Nothing yet — go capture something."));
    return;
  }
  for (const m of mine) {
    const item = el("div", "mm-item");
    item.appendChild(filmEl(m));
    if (m.kind === "clip") item.appendChild(el("span", "vid-dot"));
    item.addEventListener("click", () => openLightbox(m, { own: !S.event?.revealed }));
    if (!S.event?.revealed) {
      const del = el("button", "mm-del", "✕");
      del.title = "Delete (frees an exposure)";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deleteMoment(m.id);
      });
      item.appendChild(del);
    }
    grid.appendChild(item);
  }
}

function deleteMoment(id) {
  S.moments = S.moments.filter((x) => x.id !== id);
  save();
  renderMyMoments();
  updateThumb();
  toast("MOMENT DELETED — EXPOSURE FREED");
}

/* ---------- event tab ---------- */
function renderEventTab() {
  if (currentScreen !== "s-guest-main" || !galleryOpen || galleryPage !== "event") return;
  const e = S.event;
  if (!e) return;
  setNum("#ge-guests", S.guests.length);
  setNum("#ge-moments", S.moments.length);
  const label = $("#ge-clock-label"), clock = $("#ge-clock");
  const now = Date.now();
  clock.style.fontSize = ""; clock.style.fontFamily = ""; clock.style.fontStyle = ""; clock.style.fontWeight = "";
  if (e.revealed) {
    label.textContent = "REVEALED";
    styleTextNum(clock, "It’s open");
  } else if (now < e.start) {
    label.textContent = "STARTS IN";
    clock.textContent = fmtCountdown(e.start - now);
  } else if (e.unlock === "manual") {
    label.textContent = "REVEAL";
    styleTextNum(clock, "When the host decides");
  } else {
    label.textContent = "REVEAL IN";
    clock.textContent = fmtCountdown((e.unlock === "time" ? e.revealAt : e.end) - now);
  }
}
function styleTextNum(node, txt) {
  node.textContent = txt;
  node.style.fontSize = "23px";
  node.style.fontFamily = "var(--font-display)";
  node.style.fontStyle = "normal";
  node.style.fontWeight = "700";
}

/* ============================================================
   ALBUM
   ============================================================ */
function renderAlbum() {
  const e = S.event;
  if (!e) return;
  $("#al-name").textContent = e.name;
  const visible = S.moments.filter((m) => !m.removed);
  $("#al-sub").textContent = `${fmtNum(visible.length)} MOMENTS · ${fmtNum(S.guests.length)} GUESTS · ${fmtDT(e.start)}`;

  const isHost = S.role === "host";
  $("#btn-recap").hidden = !isHost; // only the host builds the recap film
  $("#al-scope").style.display = isHost ? "none" : "flex";
  if (isHost) albumScope = "all";
  $$("#al-scope button").forEach((b) => b.classList.toggle("on", b.dataset.scope === albumScope));
  $$("#al-view button").forEach((b) => b.classList.toggle("on", b.dataset.view === albumView));

  const list = $("#album-list");
  list.classList.toggle("grid", albumView === "grid");
  list.textContent = "";

  let items = visible;
  if (albumScope === "mine") items = items.filter((m) => m.guestId === "you");
  items = [...items].sort((a, b) => a.ts - b.ts);

  if (!items.length) {
    list.appendChild(el("p", "empty-note",
      albumScope === "mine" ? "You didn’t capture anything this time." : "The album is empty."));
    return;
  }

  items.forEach((m, i) => {
    const fig = el("figure", "polaroid");
    fig.style.animationDelay = `${Math.min(i, 8) * 0.05}s`;
    const ph = el("div", "ph");
    ph.appendChild(filmEl(m, { who: true }));
    if (m.kind === "clip") ph.appendChild(el("span", "vid-dot"));
    if (m.favorite) ph.appendChild(favBadge());
    fig.appendChild(ph);
    fig.addEventListener("click", () => openLightbox(m));
    list.appendChild(fig);
  });
}

function bindAlbum() {
  $("#al-scope").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    albumScope = b.dataset.scope;
    renderAlbum();
  });
  $("#al-view").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    albumView = b.dataset.view;
    renderAlbum();
  });
}

/* ============================================================
   SIMULATION ENGINE — the invisible crowd
   ============================================================ */
function simTick() {
  const e = S.event;
  if (!e || e.revealed) return;
  const now = Date.now();
  if (now < e.start || now > e.end) return;
  let changed = false;

  // guests trickle in (always leave one seat for the real user)
  const seatCap = S.you.joined ? e.max : e.max - 1;
  if (S.guests.length < seatCap && Math.random() < 0.5) {
    const used = new Set(S.guests.map((g) => g.name));
    const name = SIM_NAMES.find((n) => !used.has(n)) || `Guest ${S.guests.length + 1}`;
    S.guests.push({ id: uid(), name, sim: true });
    changed = true;
  }

  // moments roll in
  const simGuests = S.guests.filter((g) => g.sim);
  if (simGuests.length && S.moments.length < 90) {
    const roll = Math.random();
    const k = roll < 0.35 ? 2 : roll < 0.8 ? 1 : 0;
    for (let i = 0; i < k; i++) {
      const g = simGuests[Math.floor(Math.random() * simGuests.length)];
      S.moments.push({
        id: uid(), guestId: g.id, name: g.name,
        kind: Math.random() < 0.15 ? "clip" : "photo",
        ts: now - Math.floor(Math.random() * 40000),
        sim: true, seed: Math.floor(Math.random() * 1e9), removed: false,
      });
      changed = true;
    }
  }

  // one scripted join request, to demo that flow
  if (!S.requestDone && !S.simRequest && S.guests.length >= 3 && now - e.createdAt > 25000) {
    S.simRequest = { name: "Emma W." };
    S.requestDone = true;
    changed = true;
    if (S.role === "host") toast("! EMMA W. WANTS TO JOIN YOUR EVENT");
  }

  if (changed) {
    save();
    if (currentScreen === "s-host-dash") { renderStats(); renderRequests(); }
    if (currentScreen === "s-guest-main" && galleryOpen) renderEventTab();
  }
}

/* ============================================================
   CLOCK TICK — countdowns, auto-reveal, notifications
   ============================================================ */
function tick() {
  const e = S.event;
  if (!e) return;
  const now = Date.now();

  // auto-reveal
  if (!e.revealed) {
    if (e.unlock === "end" && now >= e.end) doReveal();
    else if (e.unlock === "time" && e.revealAt && now >= e.revealAt) doReveal();
  }

  if (currentScreen === "s-host-dash") renderStats();
  if (currentScreen === "s-guest-main") {
    if (galleryOpen) renderEventTab();
    $("#vf-stamp").textContent = stampText(now);
    const phase = eventPhase();
    // full refresh handles lock-state transitions & countdown text
    if (phase !== "live" || !$("#vf-lock").hidden) updateCamera();
    updateGuestChip();
  }

  // reveal notification (email/SMS stand-in)
  if (e.revealed && S.role === "guest" && S.you.joined && !S.notifSeen && currentScreen !== "s-album") {
    $("#notif").hidden = false;
  }
}

/* ============================================================
   BOOT
   ============================================================ */
function bindChrome() {
  $$("#role-toggle button").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.role)));
  $$("[data-go-role]").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.goRole)));
  $$("[data-back]").forEach((b) => b.addEventListener("click", () => go(b.dataset.back)));
  $("#btn-reset").addEventListener("click", () => {
    if (confirm("Reset the demo? This clears the event and every moment.")) {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(ROLE_KEY);
      location.reload();
    }
  });
  $("#pay-cancel").addEventListener("click", () => { $("#sheet-pay").hidden = true; });
  $("#notif-open").addEventListener("click", () => {
    S.notifSeen = true;
    save();
    $("#notif").hidden = true;
    go("s-album");
  });
}

function boot() {
  bindChrome();
  bindCreate();
  bindUnlock();
  bindPackage();
  bindShare();
  bindDash();
  bindJoin();
  bindCamera();
  bindReview();
  bindLightbox();
  bindRecap();
  bindAlbum();
  updatePkgBtn();

  // keep the app vertical — best effort (works in fullscreen / installed PWA)
  try { screen.orientation?.lock?.("portrait").catch(() => {}); } catch {}

  // make sure the mono font is ready before we burn date stamps into photos
  if (document.fonts?.load) document.fonts.load('700 16px "Azeret Mono"');

  // two-tab demo: host in one tab, guest in another
  window.addEventListener("storage", (ev) => {
    if (ev.key !== KEY) return;
    if (recording) return; // don't reload state out from under an active recording
    S = load() || initialState();
    refreshActive();
  });

  setInterval(simTick, 3000);
  setInterval(tick, 1000);
  setInterval(playClips, 130);

  if (S.role) {
    $$("#role-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.role === S.role));
    go(screenForRole(S.role));
  } else {
    go("s-splash");
  }
}

boot();
