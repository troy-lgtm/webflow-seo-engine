# Publish Operator Guide

## Commands

### Dry Run (safe — no pages published, no emails sent)
```
npm run publish:text-batch -- --count=5 --dry-run
```

### Live Batch of 5
```
npm run publish:text-batch -- --count=5 --live --notify=troy@wearewarp.com
```

### Prove Last Run
```
npm run publish:prove:last
npm run publish:prove:last -- --json
npm run publish:prove:last -- --run=RUN_ID
```

### Cleanup Old Artifacts
```
npm run publish:cleanup
npm run publish:cleanup -- --confirm --days=30 --keep=5
```

## What Counts as verified_live

A page is verified_live only when ALL of these pass:
1. HTTP GET returns 200
2. At least one identity signal matches:
   - Canonical URL tag matches expected path (high confidence)
   - Page title contains expected city names (high confidence)
   - Body text contains slug words (medium confidence)

A page at "low" confidence (HTTP 200 only, no identity match) stays published_unverified.

Verification uses exponential backoff: 10s → 20s → 40s → 80s.
A page only becomes published_unverified after ALL retry attempts fail.

## What Happens When Email Fails

1. Receipt JSON is always saved to `artifacts/publish-receipts/`
2. Receipt HTML is always saved alongside the JSON as a fallback
3. The manifest records the exact failure reason
4. Console output prints the fallback receipt path prominently
5. The publish itself is NOT affected — pages are still live

Email failure does NOT mean publish failure.

## CDN Propagation Delays

If pages show as published_unverified:
1. Run `npm run publish:prove:last` — it re-verifies with retry
2. Check the retry history in the receipt
3. If pages are still unverified after 150s of retries, check Webflow dashboard
4. Most CDN propagation resolves within 60 seconds

## Flow

```
dry run → review artifacts → live batch of 5 → verify URLs → receipt → email → prove
```

Every step writes an immutable artifact. Nothing is lost.
