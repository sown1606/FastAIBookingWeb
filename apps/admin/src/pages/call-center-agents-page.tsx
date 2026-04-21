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
        <h2>Human Call Center agents</h2>
        <p className="muted">Operators use the shared Amazon Connect browser softphone and can be assigned to multiple salons.</p>
        <form className="form-grid two-columns" onSubmit={createAgent}>
          <label className="field">
            <span>Full name</span>
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
            <span>US phone number</span>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              minLength={8}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          <button type="submit" className="button-primary">
            Create agent
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Assigned operators</h2>
        {agents.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Assigned salons</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td>{agent.fullName}</td>
                    <td>{agent.email}</td>
                    <td>{agent.phone ?? "-"}</td>
                    <td>{agent.isActive ? "ACTIVE" : "INACTIVE"}</td>
                    <td>{agent.callCenterAssignments.map((item) => item.salon.name).join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="No call center agents have been created yet." />
        )}
      </section>
    </div>
  );
};
