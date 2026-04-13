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
      await apiPost<unknown, unknown>("/api/v1/admin/call-center/agents", {
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        password: form.password || undefined
      });
      setForm({ fullName: "", email: "", phone: "", password: "" });
      notify("success", "Đã tạo tài khoản tổng đài.");
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
        <h2>Nhân sự tổng đài</h2>
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
              inputMode="numeric"
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
            Tạo tài khoản
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Tài khoản tổng đài</h2>
        {agents.length ? (
          <div className="mobile-list">
            {agents.map((agent) => (
              <article key={agent.id} className="mobile-item">
                <strong>{agent.fullName}</strong>
                <span>{agent.email}</span>
                <span>{agent.phone ?? "-"}</span>
                <small>
                  Tiệm được phân công:{" "}
                  {agent.callCenterAssignments.map((item) => item.salon.name).join(", ") || "-"}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message="Chưa có tài khoản tổng đài." />
        )}
      </section>
    </div>
  );
};
