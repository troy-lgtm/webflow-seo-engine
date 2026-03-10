"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  buildAutofill,
  formatLocation,
  formatWindow,
  FREQUENCY_OPTIONS,
  EQUIPMENT_OPTIONS,
} from "@/lib/recurring/autofill";
import {
  getSavingsFraming,
  buildValueProps,
  getBenefitSummary,
} from "@/lib/recurring/savings-logic";
import {
  trackSetupStarted,
  trackSetupAutofilled,
  trackFieldChanged,
  trackSetupCompleted,
} from "@/lib/recurring/analytics";

// ── Mock source shipment (same as confirmation page) ────────────────
const SOURCE_SHIPMENT = {
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
};

// ── Icons ────────────────────────────────────────────────────────────
function IconSavings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconSpeed() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconConsistency() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconCapacity() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

const ICON_MAP = { savings: IconSavings, speed: IconSpeed, consistency: IconConsistency, capacity: IconCapacity };

// ── Live Value Summary ───────────────────────────────────────────────
function LiveValueSummary({ config }) {
  const framing = getSavingsFraming(config.frequency);
  const valueProps = buildValueProps(config);
  const benefitSummary = getBenefitSummary(config.frequency);

  return (
    <aside
      className="rc-live-summary surface"
      data-warp-section="live-value-summary"
      data-warp-tier={framing.tier}
      data-warp-accent={framing.accentLevel}
    >
      <div className="rc-summary-header">
        <p className="rc-summary-overline">Your recurring lane</p>
        <div className={`rc-savings-pill rc-accent-${framing.accentLevel}`}>
          {framing.savingsLabel}
        </div>
      </div>

      <div className="rc-summary-lane-card">
        <div className="rc-summary-lane-row">
          <div className="rc-summary-lane-point">
            <span className="rc-lane-dot rc-lane-origin" />
            <div>
              <span className="rc-lane-city">{config.origin.city || "Origin"}</span>
              <span className="rc-lane-state">{config.origin.state}</span>
            </div>
          </div>
          <div className="rc-summary-lane-arrow">→</div>
          <div className="rc-summary-lane-point">
            <span className="rc-lane-dot rc-lane-dest" />
            <div>
              <span className="rc-lane-city">{config.destination.city || "Destination"}</span>
              <span className="rc-lane-state">{config.destination.state}</span>
            </div>
          </div>
        </div>
        <div className="rc-summary-lane-meta">
          <span>{config.equipment}</span>
          <span className="rc-meta-sep">&middot;</span>
          <span className="rc-freq-highlight">{config.frequency}</span>
        </div>
      </div>

      <div className="rc-summary-headline">
        <h3>{framing.headline}</h3>
        <p>{benefitSummary}</p>
      </div>

      <ul className="rc-value-props">
        {valueProps.map((prop) => {
          const Icon = ICON_MAP[prop.icon] || IconSavings;
          return (
            <li key={prop.label} className="rc-value-prop">
              <div className="rc-prop-icon"><Icon /></div>
              <div>
                <span className="rc-prop-label">{prop.label}</span>
                <span className="rc-prop-desc">{prop.description}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rc-summary-badges">
        {framing.badges.map((badge) => (
          <span key={badge} className="rc-badge">{badge}</span>
        ))}
      </div>
    </aside>
  );
}

// ── Frequency Selector ───────────────────────────────────────────────
function FrequencySelector({ value, onChange }) {
  return (
    <div className="rc-frequency-selector" data-warp-section="frequency-selector">
      <label className="rc-field-label">Frequency</label>
      <div className="rc-freq-options">
        {FREQUENCY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`rc-freq-option ${value === opt.value ? "rc-freq-active" : ""}`}
            onClick={() => onChange(opt.value)}
            data-warp-action={`select-frequency-${opt.value}`}
          >
            <span className="rc-freq-label">{opt.label}</span>
            <span className="rc-freq-desc">{opt.description}</span>
            {opt.recommended && (
              <span className="rc-freq-rec">Recommended</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Setup Form ───────────────────────────────────────────────────────
function SetupForm({ config, onUpdate, onSubmit, submitting }) {
  function handleChange(field, value) {
    trackFieldChanged(field, value);
    onUpdate({ ...config, [field]: value });
  }

  function handleLocationChange(type, field, value) {
    const updated = { ...config[type], [field]: value };
    onUpdate({ ...config, [type]: updated });
  }

  return (
    <form
      className="rc-setup-form"
      data-warp-section="setup-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="rc-form-header">
        <h1 className="rc-form-title">Set up recurring lane</h1>
        <p className="rc-form-sub">
          We pre-filled your lane details from your recent shipment. Review and customize.
        </p>
        {config.autofilled && (
          <div className="rc-autofill-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Pre-filled from shipment
          </div>
        )}
      </div>

      <div className="rc-form-section">
        <h3 className="rc-section-label">Lane</h3>
        <div className="rc-form-row">
          <div className="rc-form-group">
            <label className="rc-field-label">Origin City</label>
            <input
              className="input"
              value={config.origin.city}
              onChange={(e) => handleLocationChange("origin", "city", e.target.value)}
              data-warp-field="origin-city"
            />
          </div>
          <div className="rc-form-group rc-form-sm">
            <label className="rc-field-label">State</label>
            <input
              className="input"
              value={config.origin.state}
              onChange={(e) => handleLocationChange("origin", "state", e.target.value)}
              data-warp-field="origin-state"
            />
          </div>
          <div className="rc-form-group rc-form-sm">
            <label className="rc-field-label">ZIP</label>
            <input
              className="input"
              value={config.origin.zip}
              onChange={(e) => handleLocationChange("origin", "zip", e.target.value)}
              data-warp-field="origin-zip"
            />
          </div>
        </div>
        <div className="rc-form-row">
          <div className="rc-form-group">
            <label className="rc-field-label">Destination City</label>
            <input
              className="input"
              value={config.destination.city}
              onChange={(e) => handleLocationChange("destination", "city", e.target.value)}
              data-warp-field="dest-city"
            />
          </div>
          <div className="rc-form-group rc-form-sm">
            <label className="rc-field-label">State</label>
            <input
              className="input"
              value={config.destination.state}
              onChange={(e) => handleLocationChange("destination", "state", e.target.value)}
              data-warp-field="dest-state"
            />
          </div>
          <div className="rc-form-group rc-form-sm">
            <label className="rc-field-label">ZIP</label>
            <input
              className="input"
              value={config.destination.zip}
              onChange={(e) => handleLocationChange("destination", "zip", e.target.value)}
              data-warp-field="dest-zip"
            />
          </div>
        </div>
      </div>

      <div className="rc-form-section">
        <FrequencySelector
          value={config.frequency}
          onChange={(v) => handleChange("frequency", v)}
        />
      </div>

      <div className="rc-form-section">
        <h3 className="rc-section-label">Equipment &amp; Windows</h3>
        <div className="rc-form-row">
          <div className="rc-form-group">
            <label className="rc-field-label">Equipment Type</label>
            <select
              className="select"
              value={config.equipment}
              onChange={(e) => handleChange("equipment", e.target.value)}
              data-warp-field="equipment"
            >
              {EQUIPMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="rc-form-group">
            <label className="rc-field-label">Mode</label>
            <select
              className="select"
              value={config.mode}
              onChange={(e) => handleChange("mode", e.target.value)}
              data-warp-field="mode"
            >
              <option value="LTL">LTL</option>
              <option value="FTL">FTL</option>
              <option value="Cargo Van / Box Truck">Cargo Van / Box Truck</option>
            </select>
          </div>
        </div>
        <div className="rc-form-row">
          <div className="rc-form-group">
            <label className="rc-field-label">Pickup Window</label>
            <div className="rc-time-row">
              <input
                type="time"
                className="input"
                value={config.pickupWindow?.start || "08:00"}
                onChange={(e) =>
                  onUpdate({
                    ...config,
                    pickupWindow: { ...config.pickupWindow, start: e.target.value },
                  })
                }
                data-warp-field="pickup-start"
              />
              <span className="rc-time-sep">to</span>
              <input
                type="time"
                className="input"
                value={config.pickupWindow?.end || "17:00"}
                onChange={(e) =>
                  onUpdate({
                    ...config,
                    pickupWindow: { ...config.pickupWindow, end: e.target.value },
                  })
                }
                data-warp-field="pickup-end"
              />
            </div>
          </div>
          <div className="rc-form-group">
            <label className="rc-field-label">Delivery Window</label>
            <div className="rc-time-row">
              <input
                type="time"
                className="input"
                value={config.deliveryWindow?.start || "08:00"}
                onChange={(e) =>
                  onUpdate({
                    ...config,
                    deliveryWindow: { ...config.deliveryWindow, start: e.target.value },
                  })
                }
                data-warp-field="delivery-start"
              />
              <span className="rc-time-sep">to</span>
              <input
                type="time"
                className="input"
                value={config.deliveryWindow?.end || "17:00"}
                onChange={(e) =>
                  onUpdate({
                    ...config,
                    deliveryWindow: { ...config.deliveryWindow, end: e.target.value },
                  })
                }
                data-warp-field="delivery-end"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rc-form-actions">
        <button
          type="submit"
          className="btn primary rc-btn-confirm"
          disabled={submitting || !config.origin.city || !config.destination.city}
          data-warp-action="confirm-recurring"
        >
          {submitting ? (
            <>
              <span className="rc-spinner" aria-hidden="true" />
              Setting up...
            </>
          ) : (
            "Confirm recurring lane"
          )}
        </button>
        <Link
          href="/shipment/confirmation"
          className="btn ghost"
          data-warp-action="cancel-setup"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export default function RecurringSetupPage() {
  const [config, setConfig] = useState(() => buildAutofill(SOURCE_SHIPMENT));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    trackSetupStarted({
      origin: config.origin,
      destination: config.destination,
      autofilled: config.autofilled,
      equipment: config.equipment,
      frequency: config.frequency,
    });

    if (config.autofilled) {
      trackSetupAutofilled({
        origin: config.origin,
        destination: config.destination,
        fieldsPrefilled: 8,
        sourceShipmentId: config.sourceShipmentId,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(() => {
    setSubmitting(true);
    trackSetupCompleted({
      origin: config.origin,
      destination: config.destination,
      frequency: config.frequency,
      equipment: config.equipment,
      autofilled: config.autofilled,
      source: "post_booking",
    });
    // Simulate API call
    setTimeout(() => {
      window.location.href = `/recurring/success?frequency=${config.frequency}&origin=${config.origin.city}&destination=${config.destination.city}`;
    }, 1200);
  }, [config]);

  return (
    <main className="shell rc-page" data-warp-page="recurring-setup">
      <div className="rc-setup-layout">
        <SetupForm
          config={config}
          onUpdate={setConfig}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
        <LiveValueSummary config={config} />
      </div>
    </main>
  );
}
