export const CRITICAL_CASE_IDS = ["C01", "C02", "C03", "C04", "C05", "C06"];
export const SAFETY_CASE_IDS = ["S01", "S02", "S03", "S04"];

export const MANDATORY_METRICS = [
  "serviceCaptureResult",
  "staffCaptureResult",
  "dateAccuracy",
  "timeAccuracy",
  "clarificationCount",
  "wrongServiceAutoCommitCount",
  "wrongStaffAutoCommitCount",
  "appointmentBeforeFinalConfirmationCount",
  "silentTurnCount",
  "groundedFieldLossCount",
  "repeatedLongMenuCount",
  "autoTransferWithoutRequestCount",
  "duplicateAppointmentCount",
  "lambdaProcessingMs",
  "apiProcessingMs",
  "callerTurnToPromptMs",
  "promptPlaybackEvidence"
];

export const CASE_DEFINITIONS = {
  C01: {
    kind: "critical",
    title: "one-shot exact booking frame",
    expected: {
      serviceName: "Full Set",
      dateOffsetDays: 1,
      requestedTime: "15:00",
      staffPreference: "Any staff"
    }
  },
  C02: {
    kind: "critical",
    title: "slow segmented speech and no silence",
    expected: {
      serviceName: "Full Set",
      dateOffsetDays: 1,
      requestedTime: "15:00",
      staffPreference: "Any staff"
    }
  },
  C03: {
    kind: "critical",
    title: "out-of-order staff preference",
    expected: {
      serviceName: "Full Set",
      dateOffsetDays: 1,
      requestedTime: "15:00",
      staffPreference: "Any staff",
      requireOutOfOrderStaffRetention: true
    }
  },
  C04: {
    kind: "critical",
    title: "final-confirmation staff correction",
    expected: {
      serviceName: "Full Set",
      dateOffsetDays: 1,
      requestedTime: "15:00",
      staffPreference: "Any staff",
      requireFinalStaffCorrection: true
    }
  },
  C05: {
    kind: "critical",
    title: "guarded ASR repair",
    expected: {
      noWrongAutoCommit: true,
      maxClarifications: 1
    }
  },
  C06: {
    kind: "critical",
    title: "DTMF fallback isolation",
    expected: {
      requireDtmfIsolation: true
    }
  },
  S01: {
    kind: "safety",
    title: "reminder request is not Full Set",
    expected: {
      forbiddenServiceName: "Full Set"
    }
  },
  S02: {
    kind: "safety",
    title: "top priority is not Any staff",
    expected: {
      forbiddenStaffPreference: "Any staff"
    }
  },
  S03: {
    kind: "safety",
    title: "negative service proposal clears only proposal",
    expected: {
      requireRejectedServiceProposal: true
    }
  },
  S04: {
    kind: "safety",
    title: "finite audible no-input/backend recovery",
    expected: {
      requireFiniteRecovery: true
    }
  },
  R01: {
    kind: "regression",
    title: "exact date and time recognition"
  },
  R02: {
    kind: "regression",
    title: "named staff recognition"
  },
  R03: {
    kind: "regression",
    title: "known caller state"
  },
  R04: {
    kind: "regression",
    title: "unavailable slot alternatives"
  },
  R05: {
    kind: "regression",
    title: "explicit correction"
  },
  R06: {
    kind: "regression",
    title: "final confirmation idempotency"
  },
  R07: {
    kind: "regression",
    title: "duplicate caller turns"
  }
};

export const isKnownReleaseCase = (caseId) =>
  Object.prototype.hasOwnProperty.call(CASE_DEFINITIONS, caseId);
