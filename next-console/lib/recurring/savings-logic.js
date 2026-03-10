/**
 * Recurring Savings Logic
 * Simple, honest messaging about recurring lane benefits.
 * No fake precision — uses rules-based copy framing.
 *
 * Tiers:
 *   occasional (monthly/biweekly) → save time + improve consistency
 *   standard (weekly)             → unlock better lane pricing
 *   high-frequency (daily)        → strongest recurring economics
 */

const SAVINGS_TIERS = {
  daily: {
    tier: "high_frequency",
    headline: "Strongest recurring economics",
    benefit: "Daily recurring lanes unlock our strongest volume-based pricing and dedicated capacity planning.",
    badges: ["Best pricing potential", "Dedicated capacity", "Priority scheduling"],
    savingsLabel: "Strongest savings tier",
    accentLevel: 3,
  },
  weekly: {
    tier: "standard",
    headline: "Better recurring pricing",
    benefit: "Weekly recurring lanes help us plan better and price better. More predictable volume unlocks improved economics.",
    badges: ["Better pricing", "Consistent service", "Reduced booking work"],
    savingsLabel: "Strong savings tier",
    accentLevel: 2,
  },
  biweekly: {
    tier: "occasional",
    headline: "Improved consistency",
    benefit: "Regular recurring lanes reduce coordination overhead and improve service consistency on this corridor.",
    badges: ["Time savings", "Consistent service"],
    savingsLabel: "Savings eligible",
    accentLevel: 1,
  },
  monthly: {
    tier: "occasional",
    headline: "Save time on repeat bookings",
    benefit: "Even monthly recurring lanes reduce the manual booking steps and help maintain service consistency.",
    badges: ["Time savings", "Less coordination"],
    savingsLabel: "Savings eligible",
    accentLevel: 1,
  },
};

/**
 * Get savings framing for a given frequency.
 * @param {string} frequency — daily | weekly | biweekly | monthly
 * @returns {object} savings tier info
 */
export function getSavingsFraming(frequency) {
  return SAVINGS_TIERS[frequency] || SAVINGS_TIERS.weekly;
}

/**
 * Build the value propositions for the live summary card.
 * @param {object} config — { frequency, equipment, origin, destination }
 * @returns {object[]} value props
 */
export function buildValueProps(config) {
  const { frequency } = config;
  const framing = getSavingsFraming(frequency);
  const props = [];

  // Always present
  props.push({
    icon: "savings",
    label: "Better pricing potential",
    description: "Consistent lanes can unlock lower pricing over time",
  });

  props.push({
    icon: "speed",
    label: "Less operational friction",
    description: "Fewer manual booking steps each time you ship",
  });

  props.push({
    icon: "consistency",
    label: "More consistent service",
    description: "More predictable pickup and delivery windows",
  });

  // Frequency-specific
  if (frequency === "daily" || frequency === "weekly") {
    props.push({
      icon: "capacity",
      label: "Improved capacity planning",
      description: "More predictable volume helps us assign equipment more reliably",
    });
  }

  return props;
}

/**
 * Get the recurring benefit summary message.
 * Used in the live summary card and final success state.
 */
export function getBenefitSummary(frequency) {
  const framing = getSavingsFraming(frequency);

  const messages = {
    daily: "You're creating a high-frequency recurring lane with the strongest pricing potential, dedicated capacity planning, and priority scheduling.",
    weekly: "You're creating a repeatable lane with fewer booking steps, better pricing potential, and more consistent service.",
    biweekly: "You're setting up a recurring lane that reduces coordination overhead and improves service consistency.",
    monthly: "You're establishing a recurring lane that saves time on repeat bookings and maintains service familiarity.",
  };

  return messages[frequency] || messages.weekly;
}

export { SAVINGS_TIERS };
