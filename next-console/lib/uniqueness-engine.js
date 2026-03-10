/**
 * Content uniqueness enforcement for SEO lane pages.
 * Detects thin/duplicate content across batches of generated pages
 * by comparing sections, sentences, n-grams, and full-page similarity.
 *
 * Uses Jaccard similarity, n-gram shingle overlap, SimHash with Hamming
 * distance, and variable-stripped boilerplate detection.
 */
import fs from "fs";
import path from "path";
import { stableHash } from "@/lib/hash";

// ---------------------------------------------------------------------------
// Stopwords (~175 common English stopwords)
// ---------------------------------------------------------------------------
export const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "to", "from", "for",
  "in", "on", "at", "by", "of", "and", "or", "but", "nor", "not", "so",
  "yet", "both", "either", "neither", "each", "every", "all", "any",
  "few", "more", "most", "other", "some", "such", "no", "only", "own",
  "same", "than", "too", "very", "just", "because", "as", "until",
  "while", "about", "between", "through", "during", "before", "after",
  "above", "below", "up", "down", "out", "off", "over", "under", "again",
  "further", "then", "once", "here", "there", "when", "where", "why",
  "how", "what", "which", "who", "whom", "this", "that", "these",
  "those", "am", "with", "into", "its", "it", "he", "she", "they",
  "them", "their", "we", "our", "your", "my", "me", "him", "her", "us",
  "i", "you", "if", "also", "back", "been", "being", "come", "came",
  "get", "go", "going", "gone", "got", "like", "make", "made", "much",
  "many", "new", "now", "old", "one", "two", "three", "way", "well",
  "even", "still", "give", "given", "take", "taken", "tell", "thing",
  "things", "think", "know", "known", "see", "seem", "want", "use",
  "used", "work", "world", "year", "years", "long", "look", "day",
  "days", "good", "great", "first", "last", "high", "right", "left",
  "big", "small", "part", "place", "case", "point", "fact", "need",
  "time", "times", "hand", "life", "man", "men", "woman", "women",
  "child", "children", "number", "people", "state", "states", "say",
  "said", "let", "keep", "end", "set", "put", "run", "show", "try",
  "ask", "turn", "move", "play", "live", "found", "help", "begin",
  "began", "able", "own", "however", "another", "around", "always",
  "never", "though", "although", "since", "whether", "within", "without",
  "upon", "against", "along", "among", "behind", "beside", "beyond",
  "despite", "toward", "towards", "across", "already", "almost",
  "enough", "quite", "rather", "really", "perhaps", "maybe", "often",
  "sometimes", "usually", "actually", "especially", "particularly"
]);

// ---------------------------------------------------------------------------
// Porter Stemmer (simplified)
// ---------------------------------------------------------------------------
/**
 * Simplified Porter stemmer for English.
 * Strips common suffixes to reduce words to approximate stems.
 * @param {string} word - Lowercase word to stem
 * @returns {string} Stemmed word
 */
export function porterStem(word) {
  if (!word || word.length < 3) return word;

  let w = word;

  // Step: -ies -> -i (but not single char remaining)
  if (w.endsWith("ies") && w.length > 4) {
    w = w.slice(0, -3) + "i";
  }
  // Step: -tion -> -t
  else if (w.endsWith("tion") && w.length > 5) {
    w = w.slice(0, -4) + "t";
  }
  // Step: -sion -> -s
  else if (w.endsWith("sion") && w.length > 5) {
    w = w.slice(0, -4) + "s";
  }
  // Step: -ness -> (remove)
  else if (w.endsWith("ness") && w.length > 5) {
    w = w.slice(0, -4);
  }
  // Step: -ment -> (remove)
  else if (w.endsWith("ment") && w.length > 5) {
    w = w.slice(0, -4);
  }
  // Step: -able -> (remove)
  else if (w.endsWith("able") && w.length > 5) {
    w = w.slice(0, -4);
  }
  // Step: -ible -> (remove)
  else if (w.endsWith("ible") && w.length > 5) {
    w = w.slice(0, -4);
  }
  // Step: -ive -> (remove)
  else if (w.endsWith("ive") && w.length > 5) {
    w = w.slice(0, -3);
  }
  // Step: -ous -> (remove)
  else if (w.endsWith("ous") && w.length > 5) {
    w = w.slice(0, -3);
  }
  // Step: -ing -> (remove, handle doubling)
  else if (w.endsWith("ing") && w.length > 5) {
    const stem = w.slice(0, -3);
    // Handle doubled consonant: running -> runn -> run
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] &&
        !"aeiou".includes(stem[stem.length - 1])) {
      w = stem.slice(0, -1);
    } else {
      w = stem;
    }
  }
  // Step: -ly -> (remove)
  else if (w.endsWith("ly") && w.length > 4) {
    w = w.slice(0, -2);
  }
  // Step: -er -> (remove)
  else if (w.endsWith("er") && w.length > 4) {
    const stem = w.slice(0, -2);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] &&
        !"aeiou".includes(stem[stem.length - 1])) {
      w = stem.slice(0, -1);
    } else {
      w = stem;
    }
  }
  // Step: -est -> (remove)
  else if (w.endsWith("est") && w.length > 5) {
    const stem = w.slice(0, -3);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] &&
        !"aeiou".includes(stem[stem.length - 1])) {
      w = stem.slice(0, -1);
    } else {
      w = stem;
    }
  }
  // Step: -ed -> (remove)
  else if (w.endsWith("ed") && w.length > 4) {
    const stem = w.slice(0, -2);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] &&
        !"aeiou".includes(stem[stem.length - 1])) {
      w = stem.slice(0, -1);
    } else {
      w = stem;
    }
  }
  // Step: -s (but not -ss, -us, -is)
  else if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") &&
           !w.endsWith("is") && w.length > 3) {
    w = w.slice(0, -1);
  }

  return w;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------
