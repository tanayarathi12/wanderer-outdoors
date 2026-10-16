# Repair notes — The Wanderer Outdoors

This package was reviewed against the saved project context and the actual column mapping used by the website. No live database changes were made while preparing this package.

## Confirmed project assumptions
- The site uses the existing Supabase project and should keep it; do not create a new project for deployment.
- Booking rows use `travel_date`, `trip_title`, `trip_kind`, `special_req`, `payment_status`, `status`, and `created_at` in the live schema.
- Payment amount, payment method, transaction reference, and receipt token are preserved in `special_req` metadata for compatibility with the existing schema.
- Enquiry submissions map to the actual `public.enquiries` columns (`travel_type`, `destination`, `travel_date`, `people`, `budget`, `requirements`, `message`).
- The Control Room saves the full content state, including `seo`, into `site_content`; public metadata is applied by the client when the page loads.

## Important receipt requirement
The live schema previously inspected did not have a `get_booking_by_token` function or dedicated `receipt_token` column. This package includes an updated, additive migration at `supabase/migration_receipts_payments_v2.sql`. Run that migration once in the existing project's SQL Editor before relying on public shareable receipt links. It adds optional columns and a token-only function; it does not drop tables or delete existing bookings. The function can resolve old tokens stored in `special_req` as well as the new column.

Do **not** run `supabase/schema.sql` over the existing database; it is for a new project, not an existing live project.

## Current code changes
- Blog cards now route to article details by slug, ID, or title slug.
- Full blog article view includes the excerpt and supports basic headings, paragraphs, bold text, and bullet lists safely.
- Booking submit no longer opens WhatsApp automatically; it shows the confirmation and receipt choices first.
- Public receipt view maps the actual Supabase row fields and decodes receipt metadata.
- Control Room View Receipt and Notify Customer extract the token from `special_req`.
- SEO settings save with the state in Supabase; help text explains that sitemap/robots links are not Google verification.
- Sitemap now lists the canonical homepage only because hash-based SPA sections are not separate sitemap URLs.
- Added mobile layout rules for public pages, booking/receipt screens, and the Control Room.

## Checks completed
- `node --check app.js`
- `node --check assets/js/backend.js`
- `node --check admin/assets/js/app.js`
- `sitemap.xml` parsed successfully.
- ZIP archive integrity checked.

Live end-to-end tests for Supabase receipt lookup, Google Search Console, WhatsApp, and physical-device mobile layout still need to be completed before production launch.
