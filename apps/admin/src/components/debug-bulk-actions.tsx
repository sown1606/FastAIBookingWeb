import { useI18n } from "../lib/i18n";

interface DebugBulkActionsProps {
  selectedCount: number;
  totalVisible: number;
  busy: boolean;
  preparedByteSize?: string;
  onSelectAllVisible: () => void;
  onCopy: () => void;
  onExport: () => void;
  onExportFull?: () => void;
  onClear: () => void;
}

export const DebugBulkActions = ({
  selectedCount,
  totalVisible,
  busy,
  preparedByteSize,
  onSelectAllVisible,
  onCopy,
  onExport,
  onExportFull,
  onClear
}: DebugBulkActionsProps) => {
  const { t } = useI18n();
  const disabled = busy || selectedCount === 0;

  return (
    <div className="bulk-debug-toolbar" aria-live="polite">
      <div className="bulk-debug-toolbar__count">
        <strong>{t("debugBulk.selectedCount", { count: selectedCount })}</strong>
        {preparedByteSize ? (
          <span>{t("debugBulk.approximateSize", { size: preparedByteSize })}</span>
        ) : null}
        {busy ? <span>{t("debugBulk.preparing", { count: selectedCount })}</span> : null}
        {!busy && totalVisible > 0 ? <span>{t("debugBulk.visibleCount", { count: totalVisible })}</span> : null}
        <span>{t("debugBulk.shiftHint")}</span>
      </div>
      <div className="bulk-debug-toolbar__actions">
        <button
          type="button"
          className="button-secondary"
          onClick={onSelectAllVisible}
          disabled={busy || totalVisible === 0}
          aria-label={t("debugBulk.selectAllVisible")}
        >
          {t("debugBulk.selectAllVisible")}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={onCopy}
          disabled={disabled}
          aria-label={t("debugBulk.copyCompactJson")}
        >
          {busy ? t("debugBulk.preparingShort") : t("debugBulk.copyCompactJson")}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={onExport}
          disabled={disabled}
          aria-label={t("debugBulk.exportCompactJson")}
        >
          {t("debugBulk.exportCompactJson")}
        </button>
        {onExportFull ? (
          <button
            type="button"
            className="button-secondary"
            onClick={onExportFull}
            disabled={disabled}
            aria-label={t("debugBulk.exportFullJson")}
            title={t("debugBulk.fullExportWarning")}
          >
            {t("debugBulk.exportFullJson")}
          </button>
        ) : null}
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