/**
 * Tokenize text into an array of stemmed, stopword-free tokens.
 * 1. Lowercase
 * 2. Remove punctuation (keep alphanumeric and spaces)
 * 3. Split on whitespace
 * 4. Filter stopwords
 * 5. Apply porterStem
 * 6. Filter words with length < 2
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const cleaned = lower.replace(/[^a-z0-9\s]/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  const filtered = words.filter((w) => !STOPWORDS.has(w));
  const stemmed = filtered.map((w) => porterStem(w));
  return stemmed.filter((w) => w.length >= 2);
}

// ---------------------------------------------------------------------------
// Variable stripping (template boilerplate detection)
// ---------------------------------------------------------------------------

// Common US city names (used for variable stripping, not exhaustive)
const CITY_NAMES = [
  "los angeles", "riverside", "san francisco", "san diego", "sacramento",
  "seattle", "portland", "phoenix", "tucson", "las vegas", "dallas",
  "houston", "san antonio", "austin", "el paso", "chicago", "indianapolis",
  "columbus", "detroit", "minneapolis", "kansas city", "st. louis",
  "st louis", "atlanta", "charlotte", "miami", "tampa", "jacksonville",
  "nashville", "orlando", "memphis", "new york", "newark", "philadelphia",
  "boston", "denver", "salt lake city", "albuquerque", "raleigh", "richmond",
  "pittsburgh", "cleveland", "cincinnati", "milwaukee", "omaha",
  "oklahoma city", "tulsa", "new orleans", "louisville", "baltimore",
  "washington", "buffalo", "hartford", "providence", "boise", "reno",
  "fresno", "bakersfield", "stockton", "modesto", "spokane", "tacoma",
  "virginia beach", "norfolk", "greensboro", "durham", "winston salem",
  "fort worth", "arlington", "corpus christi", "laredo", "lubbock",
  "chandler", "scottsdale", "glendale", "gilbert", "mesa", "tempe",
  "colorado springs", "aurora", "lakewood", "fort collins",
  "st. paul", "st paul", "des moines", "cedar rapids",
  "little rock", "birmingham", "montgomery", "huntsville",
  "savannah", "charleston", "columbia", "greenville", "knoxville",
  "chattanooga", "lexington", "dayton", "akron", "toledo",
  "grand rapids", "ann arbor", "lansing", "madison", "green bay",
  "wichita", "topeka", "lincoln", "sioux falls", "fargo",
  "billings", "bozeman", "missoula", "cheyenne", "anchorage",
  "honolulu"
];

// State names and abbreviations
const STATE_NAMES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
  "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york", "north carolina",
  "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas",
  "utah", "vermont", "virginia", "washington", "west virginia",
  "wisconsin", "wyoming"
];

const STATE_ABBREVS = [
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms",
  "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
  "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
  "wi", "wy"
];

// Build a sorted (longest-first) city pattern list for replacement
const _cityPatternsSorted = [...CITY_NAMES].sort((a, b) => b.length - a.length);

/**
 * Strip known variable content from text, replacing city names, modes,
 * dollar amounts, distances, transit times, and percentages with placeholders.
 * Used to measure boilerplate (template) vs unique content.
 * @param {string} text
 * @returns {string}
 */
export function stripVariables(text) {
  let stripped = String(text || "").toLowerCase();

  // Replace city names (longest first to avoid partial matches)
  for (const city of _cityPatternsSorted) {
    // Use word boundary-like matching: non-alpha before/after
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    stripped = stripped.replace(new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "g"), "{CITY}");
  }

  // Replace state names
  for (const st of STATE_NAMES) {
    const escaped = st.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    stripped = stripped.replace(new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "g"), "{CITY}");
  }

  // Replace state abbreviations (2-letter, typically after comma)
  for (const abbr of STATE_ABBREVS) {
    stripped = stripped.replace(new RegExp(`,\\s*${abbr}(?![a-z])`, "g"), ", {CITY}");
  }

  // Replace mode names
  stripped = stripped.replace(/\b(ltl|ftl|shared|truckload|full truckload|less than truckload)\b/g, "{MODE}");

  // Replace dollar amounts ($N,NNN or $N.NN patterns)
  stripped = stripped.replace(/\$[\d,]+(?:\.\d{1,2})?/g, "{AMOUNT}");

  // Replace mile/distance patterns (e.g., "1,234 miles", "~500-mile")
  stripped = stripped.replace(/~?[\d,]+(?:\.\d+)?[\s-]*(?:mile|miles|mi)\b/g, "{DISTANCE}");

  // Replace day ranges (e.g., "2-4 days", "3-5 business days")
  stripped = stripped.replace(/\d+[\s]*[-–][\s]*\d+\s*(?:business\s+)?days?/g, "{TRANSIT}");
  // Single day references (e.g., "within 3 days")
  stripped = stripped.replace(/\d+\s*(?:business\s+)?days?\b/g, "{TRANSIT}");

  // Replace percentage patterns (e.g., "40%", "22.5%")
  stripped = stripped.replace(/[\d.]+\s*%/g, "{PCT}");

  return stripped;
}

