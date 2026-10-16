# The Wanderer Outdoors — Setup Checklist

Do these in order. **Essential** items are required for the site to function.
**Optional** items add features (live Google reviews, custom domain).

---

## ✅ ESSENTIAL (do first)

- [ ] **1. Preview locally** — run `npx serve .` (or `python3 -m http.server`) and open the URL. Browse the site.
- [ ] **2. Use the EXISTING Supabase project** — this site is already connected; do not create another project just for the owner.
- [ ] **3. Do not run `supabase/schema.sql` against the existing live database.** It is a fresh-project schema. For secure updated receipt links only, review and run `supabase/migration_receipts_payments_v2.sql` once in the existing project's SQL Editor.
- [ ] **4. Confirm the site config** — `assets/js/config.js` should contain the existing Project URL + public anon key. Never use the service-role key in the browser.
- [ ] **5. Sign in to the Control Room** — open `/admin/` using an authorized editor account.
- [ ] **6. Test a booking** — submit one test booking and confirm it appears in `/admin/` → Bookings. The site should show the confirmation screen first; WhatsApp opens only if the customer chooses that option.
- [ ] **7. Test the receipt** — on the success card click "View / Print Official Receipt"; try **Download PDF** and **Share PDF on WhatsApp**. After running the migration, test the same receipt link in a private/incognito window after marking payment as received.
- [ ] **8. Test blog, SEO, enquiries, payments and mobile layouts** before launch.
- [ ] **9. Deploy** — push the tested folder to GitHub, import to Vercel (Framework: Other, no build command). Set `GOOGLE_PLACES_API_KEY` in Vercel Environment Variables only if live Google Reviews is enabled. Confirm the site loads on the `.vercel.app` preview URL.
- [ ] **10. Verify visitor mode** — open the preview in a private/incognito window: no editing tools; there should be no footer Edit link, and `/admin/` should require an authorized Supabase editor login.

---

## ⚙️ OPTIONAL (enhancements)

- [ ] **11. Live Google Reviews** — Google Cloud Console: enable Places API, create key. Set `GOOGLE_PLACES_API_KEY` in your host's environment variables. In Control Room → Reviews, enter Place ID and enable Google Reviews.
- [ ] **12. Per-trip payments** — in Control Room, open a trip → Payment Rules: toggle Cash/UPI, set UPI ID/QR/link/amount/instructions per trip.
- [ ] **13. Custom domain `www.wandereroutdoors.in`** — in Vercel: Settings > Domains, add `www.wandereroutdoors.in`. In GoDaddy: add CNAME `www` → `cname.vercel-dns.com`. Optionally add A record `@` → `76.76.21.21` for apex redirect. Do NOT modify email MX/TXT records.
- [ ] **14. Google Search Console** — add the property, submit `sitemap.xml`, request indexing.
- [ ] **15. Backups** — keep the `…-BACKUP-…` folder safe; re-run both SQL files only once (they are idempotent).

---

## 🚫 Do NOT

- Do not paste the Supabase `service_role` key into any website file.
- Do not commit `.env` (it is git-ignored).
- Do not disable Row Level Security.
- Do not change DNS / domain settings until you are ready (it can affect email).
- Do not delete or overwrite the backup folder.
