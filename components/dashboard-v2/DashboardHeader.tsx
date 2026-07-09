import { Bell, Search, Settings } from "lucide-react";

const primaryNavItems = [
  { label: "Markets", href: "/dashboard-v2", active: true },
  { label: "Live Feed", href: "/feed" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "News", href: "/news" },
  { label: "Filings", href: "/filings" },
  { label: "Alerts", href: "/alerts" },
  { label: "Calendar", href: "/calendar" },
  { label: "Premium", href: "/premium", premium: true },
];

export function DashboardHeader() {
  return (
    <header className="dashboard-v2-header">
      <div className="dashboard-v2-brand">
        <span>STOCK RADAR</span>
        <small>
          15m delayed
          <i aria-hidden="true" />
        </small>
      </div>

      <nav className="dashboard-v2-primary-nav" aria-label="Primary navigation">
        {primaryNavItems.map((item) => (
          <a
            key={item.label}
            className={item.premium ? "dashboard-v2-nav-premium" : undefined}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="dashboard-v2-header-actions" aria-label="Dashboard actions">
        <button type="button">
          <Search aria-hidden="true" size={18} />
          <span>Search</span>
        </button>
        <button className="dashboard-v2-icon-button has-alert" type="button" aria-label="Alerts">
          <Bell aria-hidden="true" size={18} />
        </button>
        <button className="dashboard-v2-icon-button" type="button" aria-label="Settings">
          <Settings aria-hidden="true" size={18} />
        </button>
      </div>
    </header>
  );
}