// ---------------------------------------------------------------------------
// Similarity functions
// ---------------------------------------------------------------------------

/**
 * Compute Jaccard similarity between two texts.
 * |intersection(tokens)| / |union(tokens)|
 * @param {string} textA
 * @param {string} textB
 * @returns {number} 0.0 - 1.0
 */
export function jaccardSimilarity(textA, textB) {
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));
  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersectionSize = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersectionSize++;
  }
  const unionSize = tokensA.size + tokensB.size - intersectionSize;
  return unionSize === 0 ? 0.0 : intersectionSize / unionSize;
}

/**
 * Generate word-level n-grams (shingles) from text.
 * @param {string} text
 * @param {number} n - shingle size
 * @returns {Set<string>}
 */
function generateShingles(text, n) {
  const tokens = tokenize(text);
  const shingles = new Set();
  for (let i = 0; i <= tokens.length - n; i++) {
    shingles.add(tokens.slice(i, i + n).join(" "));
  }
  return shingles;
}

/**
 * Compute shingle (n-gram) overlap between two texts.
 * |intersection(shingles)| / |union(shingles)|
 * @param {string} textA
 * @param {string} textB
 * @param {number} n - shingle size (default 4)
 * @returns {number} 0.0 - 1.0
 */
export function shingleOverlap(textA, textB, n = 4) {
  const shinglesA = generateShingles(textA, n);
  const shinglesB = generateShingles(textB, n);
  if (shinglesA.size === 0 && shinglesB.size === 0) return 1.0;
  if (shinglesA.size === 0 || shinglesB.size === 0) return 0.0;

  let intersectionSize = 0;
  for (const s of shinglesA) {
    if (shinglesB.has(s)) intersectionSize++;
  }
  const unionSize = shinglesA.size + shinglesB.size - intersectionSize;
  return unionSize === 0 ? 0.0 : intersectionSize / unionSize;
}

/**
 * Compute a 32-bit SimHash fingerprint for a text.
 * Uses stableHash from @/lib/hash for per-feature hashing.
 * @param {string} text
 * @returns {number} 32-bit integer
 */
export function simhash(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;

  // Accumulator for 32 bit positions
  const v = new Int32Array(32);

  for (const token of tokens) {
    const hash = stableHash(token);
    for (let i = 0; i < 32; i++) {
      if ((hash >>> i) & 1) {
        v[i] += 1;
      } else {
        v[i] -= 1;
      }
    }
  }

  // Build final hash: bit i = 1 if v[i] > 0
  let fingerprint = 0;
  for (let i = 0; i < 32; i++) {
    if (v[i] > 0) {
      fingerprint |= (1 << i);
    }
  }
  return fingerprint >>> 0; // ensure unsigned 32-bit
}

/**
 * Hamming distance between two 32-bit hashes (count of differing bits).
 * @param {number} hashA
 * @param {number} hashB
 * @returns {number} 0 - 32
 */
