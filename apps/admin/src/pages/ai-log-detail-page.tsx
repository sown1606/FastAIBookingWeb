import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { downloadJsonFile, safeFilenamePart, toUtcTimestampForFilename } from "../lib/download-json";
import { copyTextToClipboard } from "../lib/clipboard";
import { stringifyDebugJson } from "../lib/debug-export";
import { formatDateTime } from "../lib/format";
import { getStatusLabel, useI18n } from "../lib/i18n";

interface AiLogDetail {
  id: string;
  provider: string;
  model: string | null;
  taskType: string;
  requestText: string | null;
  responseText: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
  parsedOutput: unknown;
  isValid: boolean;
  validationErrors: unknown;
  confidence: number | null;
  createdAt: string;
  salon: {
    id: string;
    name: string;
  } | null;
  callSession: {
    id: string;
    status: string;
    routingOutcome: string | null;
    finalResolution: string | null;
  } | null;
  bookingAttempt: {
    id: string;
    status: string;
    failureReason: string | null;
  } | null;
  transcript: {
    id: string;
    transcriptSource: string;
    transcriptSummary: string | null;
  } | null;
}

interface AiLogDebugTimelineItem {
  aiInteractionId: string;
  currentTurnTranscript?: unknown;
  aggregatedRequestText?: unknown;
  contactId?: unknown;
  internalCallSessionId?: unknown;
  amazonConnectContactId?: unknown;
  lastAskedSlotBefore?: unknown;
  lastAskedSlotAfter?: unknown;
  activeDtmfMenuBefore?: unknown;
  activeDtmfMenuAfter?: unknown;
  activeDtmfOptionsBefore?: unknown;
  activeDtmfOptionsAfter?: unknown;
  inputMode?: unknown;
  slotToElicit?: unknown;
  responseText?: unknown;
  dtmfRouting?: unknown;
  dtmfDiagnostics?: unknown;
  slotDecisions?: unknown;
  trustedSlotsBefore?: unknown;
  trustedSlotsAfter?: unknown;
  ignoredUngroundedSlots?: unknown;
  ignoredPollutedSlots?: unknown;
  ignoredNoiseFields?: unknown;
}

interface AiLogCallDebug {
  contactIds?: string[];
  timeline?: AiLogDebugTimelineItem[];
}

const routingLabelKeyByValue = {
  SALON_RING: "routing.SALON_RING",
  AI_RECEPTION: "routing.AI_RECEPTION",
  CALL_CENTER_ESCALATION: "routing.CALL_CENTER_ESCALATION",
  CALLBACK_REQUEST: "routing.CALLBACK_REQUEST",
  SMS_FALLBACK: "routing.SMS_FALLBACK",
  VOICEMAIL: "routing.VOICEMAIL",
  QUEUED: "routing.QUEUED"
} as const;

