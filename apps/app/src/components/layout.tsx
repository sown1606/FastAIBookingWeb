import { Link, NavLink, useLocation } from "react-router-dom";
import { DemoAvatar } from "./avatar";
import { LanguageSwitcher } from "./language-switcher";
import { NotificationBell } from "./notification-bell";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { useUiMode } from "../lib/ui-mode";
import type { AuthUser } from "../types";

const ownerBasicNav = [
  { to: "/dashboard", labelKey: "nav.dashboard" },
  { to: "/appointments", labelKey: "nav.appointments" },
  { to: "/customers", labelKey: "nav.customers" },
  { to: "/services", labelKey: "nav.services" },
  { to: "/staff", labelKey: "nav.staff" },
  { to: "/alerts", labelKey: "nav.alerts" },
  { to: "/salon-profile", labelKey: "nav.salonProfile" }
];

const ownerNav = [
  { to: "/dashboard", labelKey: "nav.dashboard" },
  { to: "/appointments", labelKey: "nav.appointments" },
  { to: "/customers", labelKey: "nav.customers" },
  { to: "/staff", labelKey: "nav.staff" },
  { to: "/services", labelKey: "nav.services" },
  { to: "/business-hours", labelKey: "nav.businessHours" },
  { to: "/availability", labelKey: "nav.availability" },
  { to: "/salon-profile", labelKey: "nav.salonProfile" },
  { to: "/billing", labelKey: "nav.billing" },
  { to: "/messages", labelKey: "nav.messages" },
  { to: "/alerts", labelKey: "nav.alerts" }
];

const staffNav = [
  { to: "/dashboard", labelKey: "nav.today" },
  { to: "/appointments", labelKey: "nav.appointments" },
  { to: "/my-profile", labelKey: "nav.profile" }
];

const callCenterNav = [
  { to: "/call-center", labelKey: "nav.callCenter" }
];

const isCallCenterRole = (role: AuthUser["role"]) =>
  role === "CALL_CENTER_AGENT";

const normalizePathname = (pathname: string) => {
  const clean = pathname.split(/[?#]/)[0] || "/";
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
};

const isRouteActive = (pathname: string, target: string) => {
  const current = normalizePathname(pathname);
  const normalizedTarget = normalizePathname(target);
  return current === normalizedTarget || current.startsWith(`${normalizedTarget}/`);
};

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
  const { isBasicMode } = useUiMode();
  const nav =
    user.role === "SALON_OWNER"
      ? isBasicMode
        ? ownerBasicNav
        : ownerNav
      : isCallCenterRole(user.role)
        ? callCenterNav
        : staffNav;
  const roleLabel =
    user.role === "SALON_OWNER"
      ? t("layout.ownerSpace")
      : isCallCenterRole(user.role)
        ? t("layout.operatorSpace")
        : t("layout.staffSpace");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/dashboard" className="brand">
          <img src="/assets/brand/fastaibooking-logo.svg" alt={t("app.name")} />
        </Link>
        <nav className="nav-links">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `nav-item${isActive && isRouteActive(location.pathname, item.to) ? " active" : ""}`
              }
            >
              {t(item.labelKey as TranslationKey)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-copy">
            <h1>{t(resolveTitleKey(location.pathname))}</h1>
            <div className="topbar-meta">
              <p className="muted">{roleLabel}</p>
              <span className="role-chip">{user.email}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <NotificationBell />
            <LanguageSwitcher compact />
            <span className="user-pill">
              <DemoAvatar
                name={user.fullName}
                variant={
                  user.role === "SALON_OWNER"
                    ? "owner"
                    : isCallCenterRole(user.role)
                      ? "operator"
                      : "staff"
                }
                size="sm"
              />
              <span>{user.fullName}</span>
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
