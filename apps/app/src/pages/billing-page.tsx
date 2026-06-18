import { useI18n } from "../lib/i18n";

export const BillingPage = () => {
  const { t } = useI18n();

  return (
    <div className="stack">
      <section className="card">
        <h2>{t("billing.title")}</h2>
        <p className="muted">{t("billing.hint")}</p>
        <div className="pricing-list">
          <strong>{t("pricing.aiOnly")}</strong>
          <strong>{t("pricing.operatorAddon")}</strong>
          <strong>{t("pricing.trial")}</strong>
        </div>
      </section>
    </div>
  );
};
