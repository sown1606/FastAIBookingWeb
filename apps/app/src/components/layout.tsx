import { Link, NavLink, useLocation } from "react-router-dom";
import type { AuthUser } from "../types";

const ownerNav = [
  { to: "/dashboard", label: "Tổng quan" },
  { to: "/salon-profile", label: "Hồ sơ tiệm" },
  { to: "/staff", label: "Nhân viên" },
  { to: "/services", label: "Dịch vụ" },
  { to: "/business-hours", label: "Giờ làm việc" },
  { to: "/customers", label: "Khách hàng" },
  { to: "/appointments", label: "Lịch hẹn" },
  { to: "/availability", label: "Giờ trống" },
  { to: "/messages", label: "Tin nhắn" },
  { to: "/alerts", label: "Cảnh báo" },
  { to: "/calls", label: "Cuộc gọi" },
  { to: "/ai-logs", label: "Nhật ký AI" },
  { to: "/billing", label: "Chi phí" }
];

const staffNav = [
  { to: "/dashboard", label: "Hôm nay" },
  { to: "/appointments", label: "Lịch của tôi" },
  { to: "/availability", label: "Giờ trống" },
  { to: "/messages", label: "Tin nhắn" },
  { to: "/my-profile", label: "Hồ sơ" }
];

const callCenterNav = [
  { to: "/call-center", label: "Tổng đài" },
  { to: "/dashboard", label: "Tổng quan" }
];

const resolveTitle = (pathname: string): string => {
  if (pathname === "/dashboard") return "Tổng quan";
  if (pathname.startsWith("/salon-profile")) return "Hồ sơ tiệm";
  if (pathname.startsWith("/staff")) return "Nhân viên";
  if (pathname.startsWith("/services")) return "Dịch vụ";
  if (pathname.startsWith("/business-hours")) return "Giờ làm việc";
  if (pathname.startsWith("/customers")) return "Khách hàng";
  if (pathname.startsWith("/appointments")) return "Lịch hẹn";
  if (pathname.startsWith("/availability")) return "Giờ trống";
  if (pathname.startsWith("/billing")) return "Chi phí";
  if (pathname.startsWith("/calls")) return "Cuộc gọi";
  if (pathname.startsWith("/ai-logs")) return "Nhật ký AI";
  if (pathname.startsWith("/messages")) return "Tin nhắn";
  if (pathname.startsWith("/alerts")) return "Cảnh báo";
  if (pathname.startsWith("/call-center")) return "Tổng đài";
  if (pathname.startsWith("/my-profile")) return "Hồ sơ";
  return "FastAIBooking";
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
          FastAIBooking
        </Link>
        <nav className="nav-links">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-item">
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <h1>{resolveTitle(location.pathname)}</h1>
            <p className="muted">
              {user.role === "SALON_OWNER"
                ? "Không gian chủ tiệm"
                : user.role === "CALL_CENTER_AGENT"
                  ? "Xử lý lịch hẹn cho tiệm được phân công"
                  : "Không gian nhân viên"}
            </p>
          </div>
          <div className="topbar-actions">
            <span className="muted">{user.fullName}</span>
            <button type="button" className="button-secondary" onClick={onLogout}>
              Thoát
            </button>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
};
