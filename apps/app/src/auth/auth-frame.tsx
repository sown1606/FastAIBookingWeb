import type { ReactNode } from "react";
import { LanguageSwitcher } from "../components/language-switcher";
import { useI18n } from "../lib/i18n";

export const AuthFrame = ({
  children,
  wide = false
}: {
  children: ReactNode;
  wide?: boolean;
}) => {
  const { t } = useI18n();

  return (
    <div className="auth-page">
      <div className="auth-background" aria-hidden="true" />
      <div className={wide ? "auth-shell wide" : "auth-shell"}>
        <section className="auth-brand-panel">
          <img className="auth-logo" src="/assets/brand/fastaibooking-logo.svg" alt={t("app.name")} />
          <div className="auth-brand-copy">
            <p className="eyebrow">{t("app.tagline")}</p>
            <h1>{t("app.subtitle")}</h1>
          </div>
          <div className="auth-proof-card">
            <strong>5+</strong>
            <span>{t("billing.rule")}</span>
          </div>
        </section>
        <section className={wide ? "auth-card large" : "auth-card"}>
          <div className="auth-card-top">
            <img className="auth-card-logo" src="/assets/brand/fastaibooking-mark.svg" alt="" />
            <LanguageSwitcher compact />
          </div>
          {children}
        </section>
      </div>
    </div>
  );
};
