/**
 * Shared geography helpers — haversine distance, city lookup, normalization.
 * Single source of truth. Used by estimate-model, lane-intelligence, lane-archetypes.
 */
import cities from "@/data/cities.json";

/**
 * Normalize a city string for lookup: lowercase, strip non-alphanum, collapse spaces.
 */
export function normCity(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9,. ]+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Look up a city in cities.json by name. Supports "Chicago, IL" and "Chicago" forms.
 * @param {string} name — city name, optionally with state
 * @returns {{ lat: number, lon: number, region: string } | null}
 */
export function lookupCity(name) {
  const key = normCity(name);
  if (cities[key]) return cities[key];
  const noState = key.replace(/,\s*[a-z]{2}$/, "").trim();
  for (const [k, v] of Object.entries(cities)) {
    if (k.startsWith(noState)) return v;
  }
  return null;
}

/**
 * Haversine distance in statute miles between two lat/lon points.
 * @returns {number} — distance in miles (straight-line)
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Extract just the city name from "City, ST" format.
 * e.g., "Chicago, IL" → "chicago"
 */
export function cityName(fullCity) {
  return String(fullCity || "").split(",")[0].trim().toLowerCase().replace(/\s+/g, " ");
}
