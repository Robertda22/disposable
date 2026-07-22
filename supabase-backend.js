(function () {
  "use strict";

  const config = window.DISPOSABLE_SUPABASE_CONFIG;
  const sdk = window.supabase;
  if (!config?.url || !config?.publishableKey || !sdk?.createClient) return;

  const client = sdk.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  let user = null;

  function fail(context, error) {
    const detail = error?.message || String(error || "Unknown error");
    throw new Error(context + ": " + detail);
  }

  async function init() {
    const current = await client.auth.getSession();
    if (current.error) fail("Could not read session", current.error);
    let session = current.data.session;
    if (!session) {
      const signed = await client.auth.signInAnonymously();
      if (signed.error) fail("Anonymous sign-in failed", signed.error);
      session = signed.data.session;
    }
    user = session?.user || null;
    if (!user) throw new Error("Supabase session did not return a user");
    return user;
  }

  function routeCode() {
    const match = location.pathname.match(/^\/e\/([A-Z0-9]{4,10})\/?$/i);
    return (match?.[1] || new URLSearchParams(location.search).get("event") || "").toUpperCase();
  }

  function eventPayload(event, status) {
    const exposures = event.exposures === "infinite" ? null : Number(event.exposures || 24);
    return {
      owner_id: user.id,
      code: event.code,
      event_type: event.eventType || "birthday",
      name: event.name,
      starts_at: new Date(event.start).toISOString(),
      ends_at: new Date(event.end).toISOString(),
      review_reminder_at: event.revealAt ? new Date(event.revealAt).toISOString() : null,
      status: status || (event.shared ? "live" : "draft"),
      camera_style: event.cameraStyle || "vintage",
      guest_capacity: Math.min(20, Number(event.max || 20)),
      captures_per_guest: exposures,
      invite: event.invite || {},
      host_message: event.hostMessage || "Thanks for an amazing night.",
      album_cta_label: event.albumCtaLabel || null,
    };
  }

  function localEvent(row, fallback) {
    return {
      ...(fallback || {}),
      remoteId: row.id,
      code: row.code,
      eventType: row.event_type,
      name: row.name,
      start: new Date(row.starts_at).getTime(),
      end: new Date(row.ends_at).getTime(),
      revealAt: row.review_reminder_at ? new Date(row.review_reminder_at).getTime() : null,
      cameraStyle: row.camera_style,
      max: row.guest_capacity,
      exposures: row.captures_per_guest == null ? "infinite" : row.captures_per_guest,
      invite: row.invite || {},
      hostMessage: row.host_message || fallback?.hostMessage,
      albumCtaLabel: row.album_cta_label || fallback?.albumCtaLabel,
      shared: row.status !== "draft",
      revealed: row.status === "revealed",
      revealedAt: row.revealed_at ? new Date(row.revealed_at).getTime() : null,
    };
  }

  async function createEvent(event) {
    const result = await client.from("events").insert(eventPayload(event, "draft")).select().single();
    if (result.error) fail("Could not create event", result.error);
    return localEvent(result.data, event);
  }

  async function publishEvent(event) {
    const result = await client.from("events").update(eventPayload(event, "live")).eq("id", event.remoteId).select().single();
    if (result.error) fail("Could not publish event", result.error);
    return localEvent(result.data, event);
  }

  async function previewEvent(code) {
    const result = await client.rpc("event_preview", { event_code: code });
    if (result.error) fail("Event could not be opened", result.error);
    const row = result.data?.[0];
    return row ? localEvent(row) : null;
  }

  async function joinEvent(code, name, contact) {
    const result = await client.rpc("join_event", {
      event_code: code,
      guest_name: name,
      guest_contact: contact || null,
    });
    if (result.error) fail("Could not request access", result.error);
    return result.data?.[0] || null;
  }

  async function loadHost(eventId) {
    const [eventResult, guestResult, momentResult] = await Promise.all([
      client.from("events").select("*").eq("id", eventId).single(),
      client.from("guests").select("*").eq("event_id", eventId).order("joined_at"),
      client.from("moments").select("*").eq("event_id", eventId).order("created_at"),
    ]);
    if (eventResult.error) fail("Could not load event", eventResult.error);
    if (guestResult.error) fail("Could not load guests", guestResult.error);
    if (momentResult.error) fail("Could not load captures", momentResult.error);
    return hydrate(eventResult.data, guestResult.data, momentResult.data);
  }

  async function loadGuest(eventId) {
    const guestResult = await client.from("guests").select("*").eq("event_id", eventId).eq("user_id", user.id).maybeSingle();
    if (guestResult.error) fail("Could not load guest status", guestResult.error);
    const guest = guestResult.data;
    if (!guest || guest.status !== "approved") return { guest, event: null, guests: [], moments: [] };
    const [eventResult, guestsResult, momentsResult] = await Promise.all([
      client.from("events").select("*").eq("id", eventId).single(),
      client.from("guests").select("*").eq("event_id", eventId).eq("status", "approved"),
      client.from("moments").select("*").eq("event_id", eventId).order("created_at"),
    ]);
    if (eventResult.error) fail("Could not load event", eventResult.error);
    if (guestsResult.error) fail("Could not load guests", guestsResult.error);
    if (momentsResult.error) fail("Could not load captures", momentsResult.error);
    return { guest, ...await hydrate(eventResult.data, guestsResult.data, momentsResult.data) };
  }

  async function hydrate(eventRow, guestRows, momentRows) {
    const guests = (guestRows || []).map((g) => ({
      id: g.id, name: g.display_name, contact: g.contact || "", status: g.status, remote: true,
    }));
    const moments = await Promise.all((momentRows || []).map(async (m) => {
      const signed = await client.storage.from("event-media").createSignedUrl(m.storage_path, 3600);
      return {
        id: m.id,
        remoteId: m.id,
        guestId: m.guest_id || "host",
        name: guests.find((g) => g.id === m.guest_id)?.name || (m.guest_id ? "Guest" : "Host"),
        kind: m.kind,
        ts: new Date(m.created_at).getTime(),
        frames: signed.data?.signedUrl ? [signed.data.signedUrl] : [],
        removed: m.removed,
        favorite: m.favourite,
        remote: true,
      };
    }));
    return { event: localEvent(eventRow), guests, moments: moments.filter((m) => m.frames.length) };
  }

  async function setGuestStatus(guestId, status) {
    const result = await client.from("guests").update({ status }).eq("id", guestId);
    if (result.error) fail("Could not update guest", result.error);
  }

  function dataUrlBlob(dataUrl) {
    const parts = dataUrl.split(",");
    const mime = parts[0].match(/:(.*?);/)?.[1] || "image/jpeg";
    const raw = atob(parts[1]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function uploadMoment(event, guestId, moment) {
    const frame = moment.frames?.[0];
    if (!frame?.startsWith("data:")) throw new Error("Capture has no uploadable frame");
    const path = `${event.remoteId}/${user.id}/${crypto.randomUUID()}.jpg`;
    const uploaded = await client.storage.from("event-media").upload(path, dataUrlBlob(frame), { contentType: "image/jpeg" });
    if (uploaded.error) fail("Could not upload capture", uploaded.error);
    const inserted = await client.from("moments").insert({
      event_id: event.remoteId,
      guest_id: guestId || null,
      owner_user_id: user.id,
      kind: moment.kind,
      storage_path: path,
      width: 840,
      height: 1120,
      duration_ms: moment.kind === "clip" ? 2800 : null,
    }).select().single();
    if (inserted.error) {
      await client.storage.from("event-media").remove([path]);
      fail("Could not save capture", inserted.error);
    }
    return inserted.data.id;
  }

  async function updateMoment(moment) {
    if (!moment.remoteId) return;
    const result = await client.from("moments").update({ removed: !!moment.removed, favourite: !!moment.favorite }).eq("id", moment.remoteId);
    if (result.error) fail("Could not update capture", result.error);
  }

  async function reveal(event) {
    const album = await client.from("albums").upsert({
      event_id: event.remoteId,
      approved_by: user.id,
      host_message: event.hostMessage || "Thanks for an amazing night.",
      cta_label: event.albumCtaLabel || null,
    });
    if (album.error) fail("Could not approve album", album.error);
    const updated = await client.from("events").update({
      status: "revealed",
      host_message: event.hostMessage || "Thanks for an amazing night.",
      album_cta_label: event.albumCtaLabel || null,
      revealed_at: new Date().toISOString(),
    }).eq("id", event.remoteId);
    if (updated.error) fail("Could not reveal album", updated.error);
  }

  window.DisposableBackend = {
    client, init, routeCode, createEvent, publishEvent, previewEvent, joinEvent,
    loadHost, loadGuest, setGuestStatus, uploadMoment, updateMoment, reveal,
    get user() { return user; },
  };
})();