export function hammingDistance(hashA, hashB) {
  let xor = (hashA ^ hashB) >>> 0;
  let count = 0;
  while (xor) {
    count += xor & 1;
    xor >>>= 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Section-level thresholds
// ---------------------------------------------------------------------------
export const SECTION_THRESHOLDS = {
  seo_title:        { maxSimilarity: 0.70, minUniqueTokens: 6,  maxReusedNgrams: 0.15, maxBoilerplatePct: 0.40 },
  meta_description: { maxSimilarity: 0.75, minUniqueTokens: 10, maxReusedNgrams: 0.20, maxBoilerplatePct: 0.45 },
  h1:               { maxSimilarity: 0.70, minUniqueTokens: 5,  maxReusedNgrams: 0.15, maxBoilerplatePct: 0.35 },
  intro:            { maxSimilarity: 0.65, minUniqueTokens: 15, maxReusedNgrams: 0.15, maxBoilerplatePct: 0.35 },
  faq:              { maxSimilarity: 0.50, minUniqueTokens: 20, maxReusedNgrams: 0.10, maxBoilerplatePct: 0.30 },
};

// Rule ID mapping per section
const SECTION_RULE_IDS = {
  seo_title:        "UN-TITLE-01",
  meta_description: "UN-META-01",
  h1:               "UN-H1-01",
  intro:            "UN-INTRO-01",
  faq:              "UN-FAQ-01",
};

/**
 * Extract text content for a section key from a page object.
 * Handles FAQ arrays by joining Q+A text.
 * @param {object} page
 * @param {string} sectionKey
 * @returns {string}
 */
function extractSectionText(page, sectionKey) {
  if (!page) return "";
  if (sectionKey === "faq") {
    const faqs = page.faq || [];
    return faqs.map((f) => `${f.q || ""} ${f.a || ""}`).join(" ");
  }
  return String(page[sectionKey] || "");
}

/**
 * Compute boilerplate percentage: similarity of variable-stripped texts.
 * High value = mostly template boilerplate, low unique content.
 * @param {string} textA
 * @param {string} textB
 * @returns {number} 0.0 - 1.0
 */
function boilerplatePct(textA, textB) {
  const strippedA = stripVariables(textA);
  const strippedB = stripVariables(textB);
  return jaccardSimilarity(strippedA, strippedB);
}

/**
 * Count unique tokens in a text that do not appear in a reference set.
 * @param {string} text
 * @param {Set<string>} referenceTokens
 * @returns {number}
 */
function countUniqueTokens(text, referenceTokens) {
  const tokens = tokenize(text);
  let unique = 0;
  for (const t of tokens) {
    if (!referenceTokens.has(t)) unique++;
  }
  return unique;
}

/**
 * Check uniqueness of a specific section across all pages.
 * Compares every pair and flags violations against SECTION_THRESHOLDS.
 * @param {object[]} pages - Array of page objects
 * @param {string} sectionKey - Key in SECTION_THRESHOLDS
 * @param {object} [config] - Optional override thresholds
 * @returns {{ violations: object[] }}
 */
export function checkSectionUniqueness(pages, sectionKey, config) {
  const thresholds = config || SECTION_THRESHOLDS[sectionKey];
  if (!thresholds) return { violations: [] };

  const ruleId = SECTION_RULE_IDS[sectionKey] || `UN-${sectionKey.toUpperCase()}-01`;
  const violations = [];

  // Pre-extract section text and tokens for all pages
  const texts = pages.map((p) => extractSectionText(p, sectionKey));
  const tokenSets = texts.map((t) => new Set(tokenize(t)));

  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const textA = texts[i];
      const textB = texts[j];
      if (!textA || !textB) continue;

      const slugA = pages[i].slug || `page-${i}`;
      const slugB = pages[j].slug || `page-${j}`;

      // 1. Jaccard similarity
      const jaccard = jaccardSimilarity(textA, textB);
      if (jaccard > thresholds.maxSimilarity) {
        violations.push({
          rule_id: ruleId,
          page_slug: slugA,
          pair_slug: slugB,
          detail: `${sectionKey} Jaccard similarity ${(jaccard * 100).toFixed(1)}% exceeds max ${(thresholds.maxSimilarity * 100).toFixed(0)}%`,
          severity: jaccard > thresholds.maxSimilarity + 0.15 ? "block" : "warn",
          metric: "jaccard",
          value: jaccard,
        });
      }

      // 2. Shingle overlap (4-gram)
      const shingle = shingleOverlap(textA, textB, 4);
      if (shingle > thresholds.maxReusedNgrams) {
        violations.push({
          rule_id: ruleId,
          page_slug: slugA,
          pair_slug: slugB,
          detail: `${sectionKey} 4-gram overlap ${(shingle * 100).toFixed(1)}% exceeds max ${(thresholds.maxReusedNgrams * 100).toFixed(0)}%`,
          severity: shingle > thresholds.maxReusedNgrams + 0.15 ? "block" : "warn",
          metric: "shingle_overlap",
          value: shingle,
        });
      }

      // 3. Unique token count (tokens in A not in B and vice versa)
      const uniqueAvsB = countUniqueTokens(textA, tokenSets[j]);
      const uniqueBvsA = countUniqueTokens(textB, tokenSets[i]);
      const minUnique = Math.min(uniqueAvsB, uniqueBvsA);
      if (minUnique < thresholds.minUniqueTokens) {
        violations.push({
          rule_id: ruleId,
          page_slug: slugA,
          pair_slug: slugB,
          detail: `${sectionKey} only ${minUnique} unique tokens between pair (min ${thresholds.minUniqueTokens})`,
          severity: minUnique < Math.floor(thresholds.minUniqueTokens / 2) ? "block" : "warn",
          metric: "unique_tokens",
          value: minUnique,
        });
      }

      // 4. Boilerplate percentage
      const bp = boilerplatePct(textA, textB);
      if (bp > thresholds.maxBoilerplatePct) {
        violations.push({
          rule_id: ruleId,
          page_slug: slugA,
          pair_slug: slugB,
          detail: `${sectionKey} boilerplate ${(bp * 100).toFixed(1)}% exceeds max ${(thresholds.maxBoilerplatePct * 100).toFixed(0)}%`,
          severity: bp > thresholds.maxBoilerplatePct + 0.15 ? "block" : "warn",
          metric: "boilerplate_pct",
          value: bp,
        });
      }
    }
  }

  return { violations };
}

// ---------------------------------------------------------------------------
// Global commonness check
// ---------------------------------------------------------------------------

/**
 * Split text into sentences (on . ! ? followed by space or end-of-string).
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  if (!text) return [];
  // Split on sentence-ending punctuation followed by space or end
  return String(text)
    .split(/(?<=[.!?])(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalize a sentence for comparison: tokenize and rejoin.
 * @param {string} sentence
 * @returns {string}
 */
