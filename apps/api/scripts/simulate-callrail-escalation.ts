import { buildCallRailEvent, findEscalationScenario, loadCallSessionState, prisma, simulateCallLifecycle } from "./callrail-simulator.shared";

const main = async () => {
  const scenario = await findEscalationScenario();
  const callId = `simulate-escalation-${Date.now()}`;
  const callerPhone = "+12125550992";
  const startedAt = new Date();
  const answeredAt = new Date(startedAt.getTime() + 8_000);
  const endedAt = new Date(answeredAt.getTime() + 150_000);

  const transcript = [
    "Hi, I need a live person.",
    "Please connect me to an operator about changing my appointment.",
    `My phone number is ${callerPhone}.`
  ].join(" ");

  const results = await simulateCallLifecycle([
    buildCallRailEvent({
      callId,
      eventId: `${callId}-pre-call`,
      eventType: "pre-call",
      callerPhone,
      trackingNumber: scenario.salon.customerIncomingPhoneNumber ?? "",
      originalPhoneNumber: scenario.salon.originalPhoneNumber ?? scenario.salon.contactPhone ?? "",
      startedAt,
      answered: false,
      tags: ["voice-assist", "live-person-request", "mvp"]
    }),
    buildCallRailEvent({
      callId,
      eventId: `${callId}-routing-complete`,
      eventType: "call-routing-complete",
      callerPhone,
      trackingNumber: scenario.salon.customerIncomingPhoneNumber ?? "",
      originalPhoneNumber: scenario.salon.originalPhoneNumber ?? scenario.salon.contactPhone ?? "",
      startedAt,
      answeredAt,
      answered: true,
      tags: ["voice-assist", "live-person-request", "mvp"]
    }),
    buildCallRailEvent({
      callId,
      eventId: `${callId}-post-call`,
      eventType: "post-call",
      callerPhone,
      trackingNumber: scenario.salon.customerIncomingPhoneNumber ?? "",
      originalPhoneNumber: scenario.salon.originalPhoneNumber ?? scenario.salon.contactPhone ?? "",
      startedAt,
      answeredAt,
      endedAt,
      durationSeconds: 150,
      answered: true,
      callSummary: "Voice Assist completed the call and a transcript update is expected.",
      recordingUrl: `https://example.com/recordings/${callId}.mp3`,
      tags: ["voice-assist", "live-person-request", "mvp"]
    }),
    buildCallRailEvent({
      callId,
      eventId: `${callId}-call-modified`,
      eventType: "call-modified",
      callerPhone,
      trackingNumber: scenario.salon.customerIncomingPhoneNumber ?? "",
      originalPhoneNumber: scenario.salon.originalPhoneNumber ?? scenario.salon.contactPhone ?? "",
      startedAt,
      answeredAt,
      endedAt,
      durationSeconds: 150,
      answered: true,
      transcript,
      transcriptSummary: "Caller requested a live person to help with an appointment change.",
      callSummary: "Live-person intent detected after the transcript arrived.",
      recordingUrl: `https://example.com/recordings/${callId}.mp3`,
      tags: ["voice-assist", "live-person-request", "mvp"]
    })
  ]);

  const finalEvent = results[results.length - 1];
  if (!finalEvent?.callSessionId) {
    throw new Error("CallRail escalation simulation did not create a call session.");
  }

  const callSession = await loadCallSessionState(finalEvent.callSessionId);
  const latestEscalation = callSession.callEscalations[0] ?? null;
  const latestAttempt = callSession.bookingAttempts[0] ?? null;

  if (!latestEscalation) {
    throw new Error("CallRail escalation simulation did not create a call escalation.");
  }

  console.log(
    JSON.stringify(
      {
        simulator: "callrail-escalation",
        salon: {
          id: callSession.salon?.id ?? scenario.salon.id,
          name: callSession.salon?.name ?? scenario.salon.name
        },
        callSessionId: callSession.id,
        providerCallId: callSession.providerCallId,
        webhookEventsAccepted: results.map((result) => ({
          providerCallId: result.providerCallId,
          status: result.status,
          isDuplicateEvent: result.isDuplicateEvent
        })),
        bookingAttempt: latestAttempt
          ? {
              id: latestAttempt.id,
              status: latestAttempt.status,
              failureReason: latestAttempt.failureReason
            }
          : null,
        escalation: {
          id: latestEscalation.id,
          status: latestEscalation.status,
          routingOutcome: latestEscalation.routingOutcome,
          customerPhone: latestEscalation.customerPhone,
          requestedAt: latestEscalation.requestedAt.toISOString(),
          queuedAt: latestEscalation.queuedAt?.toISOString() ?? null
        },
        transcriptCount: callSession.transcripts.length,
        aiInteractionCount: callSession.aiInteractions.length
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
