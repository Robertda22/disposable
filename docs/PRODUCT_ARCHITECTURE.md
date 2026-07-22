# Disposable: Production Product And Architecture

## Product

Disposable is a shared event camera. A host creates an event and shares its QR
code. Up to 20 guests join in a browser, capture photos during the event, and
wait while the host reviews the material. The album becomes visible only after
the host explicitly approves and reveals it.

This document replaces the unrelated Swift arcade-game packet in the old
`Portfolio/disposable/docs` folder. The production source of truth is this Git
repository in `Personal/Apps/disposable`.

## Delivery Shape

- One responsive web app for host and guest.
- Installable iPhone PWA for hosts.
- HTTPS guest website opened from a real event QR code.
- Vercel for frontend hosting and deployment previews.
- Supabase for Postgres, Auth, Storage, and Realtime.
- No native iOS build is required for the first live tests.

## Roles

### Host

- Signs in with email magic link.
- Creates and owns events.
- Shares the event URL and QR code.
- Accepts or declines join requests.
- Captures host-owned photos.
- Reviews, removes, and favourites event media.
- Writes the final album message.
- Explicitly approves and reveals the album.

### Guest

- Opens an event URL without installing an app.
- Receives an anonymous authenticated session.
- Requests to join using a display name.
- Captures only after host approval and while the event is live.
- Can access their own captures before reveal.
- Can access the approved album only after host reveal.

### Co-host

The database supports additional event members, but the first 20-person test
only needs one owner. Co-host invitation UI can follow after the shared event
flow is stable.

## Non-Negotiable Rules

- Albums never auto-reveal.
- Event timers only close capture and remind the host to review.
- Guests cannot read another event's data.
- Guests cannot remove or alter another guest's captures.
- Host and guest capture limits are tracked separately by user.
- Media files live in private cloud storage, never in `localStorage`.
- QR codes contain a real HTTPS URL: `/e/{event-code}`.

## Production Data

- `events`: event settings, owner, capacity, timing, status, invite design.
- `event_members`: owner and future co-host permissions.
- `guests`: anonymous user membership and approval state.
- `moments`: media metadata and private storage path.
- `albums`: host message and reveal approval.
- `deliveries`: later email/SMS delivery attempts.

The executable first-pass schema is in `supabase/schema.sql`.

## Migration From Prototype

The current `localStorage` state remains a demo fallback until the remote data
adapter is connected. Production work should replace storage in this order:

1. Event creation and loading by event code.
2. Host authentication and event ownership.
3. Guest anonymous sessions and join requests.
4. Realtime guest/request/dashboard updates.
5. Media upload to private Storage.
6. Review, approval, and reveal state.
7. Final album loading and manual share URL.

Do not attempt to sync the existing browser data blob between devices. Migrate
each domain operation to the backend explicitly.

## Test Target

The first real test is complete when one host and 20 guest phones can:

1. Open the same hosted event.
2. Join without creating guest accounts.
3. Capture within their own shot allowance.
4. See live event counts update across devices.
5. Stop capturing when the host closes the event or its timer ends.
6. Wait while the host reviews.
7. Open the same revealed album after host approval.

Email, SMS, payments, AI moderation, and a real generated recap video are not
required for this test. Album links can be shared manually first.

## Deployment Workflow

- Pull requests and branches create Vercel preview deployments.
- `main` deploys the stable phone-test version.
- Supabase migrations are applied deliberately before frontend code that uses
  them is merged.
- The installed iPhone PWA receives frontend updates from the hosted site; it
  does not need App Store updates.