function normalizeSentence(sentence) {
  return tokenize(sentence).join(" ");
}

/**
 * Check for globally common sentences and FAQ questions across all pages.
 *
 * Flags:
 * - UN-COMMON-01: Sentence appears on > 5% of pages
 * - UN-COMMON-02: FAQ question appears on > 3% of pages
 *
 * @param {object[]} pages - Current batch of page objects
 * @param {object[]} publishedPages - Previously published pages for cross-check
 * @returns {{ violations: object[], sentenceCounts: Map, faqCounts: Map }}
 */
export function checkGlobalCommonness(pages, publishedPages = []) {
  const allPages = [...pages, ...publishedPages];
  const totalPages = allPages.length;
  if (totalPages < 2) return { violations: [], sentenceCounts: new Map(), faqCounts: new Map() };

  const sentenceCounts = new Map(); // normalized sentence -> Set of page slugs
  const faqCounts = new Map();      // normalized FAQ question -> Set of page slugs

  const sentenceThresholdPct = 0.05; // 5%
  const faqThresholdPct = 0.03;      // 3%

  // Collect all text sections per page
  const textSections = ["seo_title", "meta_description", "h1", "intro", "proof_section",
                        "problem_section", "solution_section", "executive_summary"];

  for (const page of allPages) {
    const slug = page.slug || page.canonical_path || "unknown";

    // 1. Extract and split sentences from all text sections
    const pageText = textSections.map((key) => String(page[key] || "")).join(". ");
    // Also include FAQ answers
    if (page.faq) {
      for (const f of page.faq) {
        if (f.a) {
          const faqSentences = splitSentences(f.a);
          for (const sent of faqSentences) {
            const words = sent.split(/\s+/);
            if (words.length <= 8) continue;
            const norm = normalizeSentence(sent);
            if (!norm) continue;
            if (!sentenceCounts.has(norm)) sentenceCounts.set(norm, new Set());
            sentenceCounts.get(norm).add(slug);
          }
        }
      }
    }

    const sentences = splitSentences(pageText);
    for (const sent of sentences) {
      const words = sent.split(/\s+/);
      if (words.length <= 8) continue; // skip short sentences
      const norm = normalizeSentence(sent);
      if (!norm) continue;
      if (!sentenceCounts.has(norm)) sentenceCounts.set(norm, new Set());
      sentenceCounts.get(norm).add(slug);
    }

    // 2. Extract FAQ questions
    if (page.faq) {
      for (const f of page.faq) {
        if (!f.q) continue;
        const norm = normalizeSentence(f.q);
        if (!norm) continue;
        if (!faqCounts.has(norm)) faqCounts.set(norm, new Set());
        faqCounts.get(norm).add(slug);
      }
    }
  }

  const violations = [];
  const sentenceMinPages = Math.max(2, Math.ceil(totalPages * sentenceThresholdPct));
  const faqMinPages = Math.max(2, Math.ceil(totalPages * faqThresholdPct));

  // Flag over-used sentences
  for (const [norm, slugSet] of sentenceCounts.entries()) {
    if (slugSet.size >= sentenceMinPages) {
      const pct = (slugSet.size / totalPages * 100).toFixed(1);
      const affectedSlugs = [...slugSet].slice(0, 10);
      violations.push({
        rule_id: "UN-COMMON-01",
        page_slug: affectedSlugs[0],
        pair_slug: affectedSlugs.length > 1 ? affectedSlugs[1] : null,
        detail: `Sentence appears on ${slugSet.size} pages (${pct}%, cap 5%): "${norm.slice(0, 80)}..."`,
        severity: slugSet.size >= sentenceMinPages * 2 ? "block" : "warn",
        metric: "sentence_commonness",
        value: slugSet.size / totalPages,
        affected_pages: affectedSlugs,
      });
    }
  }

  // Flag over-used FAQ questions
  for (const [norm, slugSet] of faqCounts.entries()) {
    if (slugSet.size >= faqMinPages) {
      const pct = (slugSet.size / totalPages * 100).toFixed(1);
      const affectedSlugs = [...slugSet].slice(0, 10);
      violations.push({
        rule_id: "UN-COMMON-02",
        page_slug: affectedSlugs[0],
        pair_slug: affectedSlugs.length > 1 ? affectedSlugs[1] : null,
        detail: `FAQ question appears on ${slugSet.size} pages (${pct}%, cap 3%): "${norm.slice(0, 80)}..."`,
        severity: slugSet.size >= faqMinPages * 2 ? "block" : "warn",
        metric: "faq_commonness",
        value: slugSet.size / totalPages,
        affected_pages: affectedSlugs,
      });
    }
  }

  return { violations, sentenceCounts, faqCounts };
}

// ---------------------------------------------------------------------------
// Page-level similarity
// ---------------------------------------------------------------------------

/**
 * Concatenate key sections of a page into a single text block for comparison.
 * @param {object} page
 * @returns {string}
 */
function concatenatePageText(page) {
  const parts = [
    page.seo_title || "",
    page.h1 || "",
    page.intro || "",
    page.proof_section || "",
  ];
  if (page.faq) {
    for (const f of page.faq) {
      parts.push(f.q || "");
      parts.push(f.a || "");
    }
  }
  return parts.join(" ");
}

