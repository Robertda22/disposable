# Disposable

Disposable is a local static prototype for an event camera app.

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

## Next Build Tasks

1. Improve album preview controls: CTA link placeholder, clearer included/removed/favorite state.
2. Make host review easier: tabs for Included, Removed, Favorites.
3. Add dev/test controls for forcing live, ended, and revealed states.
4. Tighten guest album page after reveal with a stronger emotional finish.
5. Later: real backend, auth, storage, email/SMS, moderation, and deployment.

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
