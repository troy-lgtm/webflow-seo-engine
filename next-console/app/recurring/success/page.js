"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { getSavingsFraming } from "@/lib/recurring/savings-logic";

// ── Success checkmark with animated ring ────────────────────────────
function SuccessIcon() {
  return (
    <div className="rc-success-ring">
      <svg
        className="rc-success-svg"
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
      >
        <circle
          className="rc-ring-circle"
          cx="32"
          cy="32"
          r="28"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <polyline
          className="rc-ring-check"
          points="20,33 28,41 44,25"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

// ── What happens next section ────────────────────────────────────────
function NextSteps() {
  const steps = [
    {
      icon: "📋",
      title: "Lane registered",
      desc: "Your recurring lane is now in our system and ready for scheduling.",
    },
    {
      icon: "📊",
      title: "Capacity planned",
      desc: "Our team will begin planning carrier capacity for your corridor.",
    },
    {
      icon: "💰",
      title: "Pricing improves",
      desc: "As your lane establishes consistency, pricing will improve over time.",
    },
    {
      icon: "🔄",
      title: "Auto-scheduling",
      desc: "Shipments will be automatically created based on your frequency.",
    },
  ];

  return (
    <section className="rc-next-steps" data-warp-section="next-steps">
      <h3 className="rc-section-label">What happens next</h3>
      <div className="rc-steps-grid">
        {steps.map((step, i) => (
          <div key={i} className="rc-step-card">
            <span className="rc-step-number">{i + 1}</span>
            <div className="rc-step-content">
              <span className="rc-step-title">{step.title}</span>
              <span className="rc-step-desc">{step.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Lane summary recap ───────────────────────────────────────────────
function LaneRecap({ origin, destination, frequency, equipment }) {
  const framing = getSavingsFraming(frequency);

  return (
    <section className="rc-lane-recap surface" data-warp-section="lane-recap">
      <div className="rc-recap-header">
        <p className="rc-summary-overline">Your recurring lane</p>
        <div className={`rc-savings-pill rc-accent-${framing.accentLevel}`}>
          {framing.savingsLabel}
        </div>
      </div>
      <div className="rc-recap-lane">
        <div className="rc-recap-point">
          <span className="rc-lane-dot rc-lane-origin" />
          <span className="rc-recap-city">{origin || "Origin"}</span>
        </div>
        <div className="rc-recap-arrow">
          <span className="rc-lane-line" />
          <span className="rc-recap-freq">{frequency}</span>
        </div>
        <div className="rc-recap-point">
          <span className="rc-lane-dot rc-lane-dest" />
          <span className="rc-recap-city">{destination || "Destination"}</span>
        </div>
      </div>
      <div className="rc-recap-meta">
        <span className="rc-detail-chip">{equipment || "Dry Van"}</span>
        <span className="rc-detail-chip">{framing.headline}</span>
      </div>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export default function RecurringSuccessPage() {
  // Parse query params from URL on client
  const params = useMemo(() => {
    if (typeof window === "undefined") return {};
    const sp = new URLSearchParams(window.location.search);
    return {
      frequency: sp.get("frequency") || "weekly",
      origin: sp.get("origin") || "Chicago",
      destination: sp.get("destination") || "Dallas",
      equipment: sp.get("equipment") || "Dry Van",
    };
  }, []);

  const framing = getSavingsFraming(params.frequency);

  useEffect(() => {
    // Subtle page entrance feel
    document.documentElement.style.setProperty("--rc-entrance", "1");
    return () => document.documentElement.style.removeProperty("--rc-entrance");
  }, []);

  return (
    <main
      className="shell rc-page rc-success-page"
      data-warp-page="recurring-success"
    >
      <section className="rc-success-hero" data-warp-section="success-hero">
        <SuccessIcon />
        <h1 className="rc-success-title">Recurring lane created</h1>
        <p className="rc-success-sub">
          {params.origin} → {params.destination} is now set up as a{" "}
          <strong>{params.frequency}</strong> recurring lane.
          {" "}{framing.benefit}
        </p>
      </section>

      <LaneRecap
        origin={params.origin}
        destination={params.destination}
        frequency={params.frequency}
        equipment={params.equipment}
      />

      <NextSteps />

      <section className="rc-success-actions" data-warp-section="success-actions">
        <Link
          href="/"
          className="btn primary rc-btn-dashboard"
          data-warp-action="go-dashboard"
        >
          Go to dashboard
        </Link>
        <Link
          href="/shipment/confirmation"
          className="btn"
          data-warp-action="book-another"
        >
          Book another shipment
        </Link>
      </section>
    </main>
  );
}
