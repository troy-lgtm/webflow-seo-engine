"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

export default function LanesPage() {
  const [lanes, setLanes] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [corridorFilter, setCorridorFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLanes() {
      setLoading(true);
      const params = new URLSearchParams({ view: "lanes" });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (corridorFilter) params.set("corridor", corridorFilter);
      try {
        const res = await fetch(`/api/seo?${params}`);
        const data = await res.json();
        setLanes(data.lanes || []);
        setTotal(data.total_filtered || data.lanes?.length || 0);
      } catch {
        setLanes([]);
      }
      setLoading(false);
    }
    const timeout = setTimeout(fetchLanes, 200);
    return () => clearTimeout(timeout);
  }, [search, statusFilter, corridorFilter]);

  const statusCounts = {
    indexed: lanes.filter(l => l.status === "indexed").length,
    noindex: lanes.filter(l => l.status === "noindex").length,
    blocked: lanes.filter(l => l.status === "blocked").length,
  };

  return (
    <div data-testid="seo-lanes">
      <div className="ctrl-header">
        <h1>Lanes</h1>
        <p>{total.toLocaleString()} lanes loaded</p>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search lanes..."
          className="ctrl-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 200 }}
          data-testid="lane-search"
        />
        <select
          className="ctrl-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="indexed">Indexed ({statusCounts.indexed})</option>
          <option value="noindex">Noindex ({statusCounts.noindex})</option>
          <option value="blocked">Blocked ({statusCounts.blocked})</option>
        </select>
        <select
          className="ctrl-select"
          value={corridorFilter}
          onChange={(e) => setCorridorFilter(e.target.value)}
        >
          <option value="">All corridors</option>
          <option value="chicago-dfw">Chicago–DFW</option>
          <option value="socal-phoenix">SoCal–Phoenix</option>
          <option value="texas-triangle">Texas Triangle</option>
          <option value="northeast-regional">Northeast Regional</option>
          <option value="southeast-retail">Southeast Retail</option>
          <option value="la-chicago">LA–Chicago</option>
          <option value="midwest-southeast">Midwest–Southeast</option>
          <option value="pnw-socal">PNW–SoCal</option>
          <option value="texas-southeast">Texas–Southeast</option>
          <option value="mountain-west">Mountain West</option>
          <option value="northeast-midwest">Northeast–Midwest</option>
          <option value="socal-texas">SoCal–Texas</option>
          <option value="florida-northeast">Florida–Northeast</option>
          <option value="other">Other</option>
        </select>
      </div>

      {loading ? (
        <div className="ctrl-card" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ color: "var(--text-dim)", margin: 0 }}>Loading...</p>
        </div>
      ) : (
        <div className="ctrl-table-wrap">
          <table className="ctrl-table" data-testid="lanes-table">
            <thead>
              <tr>
                <th>Lane Slug</th>
                <th>Corridor</th>
                <th>Status</th>
                <th>Quality</th>
                <th>Similarity</th>
                <th>Demand</th>
                <th>Impressions</th>
                <th>Clicks</th>
                <th>Quotes</th>
                <th>Bookings</th>
              </tr>
            </thead>
            <tbody>
              {lanes.slice(0, 100).map(l => (
                <tr key={l.lane_slug}>
                  <td>
                    <Link
                      href={`/internal/seo-control/lanes/${l.lane_slug}`}
                      className="mono"
                      style={{ color: "var(--accent)", textDecoration: "none", fontSize: "0.73rem" }}
                    >
                      {l.lane_slug}
                    </Link>
                  </td>
                  <td style={{ fontSize: "0.72rem" }}>{l.corridor}</td>
                  <td><span className={`ctrl-status ${l.status}`}>{l.status}</span></td>
                  <td>
                    <span style={{
                      color: l.quality_score >= 80 ? "var(--success)"
                        : l.quality_score >= 65 ? "var(--accent)"
                        : l.quality_score >= 40 ? "var(--warn)" : "var(--danger)",
                      fontWeight: 600,
                    }}>
                      {l.quality_score}
                    </span>
                  </td>
                  <td style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.72rem" }}>
                    {l.similarity_score.toFixed(2)}
                  </td>
                  <td>{l.demand_signal ? <span style={{ color: "var(--success)" }}>✓</span> : "—"}</td>
                  <td>{l.gsc_impressions}</td>
                  <td>{l.gsc_clicks}</td>
                  <td>{l.quote_starts}</td>
                  <td>{l.bookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lanes.length > 100 && (
        <p style={{ fontSize: "0.76rem", color: "var(--text-dim)", marginTop: 8 }}>
          Showing first 100 of {total.toLocaleString()} lanes. Use search to filter.
        </p>
      )}
    </div>
  );
}
