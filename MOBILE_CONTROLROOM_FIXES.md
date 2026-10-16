# Mobile + Control Room improvements (2026-10-15)

This package is a single static website folder intended to be deployed as one Vercel project. The Control Room remains at `/admin/` inside the same folder; it is not a separate deployment. Its login uses Supabase Auth when configured, while database authorization still depends on the existing Supabase RLS/policies.

## Implemented in this revision
- Hardened small-screen layouts for booking/payment modals, QR image wrappers, UPI ID/link/instructions, receipt actions, trip cards, and the bottom admin toolbar. QR image sizing is constrained by both viewport width and parent width; flexible rows stack on narrow screens to avoid horizontal overflow.
- Section colour controls now apply to the category view, heading, body text, and accent/CTA colour.
- Added optional section-level CTA controls (show/hide, label, destination) and editable homepage category-pill destinations.
- Added Control Room fields for homepage reserve CTA, featured-trip destination, home WhatsApp, footer WhatsApp, and footer email destinations.
- Preserved per-adventure card colours and Details/Book button destinations. Preserved the custom-trip CTA in the Tours category instead of fixed tour cards.
- Added a `buttonLinks` merge path so global destinations survive reloads from Supabase.
- Removed the public-page editing entry point and disabled offline Control Room access when Supabase is not configured. Control Room is included at `/admin/` in this same folder and must authenticate against the existing Supabase project.
- The Tours route now uses a metadata-tolerant guard to render the custom-trip enquiry panel rather than fixed tour cards, including for legacy saved section metadata. The homepage featured list also excludes sections identified as tours by key, ID, title, kicker, or booking type.

## Verification performed
- `node --check app.js`
- `node --check admin/assets/js/app.js`
- `node --check assets/js/backend.js`
- ZIP integrity check after packaging.

## Still requires preview testing
A real mobile viewport/browser end-to-end test was not completed in this environment. Before pointing the production domain at this build, test the booking modal with a QR configured, submit a test booking, verify the Control Room login, change/save a colour and button destination, and check the result on a narrow phone viewport. Do not run `supabase/schema.sql` against the existing live database. This package does not modify the live Supabase project.
