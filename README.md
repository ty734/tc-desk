# TC Desk — customer support desk

In-house customer-service ticketing desk + (Phase E) AI chat widget for Living Well
with Dr. Michelle, built multi-brand from day one (Longer Together Pet Company next).
Replaces the support spreadsheet and LiveChat.

Forked from the TC Boards kanban app as a **separate production**: own repo, own
Vercel project, own Neon database (`tc_desk`), own sending identity. Nothing is
shared with TC Boards.

Full build spec: `Living Well with Dr. Michelle Claude/workflows/customer-service-system/BUILD-SPEC.md`.

## Core model

- **Inbox** = a brand (support address, sending identity, Shopify store, bot KB).
  One board per inbox. Adding a brand is a data change (new Inbox row), not code.
- **Ticket** = a customer conversation. Status columns: New → Open → Pending → Solved → Closed
  (`Ticket.status` mirrors the column for querying). Tags: Channel / Priority / Topic.
- **Message** = customer-visible email (inbound + outbound, threading headers). Phase B/C.
- **Comment** = INTERNAL note, never emailed to the customer. The UI styles these
  amber with a lock so they can't be confused with replies. This split is safety-critical.
- **KbChunk** = per-inbox knowledge base for the AI widget (pgvector). Phase E.

## Run locally

```bash
npm install
npx prisma migrate dev   # against the tc_desk Neon DB (.env)
npm run seed             # Living Well inbox + support board (idempotent)
npm run dev              # http://localhost:3000
```

First visit with an empty user table goes to `/register` and creates the admin
account. After that, registration is invite-only (invite from the board header).
Every registered agent automatically joins all inbox boards.

## Env vars

```
DATABASE_URL=            # Neon pooled URL, database tc_desk
DIRECT_URL=              # Neon direct URL (migrations)
AGENT_SECRET=            # bearer token for the JSON API (Claude sessions)
AGENT_USER_EMAIL=        # which user the agent acts as
APP_URL=                 # https://desk.livingwellwithdrmichelle.com
RESEND_API_KEY=          # internal agent notifications (optional in dev)
EMAIL_FROM=              # e.g. TC Desk <desk@...> (internal notifications only)
# Phase B+: EMAIL_PROVIDER, POSTMARK_SERVER_TOKEN, POSTMARK_INBOUND_SECRET,
#           INBOUND_DOMAIN, BLOB_READ_WRITE_TOKEN
# Phase E:  ANTHROPIC_API_KEY
```

Per-brand values (support address, from-name, sending domain, Shopify creds) live
on the `Inbox` row — never in global env.

## Build phases (spec §11)

- **A — Scaffold** (this) : fork, schema, seed, deploy
- **B — Inbound:** Postmark webhook → tickets/messages, Amazon detection, attachments → Vercel Blob
- **C — Outbound:** reply route with RFC threading, internal-notes split, canned replies
- **D — Shopify sidebar:** read-only order lookup per inbox
- **E — AI chat widget:** RAG over KbChunk + compliance guardrails + human handoff
- **F — Polish:** search, views, reporting

## Structure

- `prisma/schema.prisma` — Inbox, Ticket, Message, Customer, Attachment, CannedReply, KbChunk + boards/auth
- `prisma/seed.ts` — Living Well inbox + board seeder (re-runnable)
- `src/app/api/*` — REST route handlers (session cookie auth + AGENT_SECRET bearer)
- `src/components/BoardView.tsx` — the ticket board (dnd-kit drag & drop)
- `src/components/TicketModal.tsx` — ticket details, tags, internal notes
- `src/lib/mailer.ts` — internal agent notifications (Resend; console fallback in dev)
