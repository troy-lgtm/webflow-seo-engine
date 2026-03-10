"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { buildAutofill, formatLocation } from "@/lib/recurring/autofill";
import { getSavingsFraming } from "@/lib/recurring/savings-logic";
import {
  trackUpsellViewed,
  trackUpsellClicked,
  trackSetupSkipped,
} from "@/lib/recurring/analytics";

// ── Mock shipment for demo ─────────────────────────────────────────
const DEMO_SHIPMENT = {
  id: "SHP-20260305-7721",
  origin_city: "Chicago",
  origin_state: "IL",
  origin_zip: "60601",
  destination_city: "Dallas",
  destination_state: "TX",
  destination_zip: "75201",
  mode: "LTL",
  equipment_type: "Dry Van",
  pickup_window: { start: "08:00", end: "12:00" },
  delivery_window: { start: "08:00", end: "17:00" },
  repeat_count: 5,
  total: 1247.0,
  estimated_transit: "2-3 days",
};

// ── Confetti-style celebration dots ─────────────────────────────────
function CelebrationDots() {
  return (
    <div className="rc-celebration" aria-hidden="true">
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className="rc-dot"
          style={{
            "--dot-angle": `${i * 30}deg`,
            "--dot-delay": `${i * 60}ms`,
          }}
        />
      ))}
    </div>
  );
}

// ── Shipment confirmed hero ─────────────────────────────────────────
function ConfirmationHero({ shipment }) {
  return (
    <section
      className="rc-confirmation-hero"
      data-warp-section="shipment-confirmed"
    >
      <div className="rc-success-icon">
        <CelebrationDots />
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h1 className="rc-hero-title">Shipment Booked</h1>
      <p className="rc-hero-sub">
        {shipment.id} &middot; {formatLocation({ city: shipment.origin_city, state: shipment.origin_state })}
        {" → "}
        {formatLocation({ city: shipment.destination_city, state: shipment.destination_state })}
      </p>
      <div className="rc-hero-details">
        <span className="rc-detail-chip">
          {shipment.mode} &middot; {shipment.equipment_type}
        </span>
        <span className="rc-detail-chip">
          Est. {shipment.estimated_transit}
        </span>
        <span className="rc-detail-chip rc-detail-total">
          ${shipment.total?.toLocaleString()}
        </span>
      </div>
    </section>
  );
}

// ── Recurring upsell module ─────────────────────────────────────────
function RecurringUpsell({ autofill, onSetup, onSkip }) {
  const framing = getSavingsFraming(autofill.frequency);

  return (
    <section
      className="rc-upsell surface"
      data-warp-section="recurring-upsell"
      data-warp-upsell-tier={framing.tier}
    >
      <div className="rc-upsell-glow" aria-hidden="true" />
      <div className="rc-upsell-content">
        <p className="rc-upsell-overline">
          <span className="rc-upsell-icon" aria-hidden="true">↻</span>
          Recurring lane opportunity
        </p>
        <h2 className="rc-upsell-headline">
          Turn this into a money-saving recurring lane
        </h2>
        <p className="rc-upsell-benefit">
          {framing.benefit}
        </p>
        <div className="rc-upsell-badges">
          {framing.badges.map((badge) => (
            <span key={badge} className="rc-badge">{badge}</span>
          ))}
        </div>
        <div className="rc-upsell-lane">
          <div className="rc-lane-visual">
            <span className="rc-lane-dot rc-lane-origin" />
            <span className="rc-lane-line" />
            <span className="rc-lane-dot rc-lane-dest" />
          </div>
          <div className="rc-lane-labels">
            <span>
              {formatLocation({ city: autofill.origin.city, state: autofill.origin.state })}
            </span>
            <span className="rc-lane-freq">{autofill.frequency}</span>
            <span>
              {formatLocation({ city: autofill.destination.city, state: autofill.destination.state })}
            </span>
          </div>
        </div>
        <div className="rc-upsell-actions">
          <button
            className="btn primary rc-btn-setup"
            onClick={onSetup}
            data-warp-action="setup-recurring"
          >
            Set up recurring savings
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            className="btn ghost rc-btn-skip"
            onClick={onSkip}
            data-warp-action="skip-recurring"
          >
            Not now
          </button>
        </div>
        <p className="rc-upsell-micro">
          We pre-filled your lane details. Setup takes under 60 seconds.
        </p>
      </div>
    </section>
  );
}

// ── Shipment details summary ─────────────────────────────────────────
function ShipmentSummary({ shipment }) {
  return (
    <section
      className="surface panel rc-shipment-summary"
      data-warp-section="shipment-summary"
    >
      <h2>Shipment Details</h2>
      <div className="grid-2">
        <div className="rc-summary-field">
          <span className="rc-field-label">Origin</span>
          <span className="rc-field-value">
            {shipment.origin_city}, {shipment.origin_state} {shipment.origin_zip}
          </span>
        </div>
        <div className="rc-summary-field">
          <span className="rc-field-label">Destination</span>
          <span className="rc-field-value">
            {shipment.destination_city}, {shipment.destination_state} {shipment.destination_zip}
          </span>
        </div>
        <div className="rc-summary-field">
          <span className="rc-field-label">Equipment</span>
          <span className="rc-field-value">{shipment.equipment_type}</span>
        </div>
        <div className="rc-summary-field">
          <span className="rc-field-label">Mode</span>
          <span className="rc-field-value">{shipment.mode}</span>
        </div>
        <div className="rc-summary-field">
          <span className="rc-field-label">Pickup Window</span>
          <span className="rc-field-value">
            {shipment.pickup_window?.start} - {shipment.pickup_window?.end}
          </span>
        </div>
        <div className="rc-summary-field">
          <span className="rc-field-label">Transit</span>
          <span className="rc-field-value">{shipment.estimated_transit}</span>
        </div>
      </div>
      <div className="divider" />
      <div className="rc-actions-row">
        <Link href="/" className="btn ghost" data-warp-action="back-dashboard">
          ← Back to dashboard
        </Link>
        <button className="btn" data-warp-action="track-shipment">
          Track shipment
        </button>
      </div>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export default function ShipmentConfirmationPage() {
  const [shipment] = useState(DEMO_SHIPMENT);
  const [upsellDismissed, setUpsellDismissed] = useState(false);

  const autofill = useMemo(() => buildAutofill(shipment), [shipment]);

  useEffect(() => {
    trackUpsellViewed({
      origin: autofill.origin,
      destination: autofill.destination,
      equipment: autofill.equipment,
      source: "post_booking",
    });
  }, [autofill]);

  function handleSetup() {
    trackUpsellClicked({
      origin: autofill.origin,
      destination: autofill.destination,
      equipment: autofill.equipment,
      source: "post_booking",
    });
    // In production: router.push(`/recurring/setup?shipment=${shipment.id}`)
    window.location.href = `/recurring/setup?shipment=${shipment.id}`;
  }

  function handleSkip() {
    trackSetupSkipped({
      origin: autofill.origin,
      destination: autofill.destination,
      source: "post_booking",
    });
    setUpsellDismissed(true);
  }

  return (
    <main className="shell rc-page" data-warp-page="shipment-confirmation">
      <ConfirmationHero shipment={shipment} />
      {!upsellDismissed && (
        <RecurringUpsell
          autofill={autofill}
          onSetup={handleSetup}
          onSkip={handleSkip}
        />
      )}
      <ShipmentSummary shipment={shipment} />
    </main>
  );
}
