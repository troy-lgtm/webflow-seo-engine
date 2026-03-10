import { headers } from "next/headers";
import Link from "next/link";
import "./dashboard.css";

export const metadata = {
  title: "SEO Control Panel | WARP",
  description: "Internal operator dashboard for the WARP SEO engine",
  robots: "noindex, nofollow",
};

export default async function SeoControlLayout({ children }) {
  // ── Auth gate ──
  const key = process.env.INTERNAL_DASHBOARD_KEY;
  if (key) {
    const hdrs = await headers();
    const cookie = hdrs.get("cookie") || "";
    const match = cookie.match(/seo_dash_key=([^;]+)/);
    const cookieKey = match ? match[1] : null;
    // Also check query param via referer (for initial login)
    if (cookieKey !== key) {
      return (
        <main className="ctrl" style={{ textAlign: "center", paddingTop: 120 }}>
          <div className="ctrl-card" style={{ maxWidth: 360, margin: "0 auto", padding: 24 }}>
            <h1 style={{ fontSize: "1rem", margin: "0 0 16px", fontWeight: 600 }}>SEO Control Panel</h1>
            <p style={{ color: "var(--text-dim)", fontSize: "0.82rem", margin: "0 0 16px" }}>
              Enter dashboard key to continue.
            </p>
            <form method="GET" action="/internal/seo-control/auth">
              <input
                type="password"
                name="key"
                placeholder="Dashboard key"
                className="ctrl-input"
                style={{ width: "100%", marginBottom: 10 }}
                autoFocus
              />
              <button type="submit" className="btn primary" style={{ width: "100%" }}>
                Access Dashboard
              </button>
            </form>
          </div>
        </main>
      );
    }
  }

  return (
    <div className="ctrl" data-testid="seo-control-panel">
      <nav className="ctrl-nav" data-testid="seo-control-nav">
        <Link href="/internal/seo-control" className="ctrl-nav-brand">
          SEO Control
        </Link>
        <div className="ctrl-nav-links">
          <Link href="/internal/seo-control" className="ctrl-nav-link">Overview</Link>
          <Link href="/internal/seo-control/publish-audit" className="ctrl-nav-link">Publish Audit</Link>
          <Link href="/internal/seo-control/corridors" className="ctrl-nav-link">Corridors</Link>
          <Link href="/internal/seo-control/lanes" className="ctrl-nav-link">Lanes</Link>
          <Link href="/internal/seo-control/lane-quality" className="ctrl-nav-link">Lane Quality</Link>
          <Link href="/internal/seo-control/experiments" className="ctrl-nav-link">Experiments</Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
