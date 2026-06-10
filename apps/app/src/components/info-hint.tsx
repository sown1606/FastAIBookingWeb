export const InfoHint = ({ text }: { text: string }) => (
  <span className="info-hint" tabIndex={0} aria-label={text}>
    ?
    <span className="info-hint-bubble" role="tooltip">
      {text}
    </span>
  </span>
);