/**
 * Check page-level similarity across all pages using SimHash for fast
 * first-pass filtering and Jaccard for precise measurement.
 *
 * Flags pairs with Jaccard > 0.6 after variable stripping.
 *
 * @param {object[]} pages
 * @param {number} topN - Maximum number of similar pairs to return (default 20)
 * @returns {{ violations: object[], similarPairs: object[] }}
 */
export function checkPageLevelSimilarity(pages, topN = 20) {
  const violations = [];
  const similarPairs = [];

  if (pages.length < 2) return { violations, similarPairs };

  // Pre-compute concatenated + stripped text and simhash for every page
  const pageData = pages.map((p) => {
    const raw = concatenatePageText(p);
    const stripped = stripVariables(raw);
    const hash = simhash(stripped);
    return { slug: p.slug || "unknown", stripped, hash };
  });

  // All-pairs comparison with simhash pre-filter
  for (let i = 0; i < pageData.length; i++) {
    for (let j = i + 1; j < pageData.length; j++) {
      // SimHash first-pass filter: skip pairs with hamming distance >= 10
      const hd = hammingDistance(pageData[i].hash, pageData[j].hash);
      if (hd >= 10) continue;

      // Precise Jaccard on stripped text
      const jaccard = jaccardSimilarity(pageData[i].stripped, pageData[j].stripped);
      if (jaccard > 0.6) {
        similarPairs.push({
          slugA: pageData[i].slug,
          slugB: pageData[j].slug,
          jaccard,
          hammingDistance: hd,
        });
      }
    }
  }

  // Sort by similarity descending and take top N
  similarPairs.sort((a, b) => b.jaccard - a.jaccard);
  const topPairs = similarPairs.slice(0, topN);

  // Convert to violations
  for (const pair of topPairs) {
    violations.push({
      rule_id: "UN-PAGE-01",
      page_slug: pair.slugA,
      pair_slug: pair.slugB,
      detail: `Page-level similarity ${(pair.jaccard * 100).toFixed(1)}% (hamming ${pair.hammingDistance}) exceeds 60% threshold`,
      severity: pair.jaccard > 0.8 ? "block" : "warn",
      metric: "page_jaccard",
      value: pair.jaccard,
    });
  }

  return { violations, similarPairs: topPairs };
}

// ---------------------------------------------------------------------------
// Additional checks: headings, 8-gram overlap, noise detection
// ---------------------------------------------------------------------------

/**
 * Check for H2 heading reuse across pages (rule UN-H2-01).
 * Flags headings appearing on > 5% of pages.
 * @param {object[]} pages
 * @returns {object[]} violations
 */
function checkHeadingReuse(pages) {
  const violations = [];
  const totalPages = pages.length;
  if (totalPages < 2) return violations;

  // Collect headings from sections that commonly contain h2-level text
  // The h1 is already checked by section check; here we check sub-headings
  // from FAQ questions and visual card labels as proxy for H2s
  const headingCounts = new Map(); // normalized heading -> Set of slugs

  for (const page of pages) {
    const slug = page.slug || "unknown";
    const headings = [];

    // FAQ questions as h2-level headings
    if (page.faq) {
      for (const f of page.faq) {
        if (f.q) headings.push(f.q);
      }
    }
    // Visual card labels
    if (page.visual_cards) {
      for (const card of page.visual_cards) {
        if (card.label) headings.push(card.label);
        if (card.value) headings.push(card.value);
      }
    }

    for (const h of headings) {
      const norm = normalizeSentence(h);
      if (!norm) continue;
      if (!headingCounts.has(norm)) headingCounts.set(norm, new Set());
      headingCounts.get(norm).add(slug);
    }
  }

  const threshold = Math.max(2, Math.ceil(totalPages * 0.05));
  for (const [norm, slugSet] of headingCounts.entries()) {
    if (slugSet.size >= threshold) {
      const pct = (slugSet.size / totalPages * 100).toFixed(1);
      violations.push({
        rule_id: "UN-H2-01",
        page_slug: [...slugSet][0],
        pair_slug: [...slugSet].length > 1 ? [...slugSet][1] : null,
        detail: `Heading appears on ${slugSet.size} pages (${pct}%, cap 5%): "${norm.slice(0, 60)}..."`,
        severity: slugSet.size >= threshold * 2 ? "block" : "warn",
        metric: "heading_reuse",
        value: slugSet.size / totalPages,
      });
    }
  }

  return violations;
}

/**
 * Check for 8-gram overlap between pages (rule UN-SHINGLES-01).
 * Any shared 8-gram block across distinct pages is flagged.
 * @param {object[]} pages
 * @returns {object[]} violations
 */
