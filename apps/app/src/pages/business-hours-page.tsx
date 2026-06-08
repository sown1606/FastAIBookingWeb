import { useEffect, useState } from "react";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { useI18n, type TranslationKey } from "../lib/i18n";

interface BusinessHour {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
}

const defaultHours = (): BusinessHour[] => [
  { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
  { dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 4, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 5, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "16:00" }
];

export const BusinessHoursPage = () => {
  const { notify } = useToast();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hours, setHours] = useState<BusinessHour[]>(defaultHours());

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await apiGet<BusinessHour[]>("/api/v1/business-hours");
      setHours(response.length === 7 ? [...response].sort((a, b) => a.dayOfWeek - b.dayOfWeek) : defaultHours());
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    try {
      await apiPut<BusinessHour[], { hours: BusinessHour[] }>("/api/v1/business-hours", {
        hours
      });
      notify("success", t("hours.saved"));
      await load();
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  const todayDayOfWeek = new Date().getDay();

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <h2>{t("hours.title")}</h2>
            <p className="muted">{t("hours.overviewHint")}</p>
          </div>
          <button type="button" className="button-primary" onClick={save}>
            {t("hours.save")}
          </button>
        </div>
        <div className="summary-badges">
          <span className="summary-badge">
            {t("hours.openDays")}: {hours.filter((item) => item.isOpen).length}
          </span>
          <span className="summary-badge">
            {t("hours.closedDays")}: {hours.filter((item) => !item.isOpen).length}
          </span>
          <span className="summary-badge">
            {t("hours.weekendHours")}: {hours[6]?.openTime ?? "-"} - {hours[6]?.closeTime ?? "-"}
          </span>
        </div>
      </section>

      <section className="hours-grid">
        {hours.map((item, index) => (
          <article key={item.dayOfWeek} className={item.dayOfWeek === todayDayOfWeek ? "hours-card today" : "hours-card"}>
            <div className="hours-card-header">
              <div>
                <strong>
                  {t(`weekday.${item.dayOfWeek}` as TranslationKey)}
                  {item.dayOfWeek === todayDayOfWeek ? (
                    <span className="summary-badge">{t("common.today")}</span>
                  ) : null}
                </strong>
                <div className="muted">{item.isOpen ? t("hours.open") : t("hours.closed")}</div>
              </div>
              <label className="field checkbox-row">
                <span>{t("hours.isOpen")}</span>
                <input
                  type="checkbox"
                  checked={item.isOpen}
                  onChange={(event) =>
                    setHours((prev) =>
                      prev.map((row, rowIndex) =>
                        rowIndex === index
                          ? {
                              ...row,
                              isOpen: event.target.checked,
                              openTime: event.target.checked ? row.openTime ?? "09:00" : null,
                              closeTime: event.target.checked ? row.closeTime ?? "18:00" : null
                            }
                          : row
                      )
                    )
                  }
                />
              </label>
            </div>
            <div className="hours-time-grid">
              <label className="field">
                <span>{t("hours.openTime")}</span>
                <input
                  type="time"
                  value={item.openTime ?? ""}
                  disabled={!item.isOpen}
                  onChange={(event) =>
                    setHours((prev) =>
                      prev.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, openTime: event.target.value } : row
                      )
                    )
                  }
                />
              </label>
              <label className="field">
                <span>{t("hours.closeTime")}</span>
                <input
                  type="time"
                  value={item.closeTime ?? ""}
                  disabled={!item.isOpen}
                  onChange={(event) =>
                    setHours((prev) =>
                      prev.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, closeTime: event.target.value } : row
                      )
                    )
                  }
                />
              </label>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
};
