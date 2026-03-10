/**
 * Recurring Flow Analytics
 * Tracks the recurring setup funnel for conversion optimization.
 * Uses data attributes + window event dispatch pattern.
 * No raw PII — tracks lane hashes and categorical data only.
 */

/**
 * Simple hash for lane identity (no PII).
 */
function laneHash(origin, destination) {
  const str = `${origin}|${destination}`.toLowerCase();
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Determine region from state abbreviation.
 */
function regionFromState(state) {
  const regions = {
    CA: "west", WA: "west", OR: "west", NV: "west", AZ: "west", CO: "west", UT: "west",
    TX: "south", FL: "south", GA: "south", NC: "south", SC: "south", TN: "south", AL: "south",
    NY: "northeast", NJ: "northeast", PA: "northeast", MA: "northeast", CT: "northeast",
    IL: "midwest", OH: "midwest", MI: "midwest", IN: "midwest", MN: "midwest", MO: "midwest",
  };
  return regions[(state || "").toUpperCase()] || "other";
}

/**
 * Dispatch a recurring flow analytics event.
 * @param {string} eventName — event type
 * @param {object} payload — event-specific data
 */
export function trackRecurringEvent(eventName, payload = {}) {
  const event = {
    event: eventName,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  // 1. Dispatch custom event for GTM / analytics listeners
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("warp_analytics", { detail: event })
    );

    // 2. Push to dataLayer if available (GTM)
    if (window.dataLayer) {
      window.dataLayer.push(event);
    }
  }

  // 3. Console log in development
  if (process.env.NODE_ENV === "development") {
    console.log(`[WARP Analytics] ${eventName}`, event);
  }

  return event;
}

// ── Specific Event Helpers ────────────────────────────────────────

export function trackUpsellViewed(config) {
  return trackRecurringEvent("RECURRING_UPSELL_VIEWED", {
    lane_hash: laneHash(
      `${config?.origin?.city},${config?.origin?.state}`,
      `${config?.destination?.city},${config?.destination?.state}`
    ),
    origin_region: regionFromState(config?.origin?.state),
    destination_region: regionFromState(config?.destination?.state),
    equipment: config?.equipment || "unknown",
    source: config?.source || "post_booking",
  });
}

export function trackUpsellClicked(config) {
  return trackRecurringEvent("RECURRING_UPSELL_CLICKED", {
    lane_hash: laneHash(
      `${config?.origin?.city},${config?.origin?.state}`,
      `${config?.destination?.city},${config?.destination?.state}`
    ),
    equipment: config?.equipment || "unknown",
    source: config?.source || "post_booking",
  });
}

export function trackSetupStarted(config) {
  return trackRecurringEvent("RECURRING_SETUP_STARTED", {
    lane_hash: laneHash(
      `${config?.origin?.city},${config?.origin?.state}`,
      `${config?.destination?.city},${config?.destination?.state}`
    ),
    autofilled: config?.autofilled || false,
    equipment: config?.equipment || "unknown",
    frequency: config?.frequency || "unknown",
  });
}

export function trackSetupAutofilled(config) {
  return trackRecurringEvent("RECURRING_SETUP_AUTOFILLED", {
    lane_hash: laneHash(
      `${config?.origin?.city},${config?.origin?.state}`,
      `${config?.destination?.city},${config?.destination?.state}`
    ),
    fields_prefilled: config?.fieldsPrefilled || 0,
    source_shipment: config?.sourceShipmentId ? true : false,
  });
}

export function trackFieldChanged(fieldName, value) {
  return trackRecurringEvent("RECURRING_SETUP_FIELD_CHANGED", {
    field: fieldName,
    value: fieldName === "frequency" ? value : undefined,
  });
}

export function trackSetupCompleted(config) {
  return trackRecurringEvent("RECURRING_SETUP_COMPLETED", {
    lane_hash: laneHash(
      `${config?.origin?.city},${config?.origin?.state}`,
      `${config?.destination?.city},${config?.destination?.state}`
    ),
    frequency: config?.frequency || "unknown",
    equipment: config?.equipment || "unknown",
    autofill_used: config?.autofilled || false,
    started_from_post_booking: config?.source === "post_booking",
  });
}

export function trackSetupSkipped(config) {
  return trackRecurringEvent("RECURRING_SETUP_SKIPPED", {
    lane_hash: laneHash(
      `${config?.origin?.city},${config?.origin?.state}`,
      `${config?.destination?.city},${config?.destination?.state}`
    ),
    source: config?.source || "post_booking",
  });
}
