export const LoadingBlock = ({ message = "Đang tải..." }: { message?: string }) => {
  return <div className="state-block">{message}</div>;
};

export const ErrorBlock = ({
  message,
  onRetry
}: {
  message: string;
  onRetry?: () => void;
}) => {
  return (
    <div className="state-block state-error">
      <div>{message}</div>
      {onRetry ? (
        <button type="button" className="button-secondary" onClick={onRetry}>
          Thử lại
        </button>
      ) : null}
    </div>
  );
};

export const EmptyBlock = ({ message }: { message: string }) => {
  return <div className="state-block state-empty">{message}</div>;
};
