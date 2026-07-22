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
- Local event state.
- Local guest/host role switching.
- Camera/demo camera capture.
- Local photo/video moment storage in browser storage.
- Invite customization prototype.
- Host review and album preview prototype, including early preview/send for testing.
- Guest waiting and album-ready states.

## What Is Fake / Local

- Data is only localStorage.
- No real database.
- No real authentication.
- No real file/photo cloud storage.
- No real email or SMS sending.
- Payments are demo only.
- Invite links and QR codes are prototype-only.
- Recap film is client-side prototype, not AI-generated video.

## Production Handoff

Production readiness map: `PRODUCTION_READINESS.md`

Current architecture and corrected product direction:
`docs/PRODUCT_ARCHITECTURE.md`

First-pass Supabase schema:
`supabase/schema.sql`

The app now creates a local reveal delivery manifest when the host approves the album. This is still fake sending, but it gives the future backend/email worker a clear contract to replace.

## Next Build Tasks

1. Create a Supabase project and apply `supabase/schema.sql`.
2. Replace local event, guest, and capture state with Supabase reads and writes.
3. Upload captures to the private `event-media` bucket.
4. Test one host plus several real guest phones through the deployed QR route.
5. Add email/SMS delivery only after the shared event flow is stable.

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