function checkLongShingleOverlap(pages) {
  const violations = [];
  if (pages.length < 2) return violations;

  // Build 8-gram index: shingle -> Set of page indices
  const shingleIndex = new Map();
  const pageTexts = pages.map((p) => concatenatePageText(p));

  for (let i = 0; i < pages.length; i++) {
    const shingles = generateShingles(pageTexts[i], 8);
    for (const s of shingles) {
      if (!shingleIndex.has(s)) shingleIndex.set(s, new Set());
      shingleIndex.get(s).add(i);
    }
  }

  // Find shared 8-grams and group by page pair
  const pairOverlaps = new Map(); // "i|j" -> count of shared 8-grams
  const pairTotals = new Map();   // "i|j" -> union size

  for (let i = 0; i < pages.length; i++) {
    const shinglesI = generateShingles(pageTexts[i], 8);
    for (let j = i + 1; j < pages.length; j++) {
      const shinglesJ = generateShingles(pageTexts[j], 8);
      if (shinglesI.size === 0 || shinglesJ.size === 0) continue;

      let shared = 0;
      for (const s of shinglesI) {
        if (shinglesJ.has(s)) shared++;
      }
      const union = shinglesI.size + shinglesJ.size - shared;
      const overlapRatio = union === 0 ? 0 : shared / union;

      if (overlapRatio > 0.05) {
        const slugA = pages[i].slug || `page-${i}`;
        const slugB = pages[j].slug || `page-${j}`;
        violations.push({
          rule_id: "UN-SHINGLES-01",
          page_slug: slugA,
          pair_slug: slugB,
          detail: `8-gram overlap ${(overlapRatio * 100).toFixed(1)}% (${shared} shared blocks) exceeds 5% cap`,
          severity: overlapRatio > 0.15 ? "block" : "warn",
          metric: "shingle_8gram",
          value: overlapRatio,
        });
      }
    }
  }

  return violations;
}

/**
 * Detect noise padding: pages that add random adjectives without factual
 * differentiation (rule UN-NOISE-01) or use synonym swapping to fake
 * uniqueness (rule UN-NOISE-02).
 *
 * Heuristic: if variable-stripped text has HIGH similarity but raw text has
 * LOWER similarity, it suggests superficial word changes without real
 * content differentiation.
 * @param {object[]} pages
 * @returns {object[]} violations
 */
