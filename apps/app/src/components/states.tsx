import { useI18n } from "../lib/i18n";

export const LoadingBlock = ({ message }: { message?: string }) => {
  const { t } = useI18n();
  return (
    <div className="state-block state-loading">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{message ?? t("common.loading")}</span>
    </div>
  );
};

export const ErrorBlock = ({
  message,
  onRetry
}: {
  message: string;
  onRetry?: () => void;
}) => {
  const { t } = useI18n();
  return (
    <div className="state-block state-error">
      <div>{message}</div>
      {onRetry ? (
        <button type="button" className="button-secondary" onClick={onRetry}>
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
};

export const EmptyBlock = ({ message }: { message: string }) => {
  return <div className="state-block state-empty">{message}</div>;
};
