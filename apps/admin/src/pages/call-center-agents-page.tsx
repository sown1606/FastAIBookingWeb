import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
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
      notify("success", t("agents.created"));
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
      <section className="card page-hero">
        <div className="section-header">
          <div>
            <p className="eyebrow">{t("nav.callCenterAgents")}</p>
            <h2>{t("agents.title")}</h2>
            <p className="muted">{t("agents.hint")}</p>
          </div>
          <span className="status-pill info">{agents.length} agent</span>
        </div>
        <div className="hero-stats">
          <article className="hero-stat-card">
            <span>{t("agents.active")}</span>
            <strong>{agents.filter((agent) => agent.isActive).length}</strong>
          </article>
          <article className="hero-stat-card">
            <span>{t("agents.assignedSalonCount")}</span>
            <strong>{agents.filter((agent) => agent.callCenterAssignments.length > 0).length}</strong>
          </article>
        </div>
      </section>

      <section className="card">
        <div>
          <h3>{t("agents.createTitle")}</h3>
          <p className="muted">{t("agents.createHint")}</p>
        </div>
        <form className="form-grid two-columns" onSubmit={createAgent}>
          <label className="field">
            <span>{t("salonCreate.ownerName")}</span>
            <input
              value={form.fullName}
              onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("common.email")}</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("common.phone")}</span>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("agents.password")}</span>
            <input
              type="password"
              minLength={8}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          <button type="submit" className="button-primary">
            {t("common.create")}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>{t("agents.listTitle")}</h2>
          <div className="summary-badges">
            <span className="summary-badge">
              {t("agents.active")}: {agents.filter((agent) => agent.isActive).length}
            </span>
            <span className="summary-badge">
              {t("agents.assignedSalonCount")}: {agents.filter((agent) => agent.callCenterAssignments.length > 0).length}
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
                    {agent.isActive ? t("agents.active") : t("agents.inactive")}
                  </span>
                </div>
                <div className="table-meta">
                  <span>{agent.email}</span>
                  <span>{agent.phone ?? t("common.none")}</span>
                </div>
                <div className="meta-grid">
                  <div>
                    <span className="muted">{t("agents.assignedSalonCount")}</span>
                    <strong>{agent.callCenterAssignments.length}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("agents.lastUpdated")}</span>
                    <strong>{t("common.notAvailable")}</strong>
                  </div>
                </div>
                <div className="summary-badges">
                  {agent.callCenterAssignments.length ? (
                    agent.callCenterAssignments.map((item) => (
                      <span key={item.salon.id} className="summary-badge">
                        {item.salon.name}
                      </span>
                    ))
                  ) : (
                    <span className="summary-badge">{t("agents.unassigned")}</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message={t("agents.none")} />
        )}
      </section>
    </div>
  );
};
