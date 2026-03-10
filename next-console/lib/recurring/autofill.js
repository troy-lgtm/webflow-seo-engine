/**
 * Recurring Lane Autofill
 * Extracts lane details from a booked shipment and prepopulates
 * the recurring setup form. The customer should feel:
 * "We already did the work for you."
 */

/**
 * Build a prefilled recurring lane config from a booked shipment.
 * @param {object} shipment — the shipment that was just booked
 * @returns {object} recurring lane prefill
 */
export function buildAutofill(shipment) {
  if (!shipment) return defaultAutofill();

  const origin = {
    city: shipment.origin_city || shipment.originCity || "",
    state: shipment.origin_state || shipment.originState || "",
    zip: shipment.origin_zip || shipment.originZip || "",
  };

  const destination = {
    city: shipment.destination_city || shipment.destinationCity || "",
    state: shipment.destination_state || shipment.destinationState || "",
    zip: shipment.destination_zip || shipment.destinationZip || "",
  };

  const mode = shipment.mode || shipment.equipment_type || shipment.equipmentType || "LTL";
  const equipment = shipment.equipment || shipment.equipment_type || shipment.equipmentType || inferEquipment(mode);

  // Pickup / delivery windows
  const pickupWindow = shipment.pickup_window || shipment.pickupWindow || null;
  const deliveryWindow = shipment.delivery_window || shipment.deliveryWindow || null;

  // Infer frequency from history
  const frequency = inferFrequency(shipment);

  return {
    origin,
    destination,
    mode,
    equipment,
    frequency,
    pickupWindow: pickupWindow || { start: "08:00", end: "17:00" },
    deliveryWindow: deliveryWindow || { start: "08:00", end: "17:00" },
    autofilled: true,
    sourceShipmentId: shipment.id || shipment.shipment_id || null,
  };
}

/**
 * Infer default equipment from mode.
 */
function inferEquipment(mode) {
  const map = {
    LTL: "Dry Van",
    FTL: "Dry Van",
    "Cargo Van / Box Truck": "Cargo Van",
    Flatbed: "Flatbed",
    Reefer: "Reefer",
  };
  return map[mode] || "Dry Van";
}

/**
 * Infer likely recurring frequency from shipment data.
 * If we have repeat history, use it. Otherwise default to Weekly.
 */
function inferFrequency(shipment) {
  // If shipment has historical cadence data
  if (shipment.historical_frequency) return shipment.historical_frequency;
  if (shipment.repeat_count && shipment.repeat_count >= 4) return "weekly";
  if (shipment.repeat_count && shipment.repeat_count >= 2) return "biweekly";

  // Default to weekly — most common for SMB shippers
  return "weekly";
}

/**
 * Default autofill when no shipment data is available.
 */
function defaultAutofill() {
  return {
    origin: { city: "", state: "", zip: "" },
    destination: { city: "", state: "", zip: "" },
    mode: "LTL",
    equipment: "Dry Van",
    frequency: "weekly",
    pickupWindow: { start: "08:00", end: "17:00" },
    deliveryWindow: { start: "08:00", end: "17:00" },
    autofilled: false,
    sourceShipmentId: null,
  };
}

/**
 * Format a location for display.
 */
export function formatLocation(loc) {
  if (!loc) return "";
  const parts = [loc.city, loc.state].filter(Boolean);
  if (loc.zip) parts.push(loc.zip);
  return parts.join(", ");
}

/**
 * Format a time window for display.
 */
export function formatWindow(win) {
  if (!win) return "Flexible";
  return `${win.start || "08:00"} - ${win.end || "17:00"}`;
}

/**
 * Frequency options for the selector.
 */
export const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily", description: "Every business day" },
  { value: "weekly", label: "Weekly", description: "Once per week", recommended: true },
  { value: "biweekly", label: "Every 2 Weeks", description: "Twice per month" },
  { value: "monthly", label: "Monthly", description: "Once per month" },
];

/**
 * Equipment options for the selector.
 */
export const EQUIPMENT_OPTIONS = [
  { value: "Dry Van", label: "Dry Van" },
  { value: "Cargo Van", label: "Cargo Van" },
  { value: "Flatbed", label: "Flatbed" },
  { value: "Reefer", label: "Reefer" },
  { value: "Box Truck", label: "Box Truck" },
  { value: "Sprinter Van", label: "Sprinter Van" },
];