export const AiLogDetailPage = () => {
  const { t } = useI18n();
  const { notify } = useToast();
  const { id } = useParams<{ id: string }>();
  const [log, setLog] = useState<AiLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [callDebug, setCallDebug] = useState<AiLogCallDebug | null>(null);

  const translateStatus = (value: string | null | undefined) => {
    if (!value) {
      return t("common.none");
    }
    const key = getStatusLabel(value);
    return key ? t(key) : value;
  };

  const translateRouting = (value: string | null | undefined) => {
    if (!value) {
      return t("common.none");
    }
    const key = routingLabelKeyByValue[value as keyof typeof routingLabelKeyByValue];
    return key ? t(key) : value;
  };

  const load = async () => {
    if (!id) {
      setError(t("aiLogs.missingId"));
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const [response, debugResponse] = await Promise.all([
        apiGet<AiLogDetail>(`/api/v1/admin/ai-logs/${id}`),
        apiGet<AiLogCallDebug>(`/api/v1/admin/ai-logs/${id}/debug`)
      ]);
      setLog(response);
      setCallDebug(debugResponse);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const selectedDebugTurn = log
    ? [...(callDebug?.timeline ?? [])].reverse().find((item) => item.aiInteractionId === log.id)
    : undefined;
  const selectedTurnIndex =
    callDebug?.timeline?.findIndex((item) => item === selectedDebugTurn) ?? -1;
  const turnCount = callDebug?.timeline?.length ?? 0;

  const copyFullDebug = async () => {
    if (!id) return;
    setCopyStatus("");
    try {
      const response = await apiGet<unknown>(`/api/v1/admin/ai-logs/${id}/debug`);
      await copyTextToClipboard(stringifyDebugJson(response));
      setCopyStatus(t("aiLogs.debugCopied"));
    } catch (copyError) {
      setCopyStatus(extractErrorMessage(copyError));
    }
  };

  const exportDebugJson = () => {
    if (!log) return;

    try {
      const contactId = callDebug?.contactIds?.[0] ?? log.callSession?.id ?? log.id;
      const filename = `fastaibooking-ai-log-${safeFilenamePart(
        String(contactId),
        "unknown-contact"
      )}-${toUtcTimestampForFilename()}.json`;

      downloadJsonFile(filename, {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        exportType: "ai_log_debug",
        aiLog: {
          id: log.id,
          provider: log.provider,
          model: log.model,
          taskType: log.taskType,
          requestText: log.requestText,
          responseText: log.responseText,
          isValid: log.isValid,
          confidence: log.confidence,
          createdAt: log.createdAt,
          salon: log.salon,
          bookingAttempt: log.bookingAttempt,
          transcript: log.transcript
        },
        linkedCall: log.callSession,
        callDebug,
        selectedTurn: selectedDebugTurn,
        requestPayload: log.requestPayload,
        responsePayload: log.responsePayload,
        parsedOutput: log.parsedOutput,
        validationErrors: log.validationErrors
      });
      notify("success", t("aiLogs.exported"));
    } catch (exportError) {
      notify("error", extractErrorMessage(exportError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (!log) {
    return <EmptyBlock message={t("aiLogs.notFound")} />;
  }

  const stringifyDebug = (value: unknown) => JSON.stringify(value ?? null, null, 2);
  const displayDebugValue = (value: unknown) => {
    if (value === undefined || value === null || value === "") {
      return t("common.none");
    }
    return String(value);
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <h2>{t("aiLogs.detailTitle")}</h2>
          <div className="inline-actions">
            <button type="button" className="button-secondary" onClick={copyFullDebug}>
              {t("aiLogs.copyDebug")}
            </button>
            <button type="button" className="button-secondary" onClick={exportDebugJson}>
              {t("common.exportJson")}
            </button>
          </div>
        </div>
        {copyStatus ? <p className="muted">{copyStatus}</p> : null}
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("aiLogs.taskType")}</span>
            <strong>{log.taskType}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.providerModel")}</span>
            <strong>
              {log.provider} {log.model ? `/ ${log.model}` : ""}
            </strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.validation")}</span>
            <strong>{log.isValid ? t("common.yes") : t("common.no")}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.confidence")}</span>
            <strong>{log.confidence ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.created")}</span>
            <strong>{formatDateTime(log.createdAt)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>{t("aiLogs.linkedRecords")}</h3>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("aiLogs.salon")}</span>
            <strong>{log.salon?.name ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.callSession")}</span>
            <strong>{log.callSession?.id ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.amazonConnectContactId")}</span>
            <strong>{callDebug?.contactIds?.[0] ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.callOutcome")}</span>
            <strong>{translateRouting(log.callSession?.routingOutcome)}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.bookingAttempt")}</span>
            <strong>{translateStatus(log.bookingAttempt?.status)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>{t("aiLogs.phoneTurnDebug")}</h3>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("aiLogs.currentTurnTranscript")}</span>
            <strong>{displayDebugValue(selectedDebugTurn?.currentTurnTranscript)}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.aggregatedRequestText")}</span>
            <strong>{displayDebugValue(selectedDebugTurn?.aggregatedRequestText)}</strong>
          </div>
          <div>
            <span className="muted">ContactId</span>
            <strong>{displayDebugValue(selectedDebugTurn?.contactId ?? callDebug?.contactIds?.[0])}</strong>
          </div>
          <div>
            <span className="muted">Turn</span>
            <strong>
              {turnCount ? `${selectedTurnIndex + 1} / ${turnCount}` : t("common.none")}
            </strong>
          </div>
          <div>
            <span className="muted">Input mode</span>
            <strong>{displayDebugValue(selectedDebugTurn?.inputMode)}</strong>
          </div>
          <div>
            <span className="muted">Slot to elicit</span>
            <strong>{displayDebugValue(selectedDebugTurn?.slotToElicit)}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.lastAskedSlot")}</span>
            <strong>
              {displayDebugValue(selectedDebugTurn?.lastAskedSlotBefore)} /{" "}
              {displayDebugValue(selectedDebugTurn?.lastAskedSlotAfter)}
            </strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.activeDtmfMenu")}</span>
            <strong>
              {displayDebugValue(selectedDebugTurn?.activeDtmfMenuBefore)} /{" "}
              {displayDebugValue(selectedDebugTurn?.activeDtmfMenuAfter)}
            </strong>
          </div>
        </div>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>{t("aiLogs.dtmfRouting")}</h3>
          <pre>{stringifyDebug(selectedDebugTurn?.dtmfRouting)}</pre>
        </article>
        <article className="card">
          <h3>Raw DTMF diagnostics</h3>
          <pre>{stringifyDebug(selectedDebugTurn?.dtmfDiagnostics)}</pre>
        </article>
        <article className="card">
          <h3>Slot decisions</h3>
          <pre>{stringifyDebug(selectedDebugTurn?.slotDecisions)}</pre>
        </article>
        <article className="card">
          <h3>Trusted slots</h3>
          <pre>
            {stringifyDebug({
              before: selectedDebugTurn?.trustedSlotsBefore,
              after: selectedDebugTurn?.trustedSlotsAfter
            })}
          </pre>
        </article>
        <article className="card">
          <h3>{t("aiLogs.ignoredSlotsNoise")}</h3>
          <pre>
            {stringifyDebug({
              ignoredUngroundedSlots: selectedDebugTurn?.ignoredUngroundedSlots,
              ignoredPollutedSlots: selectedDebugTurn?.ignoredPollutedSlots,
              ignoredNoiseFields: selectedDebugTurn?.ignoredNoiseFields
            })}
          </pre>
        </article>
      </section>

      {callDebug?.timeline?.length ? (
        <section className="card">
          <h3>Turn history</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Turn</th>
                  <th>Caller said</th>
                  <th>Response</th>
                  <th>Last asked</th>
                  <th>DTMF</th>
                  <th>Slot</th>
                </tr>
              </thead>
              <tbody>
                {callDebug.timeline.map((turn, index) => (
                  <tr key={`${String(turn.aiInteractionId)}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{displayDebugValue(turn.currentTurnTranscript)}</td>
                    <td>{displayDebugValue(turn.responseText)}</td>
                    <td>
                      {displayDebugValue(turn.lastAskedSlotBefore)} /{" "}
                      {displayDebugValue(turn.lastAskedSlotAfter)}
                    </td>
                    <td>
                      {displayDebugValue(turn.activeDtmfMenuBefore)} /{" "}
                      {displayDebugValue(turn.activeDtmfMenuAfter)}
                    </td>
                    <td>{displayDebugValue(turn.slotToElicit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h3>{t("aiLogs.requestText")}</h3>
        <pre>{log.requestText ?? t("common.none")}</pre>
      </section>

      <section className="card">
        <h3>{t("aiLogs.responseText")}</h3>
        <pre>{log.responseText ?? t("common.none")}</pre>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>{t("aiLogs.parsedOutput")}</h3>
          <pre>{JSON.stringify(log.parsedOutput ?? null, null, 2)}</pre>
        </article>
        <article className="card">
          <h3>{t("aiLogs.validationErrors")}</h3>
          <pre>{JSON.stringify(log.validationErrors ?? null, null, 2)}</pre>
        </article>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>{t("aiLogs.requestPayload")}</h3>
          <pre>{JSON.stringify(log.requestPayload ?? null, null, 2)}</pre>
        </article>
        <article className="card">
          <h3>{t("aiLogs.responsePayload")}</h3>
          <pre>{JSON.stringify(log.responsePayload ?? null, null, 2)}</pre>
        </article>
      </section>
    </div>
  );
};
