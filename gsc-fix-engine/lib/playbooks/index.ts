import type { Playbook } from "@/lib/types";
import faqDuplicateField from "./faq-duplicate-field";
import sitemapInvalidUrl from "./sitemap-invalid-url";
import canonicalConflict from "./canonical-conflict";

/**
 * Playbook registry — keyed by normalized_code.
 */
const PLAYBOOK_REGISTRY: Record<string, Playbook> = {
  faq_duplicate_field: faqDuplicateField,
  sitemap_invalid_url: sitemapInvalidUrl,
  canonical_conflict: canonicalConflict,
};

export function getPlaybook(normalizedCode: string): Playbook | null {
  return PLAYBOOK_REGISTRY[normalizedCode] || null;
}

export function getAllPlaybooks(): Playbook[] {
  return Object.values(PLAYBOOK_REGISTRY);
}

export function getPlaybookSummaries() {
  return getAllPlaybooks().map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    issueFamily: p.issueFamily,
    normalizedCode: p.normalizedCode,
    scanTargets: p.scanTargets,
    diagnosisSteps: p.diagnosisSteps,
    fixStrategy: p.fixStrategy,
    validationChecklist: p.validationChecklist,
  }));
}