function checkNoisePadding(pages) {
  const violations = [];
  if (pages.length < 2) return violations;

  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const rawA = concatenatePageText(pages[i]);
      const rawB = concatenatePageText(pages[j]);
      const strippedA = stripVariables(rawA);
      const strippedB = stripVariables(rawB);

      const rawJaccard = jaccardSimilarity(rawA, rawB);
      const strippedJaccard = jaccardSimilarity(strippedA, strippedB);

      // If stripped similarity is very high but raw is moderately lower,
      // it could indicate synonym swapping without real differentiation
      const gap = strippedJaccard - rawJaccard;

      const slugA = pages[i].slug || `page-${i}`;
      const slugB = pages[j].slug || `page-${j}`;

      // Noise detection: stripped very similar (> 0.75) with small gap
      // means the "uniqueness" is just variable substitution
      if (strippedJaccard > 0.75 && gap < 0.10) {
        violations.push({
          rule_id: "UN-NOISE-01",
          page_slug: slugA,
          pair_slug: slugB,
          detail: `Potential adjective padding: stripped similarity ${(strippedJaccard * 100).toFixed(1)}% with only ${(gap * 100).toFixed(1)}% differentiation from raw text`,
          severity: strippedJaccard > 0.85 ? "block" : "warn",
          metric: "noise_padding",
          value: strippedJaccard,
        });
      }

      // Synonym swapping: raw similarity moderately lower than stripped,
      // but the shingle overlap of stripped text is still very high
      if (strippedJaccard > 0.70 && gap > 0.10 && gap < 0.30) {
        const strippedShingle = shingleOverlap(strippedA, strippedB, 4);
        if (strippedShingle > 0.50) {
          violations.push({
            rule_id: "UN-NOISE-02",
            page_slug: slugA,
            pair_slug: slugB,
            detail: `Potential synonym swapping: stripped 4-gram overlap ${(strippedShingle * 100).toFixed(1)}% despite ${(gap * 100).toFixed(1)}% raw/stripped gap`,
            severity: strippedShingle > 0.65 ? "block" : "warn",
            metric: "synonym_swap",
            value: strippedShingle,
          });
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full uniqueness check suite across a batch of pages.
 *
 * Checks:
 * 1. Section-level uniqueness (title, meta, h1, intro, faq)
 * 2. Global sentence and FAQ question commonness
 * 3. Page-level similarity (SimHash + Jaccard)
 * 4. Heading reuse (UN-H2-01)
 * 5. Long shingle overlap (UN-SHINGLES-01)
 * 6. Noise/padding detection (UN-NOISE-01, UN-NOISE-02)
 *
 * @param {object[]} pages - Array of page objects from lane-engine
 * @param {object[]} publishedPages - Previously published pages
 * @param {object} options - Optional overrides: { topN, sectionThresholds }
 * @returns {{ pass: boolean, violations: object[], summary: object }}
 */
export function runUniquenessCheck(pages, publishedPages = [], options = {}) {
  const topN = options.topN || 20;
  const allViolations = [];
  let sectionsChecked = 0;
  let pairsChecked = 0;

  // 1. Section-level uniqueness
  for (const sectionKey of Object.keys(SECTION_THRESHOLDS)) {
    const thresholds = options.sectionThresholds?.[sectionKey] || SECTION_THRESHOLDS[sectionKey];
    const result = checkSectionUniqueness(pages, sectionKey, thresholds);
    allViolations.push(...result.violations);
    sectionsChecked++;
  }

  // 2. Global commonness (includes published pages for cross-reference)
  const commonResult = checkGlobalCommonness(pages, publishedPages);
  allViolations.push(...commonResult.violations);

  // 3. Page-level similarity
  const pageSimilarity = checkPageLevelSimilarity(pages, topN);
  allViolations.push(...pageSimilarity.violations);
  pairsChecked = pageSimilarity.similarPairs.length;

  // 4. Heading reuse
  const headingViolations = checkHeadingReuse(pages);
  allViolations.push(...headingViolations);

  // 5. Long shingle overlap
  const shingleViolations = checkLongShingleOverlap(pages);
  allViolations.push(...shingleViolations);

  // 6. Noise padding detection
  const noiseViolations = checkNoisePadding(pages);
  allViolations.push(...noiseViolations);

  // Determine pass/fail: fail if any violation has severity "block"
  const hasBlock = allViolations.some((v) => v.severity === "block");

  // Count by severity
  const blockCount = allViolations.filter((v) => v.severity === "block").length;
  const warnCount = allViolations.filter((v) => v.severity === "warn").length;

  // Count by rule
  const ruleCounts = {};
  for (const v of allViolations) {
    ruleCounts[v.rule_id] = (ruleCounts[v.rule_id] || 0) + 1;
  }

  const totalPossiblePairs = (pages.length * (pages.length - 1)) / 2;

  return {
    pass: !hasBlock,
    violations: allViolations,
    summary: {
      totalPages: pages.length,
      publishedPages: publishedPages.length,
      sectionsChecked,
      pairsChecked: totalPossiblePairs,
      similarPairsFound: pairsChecked,
      totalViolations: allViolations.length,
      blockCount,
      warnCount,
      ruleCounts,
    },
  };
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

/**
 * Write uniqueness report artifacts: JSON data file and human-readable markdown.
 * @param {object} report - Output from runUniquenessCheck
 * @param {string} outputDir - Directory to write reports into
 */
export function writeUniquenessReport(report, outputDir) {
  const artifactsDir = path.join(outputDir, "artifacts");

  // Ensure directory exists
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // 1. Write JSON report
  const jsonPath = path.join(artifactsDir, "uniqueness_report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  // 2. Write Markdown report
  const mdPath = path.join(artifactsDir, "uniqueness_report.md");
  const md = buildMarkdownReport(report);
  fs.writeFileSync(mdPath, md, "utf-8");

  return { jsonPath, mdPath };
}

/**
 * Build a human-readable markdown report from uniqueness check results.
 * @param {object} report
 * @returns {string}
 */
function buildMarkdownReport(report) {
  const lines = [];
  const s = report.summary;
  const passLabel = report.pass ? "PASS" : "FAIL";

  lines.push("# Uniqueness Report");
  lines.push("");
  lines.push(`**Result:** ${passLabel}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Pages checked | ${s.totalPages} |`);
  lines.push(`| Published pages (cross-ref) | ${s.publishedPages} |`);
  lines.push(`| Sections checked | ${s.sectionsChecked} |`);
  lines.push(`| Page pairs evaluated | ${s.pairsChecked} |`);
  lines.push(`| Similar pairs found | ${s.similarPairsFound} |`);
  lines.push(`| Total violations | ${s.totalViolations} |`);
  lines.push(`| Blocking violations | ${s.blockCount} |`);
  lines.push(`| Warnings | ${s.warnCount} |`);
  lines.push("");

  if (Object.keys(s.ruleCounts).length > 0) {
    lines.push("## Violations by Rule");
    lines.push("");
    lines.push("| Rule ID | Count |");
    lines.push("|---------|-------|");
    for (const [rule, count] of Object.entries(s.ruleCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${rule} | ${count} |`);
    }
    lines.push("");
  }

  if (report.violations.length > 0) {
    lines.push("## Violation Details");
    lines.push("");

    // Group by severity
    const blocks = report.violations.filter((v) => v.severity === "block");
    const warns = report.violations.filter((v) => v.severity === "warn");

    if (blocks.length > 0) {
      lines.push("### Blocking");
      lines.push("");
      for (const v of blocks) {
        lines.push(`- **${v.rule_id}** \`${v.page_slug}\` vs \`${v.pair_slug || "N/A"}\`: ${v.detail}`);
      }
      lines.push("");
    }

    if (warns.length > 0) {
      lines.push("### Warnings");
      lines.push("");
      for (const v of warns.slice(0, 50)) {
        lines.push(`- **${v.rule_id}** \`${v.page_slug}\` vs \`${v.pair_slug || "N/A"}\`: ${v.detail}`);
      }
      if (warns.length > 50) {
        lines.push(`- ... and ${warns.length - 50} more warnings`);
      }
      lines.push("");
    }
  } else {
    lines.push("## No Violations Found");
    lines.push("");
    lines.push("All pages passed uniqueness checks.");
    lines.push("");
  }

  return lines.join("\n");
}
