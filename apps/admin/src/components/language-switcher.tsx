import { useI18n } from "../lib/i18n";

export const LanguageSwitcher = () => {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className="language-switcher">
      <span className="sr-only">{t("language.label")}</span>
      <select value={locale} onChange={(event) => setLocale(event.target.value as "vi" | "en")}>
        <option value="vi">{t("language.vi")}</option>
        <option value="en">{t("language.en")}</option>
      </select>
    </label>
  );
};
