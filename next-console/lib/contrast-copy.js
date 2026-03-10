// Contrast testing module: Warp vs legacy process blocks
// Compresses sales cycles by showing time/effort savings

export function generateContrastBlock(origin, destination, mode) {
  return {
    title: `${mode} Shipping: Legacy Process vs WARP`,
    subtitle: `${origin} to ${destination}`,
    comparisons: [
      {
        step: "Get a freight quote",
        legacy: {
          method: "Email broker, wait for callback",
          time: "2-24 hours",
          pain: "Manual follow-up, inconsistent responses, no rate transparency"
        },
        warp: {
          method: "Enter lane details, get instant estimate",
          time: "Under 2 minutes",
          advantage: "Self-serve lane-level pricing with confidence scoring"
        }
      },
      {
        step: "Compare carriers",
        legacy: {
          method: "Call multiple brokers, build a spreadsheet",
          time: "1-3 days",
          pain: "Fragmented data, no apples-to-apples comparison"
        },
        warp: {
          method: "Side-by-side lane comparison with mode options",
          time: "Included in quote flow",
          advantage: "LTL, FTL, and cargo van / box truck options in one view"
        }
      },
      {
        step: "Book shipment",
        legacy: {
          method: "Email confirmation, manual BOL creation",
          time: "30-60 minutes",
          pain: "Error-prone manual entry, no digital trail"
        },
        warp: {
          method: "One-click booking from quote",
          time: "Under 5 minutes",
          advantage: "Digital BOL, automatic carrier assignment"
        }
      },
      {
        step: "Track shipment",
        legacy: {
          method: "Call carrier, check portal manually",
          time: "15-30 min per check",
          pain: "Delayed updates, no proactive alerts"
        },
        warp: {
          method: "Real-time tracking dashboard",
          time: "Always available",
          advantage: "Proactive exception alerts, ETA updates"
        }
      },
      {
        step: "Handle exceptions",
        legacy: {
          method: "Discover problems reactively, scramble to fix",
          time: "Hours to days",
          pain: "Customer impact before you know there's a problem"
        },
        warp: {
          method: "Automated exception detection and escalation",
          time: "Minutes",
          advantage: "Resolve before customer impact"
        }
      }
    ],
    summary: {
      legacy_total_time: "3-5 days for full cycle",
      warp_total_time: "Under 1 hour for full cycle",
      time_savings: "90%+ reduction in operational time",
      cta: "See it yourself — get an instant quote on this lane"
    }
  };
}

// Generate a compact version for page JSON export
export function generateContrastSummary(origin, destination, mode) {
  return {
    headline: `Why ${mode} shippers switch from brokers to WARP`,
    points: [
      { metric: "Quote speed", legacy: "2-24 hours", warp: "Under 2 minutes" },
      { metric: "Booking time", legacy: "30-60 minutes", warp: "Under 5 minutes" },
      { metric: "Tracking", legacy: "Manual check-ins", warp: "Real-time dashboard" },
      { metric: "Exception handling", legacy: "Reactive, hours", warp: "Proactive, minutes" }
    ],
    bottom_line: `Shipping ${mode} from ${origin} to ${destination} with WARP eliminates the manual back-and-forth that costs logistics teams hours per shipment.`
  };
}
