import { Link, NavLink, useLocation } from "react-router-dom";
import { DemoAvatar } from "./avatar";
import { LanguageSwitcher } from "./language-switcher";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type { AuthUser } from "../types";

const ownerNav = [
  { to: "/dashboard", labelKey: "nav.dashboard" },
  { to: "/salon-profile", labelKey: "nav.salonProfile" },
  { to: "/staff", labelKey: "nav.staff" },
  { to: "/services", labelKey: "nav.services" },
  { to: "/business-hours", labelKey: "nav.businessHours" },
  { to: "/customers", labelKey: "nav.customers" },
  { to: "/appointments", labelKey: "nav.appointments" },
  { to: "/availability", labelKey: "nav.availability" },
  { to: "/messages", labelKey: "nav.messages" },
  { to: "/alerts", labelKey: "nav.alerts" },
  { to: "/calls", labelKey: "nav.calls" },
  { to: "/ai-logs", labelKey: "nav.aiLogs" },
  { to: "/billing", labelKey: "nav.billing" }
];

const staffNav = [
  { to: "/dashboard", labelKey: "nav.today" },
  { to: "/appointments", labelKey: "nav.appointments" },
  { to: "/availability", labelKey: "nav.availability" },
  { to: "/messages", labelKey: "nav.messages" },
  { to: "/my-profile", labelKey: "nav.profile" }
];

const callCenterNav = [
  { to: "/call-center", labelKey: "nav.callCenter" },
  { to: "/dashboard", labelKey: "nav.dashboard" }
];

const resolveTitleKey = (pathname: string): TranslationKey => {
  if (pathname === "/dashboard") return "nav.dashboard";
  if (pathname.startsWith("/salon-profile")) return "nav.salonProfile";
  if (pathname.startsWith("/staff")) return "nav.staff";
  if (pathname.startsWith("/services")) return "nav.services";
  if (pathname.startsWith("/business-hours")) return "nav.businessHours";
  if (pathname.startsWith("/customers")) return "nav.customers";
  if (pathname.startsWith("/appointments")) return "nav.appointments";
  if (pathname.startsWith("/availability")) return "nav.availability";
  if (pathname.startsWith("/billing")) return "nav.billing";
  if (pathname.startsWith("/calls")) return "nav.calls";
  if (pathname.startsWith("/ai-logs")) return "nav.aiLogs";
  if (pathname.startsWith("/messages")) return "nav.messages";
  if (pathname.startsWith("/alerts")) return "nav.alerts";
  if (pathname.startsWith("/call-center")) return "nav.callCenter";
  if (pathname.startsWith("/my-profile")) return "nav.profile";
  return "app.name";
};

export const AppLayout = ({
  user,
  onLogout,
  children
}: {
  user: AuthUser;
  onLogout: () => void;
  children: React.ReactNode;
}) => {
  const location = useLocation();
  const { t } = useI18n();
  const nav =
    user.role === "SALON_OWNER"
      ? ownerNav
      : user.role === "CALL_CENTER_AGENT"
        ? callCenterNav
        : staffNav;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/dashboard" className="brand">
          <img src="/assets/brand/fastaibooking-logo.svg" alt={t("app.name")} />
        </Link>
        <nav className="nav-links">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-item">
              {t(item.labelKey as TranslationKey)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <h1>{t(resolveTitleKey(location.pathname))}</h1>
            <p className="muted">
              {user.role === "SALON_OWNER"
                ? t("layout.ownerSpace")
                : user.role === "CALL_CENTER_AGENT"
                  ? t("layout.operatorSpace")
                  : t("layout.staffSpace")}
            </p>
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher compact />
            <span className="user-pill">
              <DemoAvatar
                name={user.fullName}
                variant={
                  user.role === "SALON_OWNER"
                    ? "owner"
                    : user.role === "CALL_CENTER_AGENT"
                      ? "operator"
                      : "staff"
                }
                size="sm"
              />
              {user.fullName}
            </span>
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
