import { Link, NavLink, useLocation } from "react-router-dom";

const navItems = [
  { to: "/dashboard", label: "Tổng quan" },
  { to: "/salons", label: "Tiệm nail" },
  { to: "/salons/new", label: "Tạo tiệm" },
  { to: "/call-center-agents", label: "Tổng đài VN" },
  { to: "/calls", label: "Nhật ký gọi" },
  { to: "/ai-logs", label: "Nhật ký AI" },
  { to: "/health", label: "Sức khỏe hệ thống" }
];

const toTitle = (pathname: string): string => {
  if (pathname === "/dashboard") return "Tổng quan";
  if (pathname.startsWith("/salons/new")) return "Tạo tiệm nail";
  if (pathname.startsWith("/salons/")) return "Chi tiết tiệm";
  if (pathname.startsWith("/salons")) return "Tiệm nail";
  if (pathname.startsWith("/call-center-agents")) return "Tổng đài VN";
  if (pathname.startsWith("/calls/")) return "Chi tiết cuộc gọi";
  if (pathname.startsWith("/calls")) return "Nhật ký cuộc gọi";
  if (pathname.startsWith("/ai-logs/")) return "Chi tiết AI";
  if (pathname.startsWith("/ai-logs")) return "Nhật ký AI";
  if (pathname.startsWith("/health")) return "Sức khỏe hệ thống";
  return "Quản trị";
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
  const title = toTitle(location.pathname);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/dashboard" className="brand">
          FastAIBooking Admin
        </Link>
        <nav className="nav-links">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-item">
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p className="muted">Quản trị nền tảng, tiệm nail và vận hành tổng đài</p>
          </div>
          <div className="topbar-actions">
            <span className="muted">{userName}</span>
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
