import { Link, NavLink, useLocation } from "react-router-dom";
import { LanguageSwitcher } from "./language-switcher";
import { useI18n, type TranslationKey } from "../lib/i18n";

const navItems: Array<{ to: string; labelKey: TranslationKey }> = [
  { to: "/dashboard", labelKey: "nav.dashboard" },
  { to: "/salons", labelKey: "nav.salons" },
  { to: "/salons/new", labelKey: "nav.createSalon" },
  { to: "/call-center-agents", labelKey: "nav.callCenterAgents" },
  { to: "/calls", labelKey: "nav.calls" },
  { to: "/ai-logs", labelKey: "nav.aiLogs" },
  { to: "/health", labelKey: "nav.health" }
];

const isNavItemActive = (pathname: string, target: string): boolean => {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  if (target === "/salons/new") {
    return normalizedPathname === "/salons/new";
  }
  if (target === "/salons") {
    return (
      normalizedPathname === "/salons" ||
      (normalizedPathname.startsWith("/salons/") && normalizedPathname !== "/salons/new")
    );
  }
  if (target === "/dashboard") {
    return normalizedPathname === "/dashboard";
  }
  return normalizedPathname === target || normalizedPathname.startsWith(`${target}/`);
};

const toTitleKey = (pathname: string): TranslationKey => {
  if (pathname === "/dashboard") return "nav.dashboard";
  if (pathname.startsWith("/salons/new")) return "nav.createSalon";
  if (pathname.startsWith("/salons/")) return "nav.salons";
  if (pathname.startsWith("/salons")) return "nav.salons";
  if (pathname.startsWith("/call-center-agents")) return "nav.callCenterAgents";
  if (pathname.startsWith("/calls/")) return "nav.calls";
  if (pathname.startsWith("/calls")) return "nav.calls";
  if (pathname.startsWith("/ai-logs/")) return "nav.aiLogs";
  if (pathname.startsWith("/ai-logs")) return "nav.aiLogs";
  if (pathname.startsWith("/health")) return "nav.health";
  return "layout.platform";
};

export const AdminLayout = ({
  onLogout,
  userName,
  children
}: {
  onLogout: () => void;
  userName: string;
  children: React.ReactNode;
}) => {
  const location = useLocation();
  const { t } = useI18n();
  const title = t(toTitleKey(location.pathname));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/dashboard" className="brand">
          <img className="brand-logo" src="/assets/brand/fastaibooking-logo.svg" alt={t("app.name")} />
          <div className="brand-copy">
            <strong>{t("app.name")}</strong>
            <span>{t("layout.platform")}</span>
          </div>
        </Link>
        <p className="sidebar-note">{t("layout.sidebarNote")}</p>
        <nav className="nav-links">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={() =>
                isNavItemActive(location.pathname, item.to) ? "nav-item active" : "nav-item"
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">{t("layout.platform")}</p>
            <h1>{title}</h1>
            <p className="page-lead">{t("layout.subtitle")}</p>
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher />
            <span className="topbar-user">{userName}</span>
            <button type="button" className="button-secondary" onClick={onLogout}>
              {t("layout.logout")}
            </button>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
};
