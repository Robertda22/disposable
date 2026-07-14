# Production Readiness Map

This app is still a local static prototype. The UI flow is useful, but it is not ready for real multi-person events until the pieces below exist.

## Must Build Before Real Users

1. Backend database
   - events
   - guests
   - join requests
   - captures/media records
   - album/reveal records
   - delivery records

2. Real file storage
   - original uploads
   - processed/vintage versions
   - invite cover images
   - album cover images
   - generated recap files later

3. Real auth and permissions
   - host owns event
   - guest can only access their event
   - album only opens after host approval
   - admin/moderation role later

4. Real invite links
   - unique event URL
   - QR points to hosted join page
   - no dependency on the creator browser state

5. Real sending
   - email/SMS provider
   - delivery status per guest
   - retry failed sends
   - unsubscribe/privacy basics

6. Moderation and safety
   - host review before reveal is already in the prototype
   - production still needs reporting, abuse controls, and eventually AI moderation

7. Deployment
   - hosted frontend
   - backend API
   - database migrations
   - object storage bucket policies
   - environment variables

## Current App-Side Foundation

The prototype now keeps a reveal delivery manifest after approval. In production, replace that local manifest with real delivery rows and an email/SMS worker.

## Biggest Current Holes

- localStorage means only one browser truly has the event data.
- Captures are stored in the browser, not cloud storage.
- Guest contact is collected, but sending is still simulated.
- Payments are demo only.
- Invite links and QR codes are still prototype codes.
- No account system or host ownership.

## Recommended Next Build Order

1. Pick backend stack: Supabase is the fastest fit for this prototype.
2. Move event, guest, request, capture, reveal, and delivery state out of localStorage.
3. Upload captures to cloud storage instead of browser storage.
4. Make QR/invite links real route URLs.
5. Add email/SMS sending from the delivery manifest.
