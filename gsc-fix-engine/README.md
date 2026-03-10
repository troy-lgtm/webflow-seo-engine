# GSC Fix Engine

Automated incident detection and remediation engine for **wearewarp.com**.

Ingests Google Search Console alert emails, classifies issues, runs diagnosis playbooks, scans affected pages, and generates patch workflows.

## Why Warp Needs This

Google Search Console sends email alerts when it detects issues — duplicate FAQ structured data, sitemap errors, canonical conflicts. These alerts require immediate investigation, diagnosis, and often code changes across the web repo.

**The problem:** Manual triage is slow. Engineers need to read the email, figure out what changed, scan the site, write a fix, and test it. This takes hours.

**The fix:** GSC Fix Engine automates the entire pipeline: email → classification → playbook → scan → diagnosis → patch prompt. What took hours now takes seconds.

We cannot make Google update instantly. We can make Warp detect and react instantly.

## How It Works

```
Gmail Alert Email
       ↓
  POST /api/ingest-email (raw .eml or JSON)
       ↓
  Parse email (mailparser)
       ↓
  Classify issue (rule-based normalizer)
       ↓
  Match playbook (faq_duplicate_field, sitemap_invalid_url, canonical_conflict)
       ↓
  Run scan (fetch pages, extract JSON-LD, find issues)
       ↓
  Generate diagnosis + remediation report
       ↓
  Generate Claude Code patch prompt
       ↓
  Persist incident (SQLite/Prisma)
       ↓
  View in dashboard (localhost:3100)
```

## Quick Start

```bash
# Install
npm install

# Set up database
npx prisma db push

# Seed sample data
npx tsx lib/fixtures/seed.ts

# Start dev server
npm run dev
```

Open http://localhost:3100

## Ingest a Sample Email

```bash
# From the project root:
curl -s -X POST http://localhost:3100/api/ingest-email \
  -H 'Content-Type: text/plain' \
  -d @public/sample-gsc-faq-email.eml
```

Or send JSON:

```bash
curl -s -X POST http://localhost:3100/api/ingest-email \
  -H 'Content-Type: application/json' \
  -d '{
    "subject": "New FAQ structured data issues detected for wearewarp.com",
    "from": "sc-noreply@google.com",
    "bodyText": "Duplicate field FAQPage detected on https://www.wearewarp.com/lanes/los-angeles-to-dallas"
  }'
```

## View Incidents

- **Dashboard:** http://localhost:3100
- **API:** `GET http://localhost:3100/api/incidents`
- **Single incident:** `GET http://localhost:3100/api/incidents/{id}`
- **Incident detail page:** http://localhost:3100/incidents/{id}

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ingest-email` | Ingest raw .eml or JSON email |
| GET | `/api/incidents` | List all incidents with stats |
| GET | `/api/incidents/[id]` | Get single incident |
| POST | `/api/scan` | Run a playbook scan |
| GET | `/api/playbooks` | List available playbooks |
| POST | `/api/replay` | Re-run diagnosis for an incident |

## Playbooks

Playbooks are remediation recipes keyed by `normalized_code`:

| Code | Playbook | Description |
|------|----------|-------------|
| `faq_duplicate_field` | FAQ Duplicate Field | Detects multiple FAQPage JSON-LD on same page |
| `sitemap_invalid_url` | Sitemap Invalid URL | Detects stale/broken URLs in sitemap |
| `canonical_conflict` | Canonical Conflict | Detects missing/mismatched canonical elements |

### Extending Playbooks

Create a new file in `lib/playbooks/`:

```typescript
import type { Playbook } from "@/lib/types";

const myPlaybook: Playbook = {
  id: "my_issue_code",
  title: "My Issue",
  description: "...",
  issueFamily: "structured_data",
  normalizedCode: "my_issue_code",
  scanTargets: ["/some/page"],
  diagnosisSteps: ["Step 1", "Step 2"],
  fixStrategy: ["Fix 1", "Fix 2"],
  validationChecklist: ["Check 1"],
  async run(urls) {
    // Your scan logic
  },
};

export default myPlaybook;
```

Then register it in `lib/playbooks/index.ts`.

## Future Integration Roadmap

| Integration | Status | Description |
|-------------|--------|-------------|
| Gmail Watch webhook | Planned | Auto-ingest emails via Pub/Sub |
| Google URL Inspection API | Planned | Enrich incidents with indexing status |
| GitHub PR creation | Planned | Auto-create fix PRs from patch prompts |
| Slack alerting | Planned | Notify team on new incidents |
| Claude API | Planned | Auto-execute patch prompts |

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- SQLite + Prisma
- Zod validation
- mailparser (email parsing)
- cheerio (HTML/JSON-LD extraction)

## Scripts

```bash
npm run dev        # Start dev server on :3100
npm run build      # Production build
npm run start      # Start production server
npm run db:push    # Push Prisma schema to SQLite
npm run db:seed    # Seed sample incidents
npm run db:reset   # Reset and re-seed database
```
