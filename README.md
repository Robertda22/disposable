# Disposable

Disposable is an event camera prototype moving toward a shared, installable
web app for iPhone hosts and browser-based guests.

The production direction is one installable iPhone web app for hosts and the
same hosted website for guests joining by QR. See
`docs/PRODUCT_ARCHITECTURE.md`. The unrelated Swift arcade-game documents in
the old `Portfolio/disposable` folder are obsolete and must not guide this app.

## App Location

Local folder:
`/Users/robertratha/Desktop/Personal/Apps/disposable`

GitHub:
`git@github.com:Robertda22/disposable.git`

Run locally:
```bash
cd /Users/robertratha/Desktop/Personal/Apps/disposable
python3 -m http.server 4173
```

Open:
`http://localhost:4173/`

Install on iPhone after deployment:
1. Open the HTTPS app URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen, then Open as Web App.

The manifest, app icons, service worker, and Vercel routing needed for this are
already included in the repository.

## Current Prototype Flow

Host:
- Create event.
- Choose reveal/reminder settings.
- Choose package.
- Choose camera style: Vintage or Original.
- Choose per-guest moment limit: 5, 10, 24, 36, or infinite.
- Create and customize invite.
- Share invite / QR.
- Watch dashboard.
- Review captured moments.
- Preview final album as guests will see it.
- Write album message and CTA label.
- Approve and send album.

Guest:
- Join event with name and contact.
- Capture photo/video moments while event is live.
- After event ends, camera closes.
- Guest waits while host reviews.
- After host approves, guest gets album-ready notification.
- Guest opens final album.

## Safety Rule

Albums must never auto-reveal.

When the event ends:
- Capture closes.
- Guests cannot capture more moments.
- Host reviews moments.
- Host previews the album.
- Host presses Approve & Send.
- Only then does the album open for guests.

Scheduled reveal time is only a reminder, not automatic reveal.

## What Is Real

- Frontend flows.
- Supabase anonymous sessions for each browser/device.
- Shared events and guest requests in the Supabase database.
- Host approval of guest requests across devices (3-second polling).
- Private capture uploads in the Supabase `event-media` bucket.
- Host moderation and manual album reveal state shared across devices.
- Real event URLs and scannable QR codes using `/e/CODE` routes.
- Local state remains as an offline/demo fallback.
- Camera/demo camera capture.
- Invite customization prototype.
- Host review and album preview prototype, including early preview/send for testing.
- Guest waiting and album-ready states.

## What Is Still Prototype-Only

- Host identity uses an anonymous browser session, not a recoverable account.
- No real email or SMS sending.
- Payments are demo only.
- Recap film is client-side prototype, not AI-generated video.
- Video captures currently upload their first frame as a still image.
- The app polls Supabase; realtime subscriptions are not wired yet.

## Production Handoff

Production readiness map: `PRODUCTION_READINESS.md`

Current architecture and corrected product direction:
`docs/PRODUCT_ARCHITECTURE.md`

Supabase schema:
`supabase/schema.sql`

The browser connection uses the public publishable key in
`supabase-config.js`. Never put a Supabase secret or service-role key in this
repository.

If the schema was installed before 22 July 2026, run
`supabase/fix-join-event.sql` once in the Supabase SQL Editor.

The app now creates a local reveal delivery manifest when the host approves the album. This is still fake sending, but it gives the future backend/email worker a clear contract to replace.

## Next Build Tasks

1. Run `supabase/fix-join-event.sql` in the existing Supabase project.
2. Test one host plus several real guest phones through the deployed QR route.
3. Add a recoverable host login before external client use.
4. Add email/SMS delivery only after the shared event flow is stable.
5. Replace first-frame clip uploads with real compressed video uploads.

## Git Habit

After every useful change:

```bash
git status --short --branch
git add .
git commit -m "Describe the change"
git push
```

The user wants GitHub synced after each completed change so the next AI can continue safely.


## Current prototype pricing notes

Shot limits currently support 5, 10, 24, 36, and unlimited captures per guest. 24 is included by default, 36 adds 10 SEK total, and unlimited adds 20 SEK total in the prototype payment sheet.
