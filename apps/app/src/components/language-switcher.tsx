import { useI18n } from "../lib/i18n";

export const LanguageSwitcher = ({ compact = false }: { compact?: boolean }) => {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className={compact ? "language-switcher compact" : "language-switcher"}>
      <select
        aria-label={t("language.label")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as "vi" | "en")}
      >
        <option value="vi">{t("language.vi")}</option>
        <option value="en">{t("language.en")}</option>
      </select>
    </label>
  );
};
