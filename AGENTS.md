<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# TC Desk

Customer-service ticketing desk for Living Well with Dr. Michelle (multi-brand:
Longer Together next). Forked from TC Boards but a **separate production** — do
NOT share its database, Vercel project, or sending identity with TC Boards.

Source of truth for the build: `BUILD-SPEC.md` in
`Living Well with Dr. Michelle Claude/workflows/customer-service-system/`.

Safety-critical rule: `Message` = customer-visible email. `Comment` = internal
note that is NEVER emailed to the customer. Keep them visually unmistakable in
the UI (internal notes are amber with a lock).

Compliance: health-product brand. Templated content and the (Phase E) AI bot use
cosmetic/structure-function language only — never diagnose/treat/cure/prevent.
