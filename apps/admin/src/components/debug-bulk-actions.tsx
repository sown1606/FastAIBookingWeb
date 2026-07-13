import { useI18n } from "../lib/i18n";

interface DebugBulkActionsProps {
  selectedCount: number;
  totalVisible: number;
  busy: boolean;
  onCopy: () => void;
  onExport: () => void;
  onClear: () => void;
}

export const DebugBulkActions = ({
  selectedCount,
  totalVisible,
  busy,
  onCopy,
  onExport,
  onClear
}: DebugBulkActionsProps) => {
  const { t } = useI18n();
  const disabled = busy || selectedCount === 0;

  return (
    <div className="bulk-debug-toolbar" aria-live="polite">
      <div className="bulk-debug-toolbar__count">
        <strong>{t("debugBulk.selectedCount", { count: selectedCount })}</strong>
        {busy ? <span>{t("debugBulk.preparing", { count: selectedCount })}</span> : null}
        {!busy && totalVisible > 0 ? <span>{t("debugBulk.visibleCount", { count: totalVisible })}</span> : null}
      </div>
      <div className="bulk-debug-toolbar__actions">
        <button
          type="button"
          className="button-secondary"
          onClick={onCopy}
          disabled={disabled}
          aria-label={t("debugBulk.copyJson")}
        >
          {busy ? t("debugBulk.preparingShort") : t("debugBulk.copyJson")}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={onExport}
          disabled={disabled}
          aria-label={t("debugBulk.exportJson")}
        >
          {t("debugBulk.exportJson")}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={onClear}
          disabled={busy || selectedCount === 0}
          aria-label={t("debugBulk.clearSelection")}
        >
          {t("debugBulk.clear")}
        </button>
      </div>
    </div>
  );
};
