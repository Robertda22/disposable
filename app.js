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
const BACKEND = window.DisposableBackend || null;
let remoteCreatePromise = null;
let remoteBusy = false;

function initialState() {
  return {
    role: null,
    event: null,          // {eventType, name, cover, start, end, unlock, revealAt, cameraStyle, pkg, max, code, shared, revealed, revealedAt, createdAt}
    guests: [],           // {id, name, sim}
    moments: [],          // {id, guestId, name, kind, ts, removed, sim, seed | frames[]}
    you: { joined: false, requested: false, remoteGuestId: null },
    remoteRequests: [],
    simRequest: null,     // scripted request {name}
    request: null,        // real guest request {name, contact}
    deliveries: [],      // prototype reveal delivery manifest {guestId, name, contact, channel, status, sentAt}
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
const DEFAULT_EXPOSURES = 24;
function maxExposures(e = S.event) { return e?.exposures === "infinite" ? Infinity : Number(e?.exposures || DEFAULT_EXPOSURES); }
function exposureLabel(e = S.event) { return e?.exposures === "infinite" ? "∞ SHOTS" : fmtNum(maxExposures(e)) + " SHOTS"; }
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
let albumView = "grid";
let previewAlbumView = "grid";
let confirmAlbumView = "grid";

function screenForRole(role) {
  const e = S.event;
  if (role === "host") {
    if (!e) return "s-host-type";
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
  "s-host-type": renderEventType,
  "s-host-create": renderCreate,
  "s-host-package": renderPackage,
  "s-host-unlock": renderUnlock,
  "s-host-style": renderStyle,
  "s-host-exposures": renderExposures,
  "s-host-share": renderShare,
  "s-invite-edit": renderShare,
  "s-host-dash": renderDash,
  "s-host-review": enterReview,
  "s-album-preview": renderAlbumPreview,
  "s-album-confirm": renderAlbumConfirm,
  "s-album-sent": renderAlbumSent,
  "s-guest-join": renderJoin,
  "s-guest-full": renderGuestWait,
  "s-guest-main": renderGuestMain,
  "s-album": renderAlbum,
};

function go(id) {
  currentScreen = id;
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  if (id !== "s-guest-main") stopCam();
  closeLightbox();
  closeQrPop();
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

function inviteUrl(code = S.event?.code) {
  if (!code) return location.href;
  if (location.protocol === "file:") return `https://disposable-seven.vercel.app/e/${code}`;
  return `${location.origin}/e/${code}`;
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
const EVENT_TYPES = {
  birthday: { label: "Birthday", placeholder: "Bert birthday" },
  wedding: { label: "Wedding", placeholder: "Elsa & Hugo wedding" },
  afterwork: { label: "After work", placeholder: "Friday after work" },
  club: { label: "Club night", placeholder: "Club night" },
  dinner: { label: "Dinner", placeholder: "Summer dinner" },
  graduation: { label: "Graduation", placeholder: "Graduation night" },
};

function currentEventType() {
  return draft?.eventType || "birthday";
}

function renderEventType() {
  const chosen = currentEventType();
  const radio = document.querySelector(`input[name="eventType"][value="${chosen}"]`);
  if (radio) radio.checked = true;
}

function bindEventType() {
  const cards = $("#event-type-cards");
  if (!cards) return;
  cards.addEventListener("change", () => {
    const type = document.querySelector('input[name="eventType"]:checked')?.value || "birthday";
    draft = { ...(draft || {}), eventType: type };
  });
  $("#btn-type-continue").addEventListener("click", () => {
    const type = document.querySelector('input[name="eventType"]:checked')?.value || "birthday";
    draft = { ...(draft || {}), eventType: type };
    go("s-host-create");
  });
}

function renderCreate() {
  const now = Date.now();
  if (!$("#in-date").value) $("#in-date").value = toLocalDate(now);
  if (!$("#in-start").value) $("#in-start").value = toLocalTime(now);
  if (!$("#in-end").value) $("#in-end").value = toLocalTime(now + 3 * 3600e3);
  const type = EVENT_TYPES[currentEventType()] || EVENT_TYPES.birthday;
  $("#in-name").placeholder = type.placeholder;
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
    draft = { ...(draft || {}), eventType: currentEventType(), name, cover: coverData, start, end };
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
  if (!draft) { go("s-host-type"); return; }
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
    if (!draft) { go("s-host-type"); return; }
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
function renderPackage() {
  if (!draft) { go("s-host-type"); return; }
}

function bindPackage() {
  $("#pkg-list").addEventListener("change", updatePkgBtn);
  $("#btn-pkg-continue").addEventListener("click", () => {
    if (!draft) { go("s-host-type"); return; }
    const key = document.querySelector('input[name="pkg"]:checked').value;
    const pkg = PKGS[key];
    draft.pkg = key;
    draft.max = pkg.max;
    draft.pkgPrice = pkg.price;
    draft.pkgLabel = pkg.label;
    if (!draft.cameraStyle) draft.cameraStyle = "vintage";
    if (!draft.exposures) draft.exposures = DEFAULT_EXPOSURES;
    go("s-host-style");
  });
}
function updatePkgBtn() {
  $("#btn-pkg-continue").textContent = "Continue →";
}

function renderStyle() {
  if (!draft) { go("s-host-type"); return; }
  const chosen = draft.cameraStyle || "vintage";
  const radio = document.querySelector('input[name="cameraStyle"][value="' + chosen + '"]');
  if (radio) radio.checked = true;
}
function bindStyle() {
  $("#style-cards").addEventListener("change", () => {
    if (!draft) return;
    draft.cameraStyle = document.querySelector('input[name="cameraStyle"]:checked').value;
  });
  $("#btn-style-continue").addEventListener("click", () => {
    if (!draft) { go("s-host-type"); return; }
    draft.cameraStyle = document.querySelector('input[name="cameraStyle"]:checked').value;
    if (!draft.exposures) draft.exposures = DEFAULT_EXPOSURES;
    go("s-host-exposures");
  });
}

function exposureMeta(value) {
  const key = String(value || DEFAULT_EXPOSURES);
  if (key === "36") return { label: "36 captures per guest", price: 10, note: "+10 SEK total" };
  if (key === "infinite") return { label: "No limit", price: 20, note: "+20 SEK total" };
  return { label: key + " captures per guest", price: 0, note: "included" };
}
function setExposureDraft(value) {
  if (!draft) return;
  const meta = exposureMeta(value);
  draft.exposures = value === "infinite" ? "infinite" : Number(value);
  draft.exposurePrice = meta.price;
  draft.exposureLabel = meta.label;
  const note = $("#exposure-price-note");
  if (note) note.textContent = meta.label + " · " + meta.note;
}
function renderExposures() {
  if (!draft) { go("s-host-type"); return; }
  const chosen = String(draft.exposures || DEFAULT_EXPOSURES);
  const radio = document.querySelector('input[name="exposures"][value="' + chosen + '"]');
  if (radio) {
    radio.checked = true;
    radio.closest(".exposure-option")?.scrollIntoView({ block: "center" });
  }
  setExposureDraft(chosen);
}
function bindExposures() {
  $("#exposure-cards").addEventListener("change", () => {
    if (!draft) return;
    const val = document.querySelector('input[name="exposures"]:checked').value;
    setExposureDraft(val);
  });
  $("#btn-exposure-continue").addEventListener("click", () => {
    if (!draft) { go("s-host-type"); return; }
    const val = document.querySelector('input[name="exposures"]:checked').value;
    setExposureDraft(val);
    const exposurePrice = draft.exposurePrice || 0;
    const basePrice = draft.pkgPrice || 0;
    const totalPrice = basePrice + exposurePrice;
    const finalize = () => {
      S.deliveries = [];
      S.event = {
        ...draft,
        pkg: draft.pkg || "free",
        max: draft.max || PKGS.free.max,
        code: uid().slice(0, 4).toUpperCase(),
        createdAt: Date.now(),
        shared: false,
        revealed: false,
        revealedAt: null,
        reviewReminderSeen: false,
        deliveryStatus: "draft",
      };
      delete S.event.pkgPrice;
      delete S.event.pkgLabel;
      delete S.event.exposurePrice;
      delete S.event.exposureLabel;
      save();
      ensureRemoteEvent();
      if (totalPrice > 0) toast("✓ PAID " + totalPrice + " SEK — EVENT CREATED");
      go("s-host-share");
    };
    if (totalPrice > 0) {
      const parts = [];
      if (basePrice > 0) parts.push(draft.pkgLabel + " — up to " + draft.max + " guests");
      if (exposurePrice > 0) parts.push(draft.exposureLabel);
      openPay({ title: parts.join(" + ") || "Event upgrade", price: totalPrice, onDone: finalize });
    } else {
      finalize();
    }
  });
}
/* ============================================================
   HOST · INVITE CARD DESIGNER
   ============================================================ */
const invImgCache = { logo: null, cover: null };

function defaultInvite() {
  return { accent: "#F8F6F0", font: "grotesk", cover: null, logo: null, showQR: true };
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
// portrait invite: cover photo + bottom-anchored details.
// one accent colour drives the label, divider and link ("one unit"); title stays white.
function drawInvite() {
  const e = S.event;
  if (!e || !e.invite) return;
  const cfg = e.invite;
  const cv = $("#invite-canvas");
  const W = cv.width, H = cv.height; // 1080 x 1440
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 56);
  ctx.clip();

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

  // legibility scrim: neutral first, then a small accent wash at the bottom.
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  scrim.addColorStop(0, "rgba(10,8,5,0.08)");
  scrim.addColorStop(0.46, "rgba(10,8,5,0.02)");
  scrim.addColorStop(0.76, "rgba(10,8,5,0.48)");
  scrim.addColorStop(1, "rgba(10,8,5,0.88)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);
  const tint = ctx.createLinearGradient(0, H * 0.58, 0, H);
  tint.addColorStop(0, hexA(cfg.accent, 0));
  tint.addColorStop(1, hexA(cfg.accent, 0.48));
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, W, H);


  const pad = 88;
  const font = invFontFamily(cfg.font);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  let y = H - 730;

  ctx.fillStyle = cfg.accent;
  ctx.font = '700 26px "Azeret Mono", monospace';
  if ("letterSpacing" in ctx) ctx.letterSpacing = "5px";
  ctx.fillText("YOU'RE INVITED", pad, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  y += 94;

  ctx.fillStyle = "#F8F6F0";
  ctx.font = "800 100px " + font;
  y = wrapLeft(ctx, e.name, pad, y, W - pad * 2, 104) + 44;

  ctx.fillStyle = "rgba(248,246,240,0.82)";
  ctx.font = '500 30px "Azeret Mono", monospace';
  ctx.fillText(inviteDateStr(e) + "  ·  " + exposureLabel(e), pad, y);
  y += 46;

  ctx.strokeStyle = cfg.accent;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + 100, y); ctx.stroke();
  y += 58;

  if (cfg.showQR) {
    drawQR($("#qr-canvas"), e.code, "#FFFFFF", "#15140F");
    const q = 240, p = 18;
    roundRect(ctx, pad, y, q + p * 2, q + p * 2, 22);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.drawImage($("#qr-canvas"), pad + p, y + p, q, q);
    const tx = pad + q + p * 2 + 36;
    ctx.fillStyle = "rgba(248,246,240,0.75)";
    ctx.font = '700 25px "Azeret Mono", monospace';
    ctx.fillText("SCAN OR TAP", tx, y + 100);
    ctx.fillStyle = cfg.accent;
    ctx.font = '700 31px "Azeret Mono", monospace';
    ctx.fillText("dsp.app/e/" + e.code, tx, y + 144);
    ctx.fillStyle = "rgba(248,246,240,0.45)";
    ctx.font = '700 21px "Azeret Mono", monospace';
    ctx.fillText("NO APP NEEDED", tx, y + 182);
  } else {
    ctx.fillStyle = cfg.accent;
    ctx.font = '700 32px "Azeret Mono", monospace';
    ctx.fillText("dsp.app/e/" + e.code, pad, y + 32);
  }

  ctx.restore();
}

function drawQR(canvas, code, light = "#F3EEE4", dark = "#17140F") {
  if (window.QRCode?.toCanvas) {
    window.QRCode.toCanvas(canvas, inviteUrl(code), {
      width: 290,
      margin: 2,
      color: { light, dark },
      errorCorrectionLevel: "M",
    }, () => {});
    return;
  }
  if (typeof window.qrcode === "function") {
    const qr = window.qrcode(0, "M");
    qr.addData(inviteUrl(code));
    qr.make();
    const modules = qr.getModuleCount();
    const margin = 2;
    const size = 290;
    const scale = size / (modules + margin * 2);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = dark;
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (!qr.isDark(row, col)) continue;
        const left = Math.floor((col + margin) * scale);
        const top = Math.floor((row + margin) * scale);
        const right = Math.ceil((col + margin + 1) * scale);
        const bottom = Math.ceil((row + margin + 1) * scale);
        ctx.fillRect(left, top, right - left, bottom - top);
      }
    }
    return;
  }
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
  $("#tg-qr").textContent = cfg.showQR ? "QR code" : "QR off";
  $("#color-dot").style.background = cfg.accent;
  $("#cover-label").textContent = cfg.cover ? "Cover set" : "Cover";
  const c = document.querySelector(".tool-card.cover");
  if (c) c.classList.toggle("has", !!cfg.cover);
  const preview = $("#invite-edit-preview");
  if (preview && $("#invite-canvas")) preview.src = $("#invite-canvas").toDataURL("image/png");
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
  const openEdit = () => { save(); go("s-invite-edit"); };
  const closeEdit = () => { save(); $("#font-menu").hidden = true; go("s-host-share"); };
  $("#btn-customize").addEventListener("click", openEdit);
  $("#es-done").addEventListener("click", closeEdit);

  $("#btn-dlcard").addEventListener("click", () => {
    const a = document.createElement("a");
    a.download = "invite-" + (((S.event && S.event.code) || "card")) + ".png";
    a.href = $("#invite-canvas").toDataURL("image/png");
    a.click();
    toast("INVITE DOWNLOADED ✓");
  });
  const closeMenus = () => { save(); $("#font-menu").hidden = true; };
  $("#font-dd-btn").addEventListener("click", () => {
    $("#font-menu").hidden = !$("#font-menu").hidden;
  });
  $("#font-menu").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    S.event.invite.font = b.dataset.font;
    $("#font-menu").hidden = true;
    closeMenus(); syncInviteControls(); drawInvite();
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
  ["#btn-open-dash", "#btn-open-dash-edit"].forEach((sel) => {
    const btn = $(sel);
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await ensureRemoteEvent();
        if (BACKEND && S.event.remoteId) S.event = await BACKEND.publishEvent(S.event);
        S.event.shared = true;
        save();
        go("s-host-dash");
      } catch (error) {
        console.error(error);
        toast("COULD NOT PUBLISH — CHECK CONNECTION");
      } finally {
        btn.disabled = false;
      }
    });
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
  const accent = (e.invite && e.invite.accent) || "#E5352B";
  const dash = $("#s-host-dash");
  dash.style.setProperty("--dash-accent-soft", hexA(accent, 0.22));
  dash.style.setProperty("--dash-accent-deep", hexA(accent, 0.34));
  dash.style.setProperty("--dash-accent-shadow", hexA(accent, 0.28));
  const cover = (e.invite && e.invite.cover) || e.cover;
  const banner = $("#dash-banner");
  if (cover) {
    banner.style.backgroundImage = `url(${cover})`;
    banner.hidden = false;
  } else {
    banner.style.backgroundImage = "";
    banner.hidden = true;
  }
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
  chip.textContent = { upcoming: "UPCOMING", live: "ONGOING", ended: "REVIEW READY", revealed: "REVEALED" }[phase];
  chip.parentElement?.classList.toggle("is-live", phase === "live");

  const note = $("#dash-note");
  const camBtn = $("#btn-host-cam");
  const camLabel = $("#dash-camera-label");
  const reviewLabel = $("#dash-review-label");
  if (phase === "live") {
    note.innerHTML = `<span class="pulse"></span>Film is developing — photos stay hidden until the reveal.`;
    camBtn.disabled = false;
    camLabel.textContent = "Camera";
    reviewLabel.textContent = "Review";
  } else if (phase === "ended") {
    note.innerHTML = `<span class="pulse"></span>Capture is closed. Review moments, write the album message, then approve & send.`;
    camBtn.disabled = true;
    camLabel.textContent = "Closed";
    reviewLabel.textContent = "Review album";
  } else if (phase === "revealed") {
    note.innerHTML = `<span class="pulse"></span>Album sent. Guests can now view the final event page.`;
    camBtn.disabled = false;
    camLabel.textContent = "Album";
    reviewLabel.textContent = "Album";
  } else {
    note.innerHTML = `<span class="pulse"></span>Camera opens when the event starts.`;
    camBtn.disabled = true;
    camLabel.textContent = "Locked";
    reviewLabel.textContent = "Review";
  }

  const label = $("#st-clock-label"), clock = $("#st-clock");
  if (phase === "upcoming") {
    label.textContent = "STARTS IN";
    clock.textContent = fmtCountdown(e.start - now);
  } else if (phase === "live") {
    label.textContent = "TIME REMAINING";
    clock.textContent = fmtCountdown(e.end - now);
  } else if (phase === "ended") {
    label.textContent = "READY";
    styleTextNum(clock, "Review ready");
    return;
  } else if (e.unlock === "time" && !e.revealed && e.revealAt > now) {
    label.textContent = "REVIEW REMINDER";
    clock.textContent = fmtCountdown(e.revealAt - now);
  } else {
    label.textContent = "REVEAL";
    styleTextNum(clock, "After review");
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
  (S.remoteRequests || []).forEach((request) => reqs.push({ ...request, kind: "remote" }));
  const badge = $("#request-badge");
  if (badge) { badge.hidden = !reqs.length; badge.textContent = reqs.length > 99 ? "99+" : String(reqs.length); }
  if (!reqs.length) return;

  const rq = reqs[0];
  const full = S.guests.length >= S.event.max;
  const wrap = el("div", "request-stack" + (reqs.length > 1 ? " has-more" : ""));
  const card = el("div", "request-card");

  const avatar = el("span", "rq-avatar", rq.name.slice(0, 1).toUpperCase());
  const copy = el("p", "rq-copy");
  copy.appendChild(el("b", "", rq.name));
  copy.appendChild(el("span", "", "wants to join your event"));

  const acc = el("button", "rq-accept", "Accept");
  const dec = el("button", "rq-decline", "×");
  acc.addEventListener("click", () => acceptRequest(rq.kind, rq));
  dec.addEventListener("click", async () => {
    if (rq.kind === "remote") {
      try { await BACKEND.setGuestStatus(rq.id, "declined"); await pollRemote(); }
      catch (error) { console.error(error); toast("COULD NOT DECLINE REQUEST"); }
      return;
    }
    if (rq.kind === "sim") S.simRequest = null;
    else { S.request = null; S.you.requested = false; }
    save();
    renderRequests();
  });

  card.append(avatar, copy, acc, dec);
  if (full) card.appendChild(el("p", "rq-note", "EVENT FULL — ACCEPTING OFFERS AN UPGRADE: +10 GUESTS · 19 SEK"));
  wrap.appendChild(card);
  if (reqs.length > 1) wrap.appendChild(el("p", "rq-more", `View all requests (${reqs.length})`));
  slot.appendChild(wrap);
}

function acceptRequest(kind, request) {
  if (kind === "remote") {
    BACKEND.setGuestStatus(request.id, "approved")
      .then(() => { toast(`✓ ${request.name.toUpperCase()} JOINED`); return pollRemote(); })
      .catch((error) => { console.error(error); toast("COULD NOT ACCEPT REQUEST"); });
    return;
  }
  const doAccept = () => {
    if (kind === "sim") {
      S.guests.push({ id: uid(), name: S.simRequest.name, sim: true });
      toast(`✓ ${S.simRequest.name.toUpperCase()} JOINED`);
      S.simRequest = null;
    } else {
      S.you.joined = true;
      if (!S.guests.find((g) => g.id === "you")) S.guests.push({ id: "you", name: S.you.name, contact: S.you.contact || S.request?.contact || "" });
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

function openQrPop() {
  if (!S.event) return;
  $("#qr-pop-name").textContent = S.event.name;
  drawQR($("#qr-pop-canvas"), S.event.code, "#FFFFFF", "#15140F");
  $("#qr-pop-link").textContent = inviteUrl();
  $("#qr-pop").hidden = false;
}
function closeQrPop() {
  const pop = $("#qr-pop");
  if (pop) pop.hidden = true;
}
async function copyText(text) {
  try { await navigator.clipboard?.writeText(text); toast("LINK COPIED"); }
  catch { toast(text); }
}
async function shareEventLink(text = "Open the album") {
  const url = inviteUrl();
  if (navigator.share) {
    try { await navigator.share({ title: S.event?.name || "Disposable", text, url }); return; } catch {}
  }
  copyText(url);
}

function bindDash() {
  $("#qr-pop-close").addEventListener("click", closeQrPop);
  $("#qr-pop-backdrop").addEventListener("click", closeQrPop);
  $("#btn-review").addEventListener("click", () => go("s-host-review"));
  $("#btn-reshare").addEventListener("click", openQrPop);
  $("#qr-copy").addEventListener("click", async () => {
    const url = inviteUrl();
    try { await navigator.clipboard?.writeText(url); toast("LINK COPIED"); }
    catch { toast(url); }
  });
  $("#qr-share").addEventListener("click", async () => {
    const url = inviteUrl();
    if (navigator.share) { try { await navigator.share({ title: S.event?.name || "Disposable", text: "Join my Disposable event", url }); return; } catch {} }
    try { await navigator.clipboard?.writeText(url); toast("LINK COPIED"); }
    catch { toast(url); }
  });
  $("#btn-host-cam").addEventListener("click", () => {
    const phase = eventPhase();
    if (phase === "revealed") { go("s-album"); return; }
    if (phase !== "live") { toast("CAMERA CLOSED — REVIEW READY"); return; }
    if (!S.you.name) S.you.name = "Host";
    go("s-guest-main"); // host can capture too; their shots stay hidden like everyone's
  });
  const openReveal = () => {
    if (eventPhase() === "revealed") { go("s-album"); return; }
    // Prototype shortcut: allow preview/reveal before the timer ends so the MVP can be tested quickly.
    S.event.hostMessage = S.event.hostMessage || "Thanks for an amazing night.";
    S.event.albumCtaLabel = cleanAlbumCta(S.event.albumCtaLabel);
    save();
    go("s-album-preview");
  };
  const dashReveal = document.getElementById("btn-reveal");
  if (dashReveal) dashReveal.addEventListener("click", openReveal);
  $("#btn-reveal-2").addEventListener("click", openReveal);
  $("#reveal-cancel").addEventListener("click", () => { $("#sheet-reveal").hidden = true; });
  $("#reveal-confirm").addEventListener("click", () => {
    S.event.hostMessage = $("#reveal-message").value.trim() || "Thanks for an amazing night.";
    S.event.albumCtaLabel = cleanAlbumCta($("#reveal-cta").value);
    save();
    $("#sheet-reveal").hidden = true;
    doReveal();
  });
}

function deliveryChannel(contact) {
  const value = String(contact || "").trim();
  if (!value) return "in-app";
  return value.includes("@") ? "email" : "sms";
}
function buildDeliveryManifest() {
  const now = Date.now();
  const albumUrl = inviteUrl();
  return S.guests.map((g) => {
    const contact = g.contact || (g.id === "you" ? S.you.contact : "");
    const channel = deliveryChannel(contact);
    return {
      id: uid(),
      guestId: g.id,
      name: g.name || "Guest",
      contact: contact || "in-app only",
      channel,
      status: channel === "in-app" ? "needs contact" : "prototype sent",
      albumUrl,
      sentAt: now,
    };
  });
}
function deliverySummary() {
  const list = S.deliveries || [];
  const sent = list.filter((d) => d.status === "prototype sent").length;
  const inApp = list.filter((d) => d.status !== "prototype sent").length;
  return { total: list.length, sent, inApp };
}
function doReveal() {
  const e = S.event;
  if (!e || e.revealed) return;
  e.revealed = true;
  e.revealedAt = Date.now();
  e.deliveryStatus = "prototype_sent";
  S.deliveries = buildDeliveryManifest();
  save();
  if (BACKEND && e.remoteId) {
    BACKEND.reveal(e).catch((error) => {
      console.error(error);
      toast("ALBUM SAVED LOCALLY — CLOUD REVEAL FAILED");
    });
  }
  if (S.role === "host") go("s-album-sent");
  // guest side is picked up by the tick notification bubble
}


/* ============================================================
   HOST · REVIEW — iOS Photos-style multi-select
   ============================================================ */
let reviewSelecting = false;
let recapPickMode = false;
const reviewSel = new Set();

function enterReview() {
  if (!recapPickMode) {
    reviewSelecting = false;
    reviewSel.clear();
  }
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
  const useOriginal = opts.raw || S.event?.cameraStyle === "original";
  const film = el("div", "film" + (useOriginal ? " raw" : ""));
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
  $("#s-host-review").classList.toggle("recap-picking", recapPickMode);
  const ms = [...S.moments].reverse();
  const removed = ms.filter((m) => m.removed).length;

  $("#btn-review-select").textContent = recapPickMode ? "Done" : (reviewSelecting ? "Done" : "Select");
  $("#btn-reveal-2").style.display = reviewSelecting ? "none" : "";
  $("#select-bar").hidden = recapPickMode || !(reviewSelecting && reviewSel.size > 0);
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
  if (recapPickMode) {
    const max = recapLimit();
    $("#review-count").textContent = `${reviewSel.size}/${max} selected`;
    $("#review-hint").textContent = `PICK UP TO ${max} MOMENTS FOR THE RECAP. TAP DONE WHEN READY.`;
    return;
  }
  if (reviewSelecting) {
    $("#review-count").textContent = reviewSel.size
      ? `${reviewSel.size} selected`
      : "Select moments";
    $("#review-hint").textContent = "TAP TO SELECT · THEN FAVOURITE OR REMOVE.";
    return;
  }

  const phase = eventPhase();
  $("#review-count").textContent = `${total} moments · ${removed} removed`;
  const revealBtn = $("#btn-reveal-2");
  revealBtn.disabled = false;
  if (phase === "ended") {
    revealBtn.textContent = "Preview album →";
    $("#review-hint").textContent = "CAMERA IS CLOSED. REMOVE ANYTHING YOU DON’T WANT SENT, THEN PREVIEW THE FINAL ALBUM.";
  } else if (phase === "revealed") {
    revealBtn.disabled = false;
    revealBtn.textContent = "Open album →";
    $("#review-hint").textContent = "ALBUM HAS BEEN SENT. YOU CAN STILL VIEW THE FINAL EVENT PAGE.";
  } else {
    revealBtn.textContent = "Preview album now";
    $("#review-hint").textContent = "PROTOTYPE MODE: YOU CAN PREVIEW AND SEND NOW FOR TESTING.";
  }
}

function toggleSel(id, item) {
  if (reviewSel.has(id)) reviewSel.delete(id);
  else {
    if (recapPickMode && reviewSel.size >= recapLimit()) { toast(`MAX ${recapLimit()} MOMENTS FOR THIS RECAP`); return; }
    reviewSel.add(id);
  }
  item.classList.toggle("selected", reviewSel.has(id));
  const ms = S.moments;
  updateReviewHeader(ms.length, ms.filter((m) => m.removed).length);
  $("#select-bar").hidden = recapPickMode || reviewSel.size === 0; // only shows with a selection
}

function applyToSelected(fn, word) {
  if (!reviewSel.size) return;
  const n = reviewSel.size;
  const changed = S.moments.filter((m) => reviewSel.has(m.id));
  changed.forEach(fn);
  save();
  if (BACKEND) changed.forEach((m) => BACKEND.updateMoment(m).catch(console.error));
  reviewSel.clear();
  renderReview();
  toast(`${n} ${word}`);
}

function finishRecapPick() {
  const picked = new Set(reviewSel);
  S.moments.forEach((m) => { if (!m.removed) m.favorite = picked.has(m.id); });
  save();
  recapPickMode = false;
  reviewSelecting = false;
  reviewSel.clear();
  go("s-album");
  openRecap();
  toast("RECAP MOMENTS SET");
}
function startRecapPick() {
  recapPickMode = true;
  reviewSelecting = true;
  reviewSel.clear();
  S.moments.filter((m) => m.favorite && !m.removed).slice(0, recapLimit()).forEach((m) => reviewSel.add(m.id));
  go("s-host-review");
}
function bindReview() {
  $("#btn-review-select").addEventListener("click", () => {
    if (recapPickMode) { finishRecapPick(); return; }
    reviewSelecting = !reviewSelecting;
    reviewSel.clear();
    renderReview();
  });
  $("#act-fav").addEventListener("click", () => applyToSelected((m) => { m.favorite = true; }, "FAVOURITED"));
  $("#act-remove").addEventListener("click", () => applyToSelected((m) => { m.removed = true; }, "REMOVED"));
}

function previewVisibleMoments() {
  return S.moments.filter((m) => !m.removed).sort((a, b) => a.ts - b.ts);
}
function cleanAlbumCta(value) {
  const txt = String(value || "").trim();
  return txt.toLowerCase() === "next event" ? "" : txt;
}
function syncAlbumPreviewHeader() {
  const e = S.event;
  if (!e) return;
  const message = $("#pv-message-input").value.trim() || "Thanks for an amazing night.";
  const cta = cleanAlbumCta($("#pv-cta-input").value);
  e.hostMessage = message;
  e.albumCtaLabel = cta;
  const pvMessage = document.getElementById("pv-message");
  if (pvMessage) pvMessage.textContent = message;
  save();
}
function renderMomentList(list, items, view, opts = {}) {
  list.classList.toggle("grid", view === "grid");
  list.textContent = "";
  if (!items.length) {
    list.appendChild(el("p", "empty-note", "The album is empty."));
    return;
  }
  items.forEach((m, i) => {
    const fig = el("figure", "polaroid");
    fig.style.animationDelay = Math.min(i, 8) * 0.05 + "s";
    const ph = el("div", "ph");
    ph.appendChild(filmEl(m, { who: true }));
    if (m.kind === "clip") ph.appendChild(el("span", "vid-dot"));
    if (m.favorite) ph.appendChild(favBadge());
    fig.appendChild(ph);
    fig.addEventListener("click", () => openLightbox(m, opts));
    list.appendChild(fig);
  });
}
function syncPreviewView(prefix, view) {
  $$("#" + prefix + "-view button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
}
function renderAlbumPreview() {
  const e = S.event;
  if (!e) { go("s-host-create"); return; }
  $("#pv-name").textContent = e.name;
  const coverSrc = (e.invite && e.invite.cover) || e.cover;
  const cover = $("#pv-cover");
  if (coverSrc) { cover.style.backgroundImage = "url(" + coverSrc + ")"; cover.classList.add("has-img"); }
  else { cover.style.backgroundImage = ""; cover.classList.remove("has-img"); }
  const items = previewVisibleMoments();
  $("#pv-sub").textContent = fmtNum(items.length) + " MOMENTS · " + fmtNum(S.guests.length) + " GUESTS";
  $("#pv-message-input").value = e.hostMessage || "Thanks for an amazing night.";
  $("#pv-cta-input").value = cleanAlbumCta(e.albumCtaLabel);
  syncAlbumPreviewHeader();
  syncPreviewView("pv", previewAlbumView);
  renderMomentList($("#pv-list"), items, previewAlbumView, { host: true });
}
function renderAlbumConfirm() {
  const e = S.event;
  if (!e) { go("s-host-create"); return; }
  const coverSrc = (e.invite && e.invite.cover) || e.cover;
  const cover = $("#cf-cover");
  if (coverSrc) { cover.style.backgroundImage = "url(" + coverSrc + ")"; cover.classList.add("has-img"); }
  else { cover.style.backgroundImage = ""; cover.classList.remove("has-img"); }
  const items = previewVisibleMoments();
  $("#cf-name").textContent = e.name;
  $("#cf-message").textContent = e.hostMessage || "Thanks for an amazing night.";
  $("#cf-sub").textContent = fmtNum(items.length) + " MOMENTS · " + fmtNum(S.guests.length) + " GUESTS · " + fmtDT(e.start);
  syncPreviewView("cf", confirmAlbumView);
  renderMomentList($("#cf-list"), items, confirmAlbumView, { host: true });
}
function approveAlbumPreview() {
  syncAlbumPreviewHeader();
  save();
  go("s-album-confirm");
}
function approveAlbumConfirm() {
  if (eventPhase() !== "ended") toast("PROTOTYPE SEND — TIMER BYPASSED FOR TESTING");
  doReveal();
}
function bindAlbumPreview() {
  $("#pv-back-review").addEventListener("click", () => go("s-host-review"));
  $("#pv-message-input").addEventListener("input", syncAlbumPreviewHeader);
  $("#pv-cta-input").addEventListener("input", syncAlbumPreviewHeader);
  $("#pv-approve").addEventListener("click", approveAlbumPreview);
  $$("#pv-view button").forEach((b) => b.addEventListener("click", () => { previewAlbumView = b.dataset.view; renderAlbumPreview(); }));
  $("#cf-back-edit").addEventListener("click", () => go("s-album-preview"));
  $("#cf-edit").addEventListener("click", () => go("s-album-preview"));
  $("#cf-send").addEventListener("click", approveAlbumConfirm);
  $$("#cf-view button").forEach((b) => b.addEventListener("click", () => { confirmAlbumView = b.dataset.view; renderAlbumConfirm(); }));
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
  const canToggleRaw = !!opts.host && S.event?.cameraStyle !== "original";
  if (!canToggleRaw && raw) lbState.raw = false;
  stage.textContent = "";
  stage.appendChild(filmEl(m, { who: true, raw: canToggleRaw && raw }));
  $("#lb-toggle").hidden = !canToggleRaw;
  $("#lb-toggle").textContent = raw ? "View filtered" : "View original";

  const actions = $("#lb-actions");
  actions.textContent = "";
  if (opts.host) {
    actions.appendChild(lbAction("act-fav", m.favorite ? "Favourited" : "Favourite", () => {
      m.favorite = !m.favorite; save(); renderLightbox(); renderReview();
    }));
    if (!m.removed) {
      actions.appendChild(lbAction("act-remove", "Remove", () => {
        m.removed = true; save(); renderReview();
        toast("REMOVED FROM ALBUM"); closeLightbox();
      }));
    }
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
const recapCfg = { sec: 15, vibe: "none" };
let recapPlaying = false;
let recapTimer = null, recapRaf = 0;
let audioCtx = null, arpTimer = null, recapMuted = false;

function recapLimit() {
  return recapCfg.sec <= 15 ? 10 : 15;
}
function recapMoments() {
  const visible = S.moments.filter((m) => !m.removed);
  const favs = visible.filter((m) => m.favorite).sort((a, b) => a.ts - b.ts);
  const rest = visible.filter((m) => !m.favorite).sort((a, b) => a.ts - b.ts);
  return [...favs, ...rest].slice(0, recapLimit());
}

function openRecap() {
  recapStop();
  $("#recap").hidden = false;
  $("#recap-controls").hidden = false;
  $("#recap-progress").hidden = true;
  $("#recap-play").textContent = "Auto make movie";
  $("#recap-top-export").hidden = false;
  $("#recap-export-panel").hidden = true;
  syncRecapControls();
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
  drawRecapOrbit(ms);
  hideCard();
  updateRecapHelper(ms);
}

function drawRecapOrbit(ms) {
  const stage = $("#recap-stage");
  const orb = el("button", "recap-orb", "+");
  orb.type = "button";
  orb.setAttribute("aria-label", "Choose recap moments");
  orb.addEventListener("click", startRecapPick);
  stage.appendChild(orb);
  ms.slice(0, 8).forEach((m, i) => {
    const frames = framesOf(m);
    if (!frames[0]) return;
    const t = el("img", "recap-fly");
    t.src = frames[0];
    t.alt = "";
    t.style.setProperty("--i", i);
    stage.appendChild(t);
  });
}
function updateRecapHelper(ms = recapMoments()) {
  const helper = $("#recap-helper");
  if (helper) helper.textContent = `${recapCfg.sec}s · ${ms.length}/${recapLimit()} selected · tap + to choose`;
}
function exportRecap() {
  recapStop();
  $("#recap-controls").hidden = false;
  $("#recap-progress").hidden = true;
  $("#recap-export-panel").hidden = false;
  $("#recap-top-export").hidden = true;
  $("#recap-play").textContent = "Mix again";
  showCard("EXPORTED", S.event?.name || "Recap", "Ready to share");
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
  $("#recap-top-export").hidden = false;
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

  showCard("", "", "");
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
      showCard("PREVIEW READY", S.event.name, `${vis} MOMENTS`);
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
  $("#recap-play").textContent = "Mix again";
  $("#recap-top-export").hidden = false;
  $("#recap-export-panel").hidden = false;
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

function syncRecapControls() {
  const b = $("#recap-music-toggle");
  if (!b) return;
  const on = recapCfg.vibe !== "none";
  b.classList.toggle("on", on);
  b.dataset.vibe = recapCfg.vibe;
  b.textContent = on ? "♪ on" : "♪ off";
  $$("#recap-len button").forEach((x) => x.classList.toggle("on", +x.dataset.sec === recapCfg.sec));
  updateRecapHelper();
}

function bindRecap() {
  $("#btn-recap").addEventListener("click", openRecap);
  $("#recap-close").addEventListener("click", closeRecap);
  $("#recap-play").addEventListener("click", recapPlay);
  $("#recap-top-export").addEventListener("click", exportRecap);
  $("#recap-export").addEventListener("click", exportRecap);
  $("#recap-copy").addEventListener("click", () => copyText(inviteUrl()));
  $("#recap-share").addEventListener("click", () => {
    toast(`RECAP READY TO SHARE WITH ${S.guests.length} GUESTS`);
  });
  $("#recap-len").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    recapCfg.sec = +b.dataset.sec;
    syncRecapControls();
    $("#recap-export-panel").hidden = true;
    posterRecap();
  });
  $("#recap-music-toggle").addEventListener("click", () => {
    recapCfg.vibe = recapCfg.vibe === "none" ? "warm" : "none";
    syncRecapControls();
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
  $("#form-join").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#jn-name").value.trim();
    const contact = $("#jn-contact").value.trim();
    let ok = true;
    if (!name) { err($("#jn-name")); ok = false; }
    if (!contact) { err($("#jn-contact")); ok = false; }
    if (!ok) return;
    S.you = { ...S.you, name, contact };
    if (BACKEND && S.event.remoteId) {
      const submit = e.submitter;
      if (submit) submit.disabled = true;
      try {
        const joined = await BACKEND.joinEvent(S.event.code, name, contact);
        if (!joined) throw new Error("No guest record returned");
        S.you.remoteGuestId = joined.guest_id;
        S.you.requested = joined.join_status !== "approved";
        S.you.joined = joined.join_status === "approved";
        S.you.remoteFull = false;
        save();
        go(S.you.joined ? "s-guest-main" : "s-guest-full");
        toast(S.you.joined ? `WELCOME, ${name.toUpperCase()}` : "REQUEST SENT TO THE HOST");
      } catch (error) {
        console.error(error);
        const full = /full/i.test(error.message);
        S.you.remoteFull = full;
        save();
        if (full) go("s-guest-full");
        else toast("COULD NOT JOIN — TRY AGAIN");
      } finally {
        if (submit) submit.disabled = false;
      }
      return;
    }
    if (S.event.revealed) {
      S.you.joined = true;
      if (!S.guests.find((g) => g.id === "you")) S.guests.push({ id: "you", name, contact });
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
    S.guests.push({ id: "you", name, contact });
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

function renderGuestWait() {
  const full = !!S.you.remoteFull;
  $("#guest-wait-title").innerHTML = full ? "This event is<br/><em>currently full</em>" : "Request<br/><em>pending</em>";
  $("#guest-wait-sub").textContent = full ? "The host can make room for you." : "The host will let you in.";
  const button = $("#btn-request");
  button.textContent = full ? "Event full" : "Request sent ✓";
  button.disabled = true;
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

function captureOwnerId() {
  return S.role === "host" ? "host" : "you";
}
function captureOwnerName() {
  if (S.role === "host") return "Host";
  return S.you.name || "You";
}
function myMoments() {
  const owner = captureOwnerId();
  return S.moments.filter((m) => m.guestId === owner);
}

function updateCamera() {
  if (currentScreen !== "s-guest-main") return;
  if (recording) return; // never disturb an in-progress recording
  const e = S.event;
  $("#s-guest-main").classList.toggle("style-original", e?.cameraStyle === "original");
  const phase = eventPhase();
  const lock = $("#vf-lock");
  const cta = $("#vf-lock-cta");
  const waitCta = $("#vf-wait-cta");
  const limit = maxExposures(e);
  const left = limit === Infinity ? Infinity : Math.max(0, limit - myMoments().length);
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
    waitCta.hidden = true;
    $("#btn-shutter").disabled = true;
    if (phase === "upcoming") {
      $("#vf-lock-title").textContent = "Camera locked";
      $("#vf-lock-sub").textContent = `THE EVENT HASN’T STARTED — OPENS IN ${fmtCountdown(e.start - Date.now())}`;
    } else if (phase === "ended") {
      $("#vf-lock-title").textContent = "Waiting for host review";
      $("#vf-lock-sub").textContent = "CAPTURE CLOSED · YOUR MOMENTS ARE SAVED · ALBUM OPENS AFTER APPROVAL";
      waitCta.hidden = false;
    } else if (phase === "revealed") {
      $("#vf-lock-title").textContent = "Album ready";
      $("#vf-lock-sub").textContent = "THE HOST APPROVED THE FINAL ALBUM · GO RELIVE IT";
      cta.hidden = false;
    }
  }
  updateGuestChip();
  updateThumb();
}

let filmShown = null;
function setFilmCounter(n) {
  if (n === Infinity) {
    $("#r-prev").textContent = "∞";
    $("#hud-exp").textContent = "∞";
    $("#r-next").textContent = "∞";
  } else {
    $("#r-prev").textContent = n + 1;
    $("#hud-exp").textContent = n;
    $("#r-next").textContent = Math.max(0, n - 1);
  }
  if (filmShown !== null && filmShown !== n) {
    const reel = $("#film-reel");
    reel.classList.remove("roll");
    void reel.offsetWidth;
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
  if (BACKEND && S.event?.remoteId) {
    const guestId = S.role === "host" ? null : S.you.remoteGuestId;
    BACKEND.uploadMoment(S.event, guestId, m).then((remoteId) => {
      m.remoteId = remoteId;
      m.remote = true;
      save();
    }).catch((error) => {
      console.error(error);
      toast("CAPTURE KEPT ON THIS PHONE — UPLOAD FAILED");
    });
  }
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
  flashFx();
  if (cam.demo || camFacing === "user") { return; }
  const track = cam.stream?.getVideoTracks?.()[0];
  try {
    if (track?.getCapabilities?.().torch) {
      track.applyConstraints({ advanced: [{ torch: true }] });
      setTimeout(() => track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}), 260);
    }
  } catch {}
}

function whoName() {
  return captureOwnerName();
}

function takePhoto() {
  if (cam.busy || recording) return;
  if (maxExposures() !== Infinity && maxExposures() - myMoments().length <= 0) return;
  const s = captureSource();
  if (!s) { toast("CAMERA WARMING UP…"); return; }
  cam.busy = true;
  fireFlash();
  setTimeout(() => {
    const ts = Date.now();
    const frame = captureRaw(s.src, s.w, s.h, 840, 1120, s.mirror, 0.82);
    addMoment({ id: uid(), guestId: captureOwnerId(), name: whoName(), kind: "photo", ts, frames: [frame], removed: false });
    cam.busy = false;
  }, 120);
}

const CLIP_MS = 3000;   // up to 3 seconds
const CLIP_STEP = 220;  // grab a frame this often
const CLIP_MAX = 16;    // hard cap on captured frames

function toggleVideo() {
  if (recording) { finishVideo(); return; }
  if (maxExposures() !== Infinity && maxExposures() - myMoments().length <= 0) return;
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
    addMoment({ id: uid(), guestId: captureOwnerId(), name: whoName(), kind: "clip", ts: recTs, frames: boomer, removed: false });
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
  $("#vf-wait-cta").addEventListener("click", () => openGallery("moments"));

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
  $("#ge-name").textContent = e.name;
  const coverSrc = (e.invite && e.invite.cover) || e.cover;
  const cover = $("#ge-cover");
  if (coverSrc) { cover.style.backgroundImage = "url(" + coverSrc + ")"; cover.classList.add("has-img"); }
  else { cover.style.backgroundImage = ""; cover.classList.remove("has-img"); }
  setNum("#ge-guests", S.guests.length);
  setNum("#ge-moments", S.moments.length);
  const label = $("#ge-clock-label"), clock = $("#ge-clock");
  const liveLabel = $("#ge-live-label");
  const note = $("#ge-note");
  const now = Date.now();
  clock.style.fontSize = ""; clock.style.fontFamily = ""; clock.style.fontStyle = ""; clock.style.fontWeight = "";
  if (e.revealed) {
    liveLabel.textContent = "ALBUM READY";
    note.textContent = "The host approved the album. Everyone can relive it now.";
    label.textContent = "REVEALED";
    styleTextNum(clock, "It’s open");
  } else if (now < e.start) {
    liveLabel.textContent = "UPCOMING";
    note.textContent = "Camera opens when the event starts.";
    label.textContent = "STARTS IN";
    clock.textContent = fmtCountdown(e.start - now);
  } else if (now >= e.end) {
    liveLabel.textContent = "CAPTURE CLOSED";
    note.textContent = "Your moments are saved. Waiting for the host to approve the album.";
    label.textContent = "REVIEW";
    styleTextNum(clock, "Waiting for host approval");
  } else if (e.unlock === "manual") {
    liveLabel.textContent = "LIVE EVENT";
    note.textContent = "Everyone’s capturing. No one’s peeking.";
    label.textContent = "REVEAL";
    styleTextNum(clock, "After host review");
  } else {
    liveLabel.textContent = "LIVE EVENT";
    note.textContent = "Everyone’s capturing. No one’s peeking.";
    label.textContent = e.unlock === "time" ? "REVIEW REMINDER" : "CAPTURE ENDS IN";
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
  const coverSrc = (e.invite && e.invite.cover) || e.cover;
  const cover = $("#al-cover");
  if (coverSrc) { cover.style.backgroundImage = `url(${coverSrc})`; cover.classList.add("has-img"); }
  else { cover.style.backgroundImage = ""; cover.classList.remove("has-img"); }
  const accent = (e.invite && e.invite.accent) || "#F8F6F0";
  const albumScreen = $("#s-album");
  albumScreen.style.setProperty("--album-accent", hexA(accent, 0.16));
  albumScreen.style.setProperty("--album-accent-solid", accent);
  $("#al-message").textContent = e.hostMessage || "Thanks for an amazing night.";
  const ctaLabel = cleanAlbumCta(e.albumCtaLabel);
  const ctaBtn = $("#al-cta");
  ctaBtn.hidden = !ctaLabel;
  ctaBtn.textContent = ctaLabel;
  const visible = S.moments.filter((m) => !m.removed);
  $("#al-sub").textContent = `${fmtNum(visible.length)} MOMENTS · ${fmtNum(S.guests.length)} GUESTS · ${fmtDT(e.start)}`;

  const isHost = S.role === "host";
  $("#btn-recap").hidden = !isHost; // only the host builds the recap film
  const shareCard = $("#album-share-card");
  if (shareCard) shareCard.hidden = !isHost;
  $("#al-scope").style.display = isHost ? "none" : "flex";
  if (isHost) albumScope = "all";
  if (!albumView) albumView = "grid";
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

function renderAlbumSent() {
  const summary = deliverySummary();
  const sub = $("#sent-sub");
  if (sub) sub.textContent = summary.total ? "Sent to " + summary.total + " guests. You can still share the album link manually." : "Album is ready. You can share the link manually.";
}
function bindAlbumSent() {
  $("#sent-open").addEventListener("click", () => go("s-album"));
  $("#sent-copy").addEventListener("click", () => copyText(inviteUrl()));
  $("#sent-share").addEventListener("click", () => shareEventLink("Open the album"));
}

function bindAlbum() {
  $("#al-cta").addEventListener("click", () => toast("CTA PLACEHOLDER — CONNECT LATER"));
  const copyAlbum = $("#al-copy");
  if (copyAlbum) copyAlbum.addEventListener("click", () => copyText(inviteUrl()));
  const shareAlbum = $("#al-share");
  if (shareAlbum) shareAlbum.addEventListener("click", () => shareEventLink("Open the album"));
  const qrAlbum = $("#al-show-qr");
  if (qrAlbum) qrAlbum.addEventListener("click", openQrPop);
  const homeAlbum = $("#al-home");
  if (homeAlbum) homeAlbum.addEventListener("click", () => go("s-host-dash"));
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
  if (e?.remoteId) return;
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
   CLOCK TICK — countdowns, review reminders, notifications
   ============================================================ */
function tick() {
  const e = S.event;
  if (!e) return;
  const now = Date.now();

  // Safety: never auto-reveal. Timers only close capture and can remind the host to review.
  if (!e.revealed && e.unlock === "time" && e.revealAt && now >= e.revealAt && !e.reviewReminderSeen) {
    e.reviewReminderSeen = true;
    save();
    if (S.role === "host") toast("REVIEW REMINDER — APPROVE WHEN READY");
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
    $("#notif-body").textContent = `${e.name} album is ready.`;
    $("#notif").hidden = false;
  }
}

/* ============================================================
   BOOT
   ============================================================ */
function bindChrome() {
  $$("#role-toggle button").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.role)));
  $$("[data-go-role]").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.goRole)));
  $$("[data-back]").forEach((b) => b.addEventListener("click", () => {
    if (recapPickMode) { recapPickMode = false; reviewSelecting = false; reviewSel.clear(); go("s-album"); return; }
    go(b.dataset.back);
  }));
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

async function ensureRemoteEvent() {
  if (!BACKEND || !S.event || S.event.remoteId) return S.event;
  if (!remoteCreatePromise) {
    remoteCreatePromise = BACKEND.createEvent(S.event).then((event) => {
      S.event = { ...S.event, ...event };
      save();
      return S.event;
    }).catch((error) => {
      remoteCreatePromise = null;
      throw error;
    });
  }
  return remoteCreatePromise;
}

function mergeRemote(snapshot) {
  if (!snapshot) return;
  if (snapshot.event) S.event = { ...S.event, ...snapshot.event };
  if (S.role === "host") {
    const allGuests = snapshot.guests || [];
    S.remoteRequests = allGuests.filter((g) => g.status === "pending");
    S.guests = allGuests.filter((g) => g.status === "approved");
  } else if (snapshot.guest) {
    S.you.remoteGuestId = snapshot.guest.id;
    S.you.requested = snapshot.guest.status === "pending";
    S.you.joined = snapshot.guest.status === "approved";
    if (S.you.joined) S.guests = snapshot.guests || S.guests;
  }
  if (snapshot.moments) {
    const pending = S.moments.filter((m) => !m.remote);
    S.moments = [...snapshot.moments, ...pending];
  }
  save();
}

async function pollRemote() {
  if (!BACKEND || remoteBusy || !S.event?.remoteId) return;
  remoteBusy = true;
  try {
    const snapshot = S.role === "host"
      ? await BACKEND.loadHost(S.event.remoteId)
      : await BACKEND.loadGuest(S.event.remoteId);
    mergeRemote(snapshot);
    const target = screenForRole(S.role);
    if (S.role === "guest" && currentScreen === "s-guest-full" && target !== currentScreen) go(target);
    else refreshActive();
  } catch (error) {
    console.error("Supabase sync", error);
  } finally {
    remoteBusy = false;
  }
}

async function initRemote() {
  if (!BACKEND) return;
  try {
    await BACKEND.init();
    const code = BACKEND.routeCode();
    if (code) {
      const event = await BACKEND.previewEvent(code);
      if (!event) throw new Error("Event not found");
      const changingEvent = S.event?.code !== code;
      if (changingEvent) {
        S.guests = [];
        S.moments = [];
        S.you = { joined: false, requested: false, remoteGuestId: null };
      }
      S.event = { ...S.event, ...event };
      S.role = "guest";
      save();
      await pollRemote();
    } else if (S.role === "host" && S.event?.remoteId) {
      await pollRemote();
    }
  } catch (error) {
    console.error(error);
    toast("CLOUD OFFLINE — USING THIS DEVICE");
  }
}

async function boot() {
  bindChrome();
  bindEventType();
  bindCreate();
  bindUnlock();
  bindPackage();
  bindStyle();
  bindExposures();
  bindShare();
  bindDash();
  bindJoin();
  bindCamera();
  bindReview();
  bindLightbox();
  bindRecap();
  bindAlbum();
  bindAlbumSent();
  bindAlbumPreview();
  updatePkgBtn();
  await initRemote();

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
  setInterval(pollRemote, 3000);
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

// Keep the installed iPhone web app current while still providing a basic
// offline shell. Service workers require HTTPS (or localhost).
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
