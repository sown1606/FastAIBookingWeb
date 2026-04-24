import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";

interface AgentItem {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  callCenterAssignments: Array<{
    salon: {
      id: string;
      name: string;
    };
  }>;
}

export const CallCenterAgentsPage = () => {
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: ""
  });

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await apiGet<AgentItem[]>("/api/v1/admin/call-center/agents");
      setAgents(result);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiPost("/api/v1/admin/call-center/agents", {
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        password: form.password || undefined
      });
      setForm({ fullName: "", email: "", phone: "", password: "" });
      notify("success", "Call center agent created.");
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <h2>Agent tổng đài</h2>
            <p className="muted">Operator dùng softphone chung trên trình duyệt và có thể được gán cho nhiều tiệm.</p>
          </div>
          <span className="status-pill info">{agents.length} agent</span>
        </div>
        <form className="form-grid two-columns" onSubmit={createAgent}>
          <label className="field">
            <span>Họ tên</span>
            <input
              value={form.fullName}
              onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Số điện thoại Mỹ</span>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Mật khẩu</span>
            <input
              type="password"
              minLength={8}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          <button type="submit" className="button-primary">
            Tạo agent
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>Danh sách operator</h2>
          <div className="summary-badges">
            <span className="summary-badge">
              Đang hoạt động: {agents.filter((agent) => agent.isActive).length}
            </span>
            <span className="summary-badge">
              Được gán ít nhất 1 tiệm: {agents.filter((agent) => agent.callCenterAssignments.length > 0).length}
            </span>
          </div>
        </div>
        {agents.length ? (
          <div className="control-center-grid">
            {agents.map((agent) => (
              <article key={agent.id} className="control-tile">
                <div className="section-header">
                  <strong>{agent.fullName}</strong>
                  <span className={agent.isActive ? "status-pill success" : "status-pill warning"}>
                    {agent.isActive ? "ACTIVE" : "INACTIVE"}
                  </span>
                </div>
                <div className="table-meta">
                  <span>{agent.email}</span>
                  <span>{agent.phone ?? "Chưa có số điện thoại"}</span>
                </div>
                <div className="summary-badges">
                  {agent.callCenterAssignments.length ? (
                    agent.callCenterAssignments.map((item) => (
                      <span key={item.salon.id} className="summary-badge">
                        {item.salon.name}
                      </span>
                    ))
                  ) : (
                    <span className="summary-badge">Chưa gán tiệm</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message="Chưa có agent tổng đài nào." />
        )}
      </section>
    </div>
  );
};
