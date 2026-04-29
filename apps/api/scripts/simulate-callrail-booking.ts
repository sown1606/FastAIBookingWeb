import { buildCallRailEvent, findBookingScenario, loadCallSessionState, prisma, simulateCallLifecycle } from "./callrail-simulator.shared";

const main = async () => {
  const scenario = await findBookingScenario();
  const callId = `simulate-booking-${Date.now()}`;
  const callerPhone = "+12125550991";
  const startedAt = new Date();
  const answeredAt = new Date(startedAt.getTime() + 10_000);
  const endedAt = new Date(answeredAt.getTime() + 180_000);

  const transcript = [
    "Hi, my name is CallRail Booking Demo.",
    `I want to book ${scenario.service.name} with ${scenario.staff.fullName}.`,
    `The exact time I want is ${scenario.slot.startTime}.`,
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
      tags: ["voice-assist", "booking", "mvp"]
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
      tags: ["voice-assist", "booking", "mvp"]
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
      durationSeconds: 180,
      answered: true,
      transcript,
      transcriptSummary: `Caller requested ${scenario.service.name} at ${scenario.slot.startTime}.`,
      callSummary: `Voice Assist captured a booking request for ${scenario.service.name}.`,
      recordingUrl: `https://example.com/recordings/${callId}.mp3`,
      tags: ["voice-assist", "booking", "mvp"]
    })
  ]);

  const finalEvent = results[results.length - 1];
  if (!finalEvent?.callSessionId) {
    throw new Error("CallRail booking simulation did not create a call session.");
  }

  const callSession = await loadCallSessionState(finalEvent.callSessionId);
  const latestAttempt = callSession.bookingAttempts[0] ?? null;
  const latestAppointment = latestAttempt?.appointment ?? null;

  if (!latestAttempt) {
    throw new Error("CallRail booking simulation did not create a booking attempt.");
  }

  if (latestAttempt.status !== "SUCCESS" && !latestAttempt.failureReason) {
    throw new Error("CallRail booking simulation created a non-success attempt without a failure reason.");
  }

  console.log(
    JSON.stringify(
      {
        simulator: "callrail-booking",
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
              failureReason: latestAttempt.failureReason,
              requestedService: latestAttempt.requestedService,
              requestedStaff: latestAttempt.requestedStaff
            }
          : null,
        appointment: latestAppointment
          ? {
              id: latestAppointment.id,
              startTime: latestAppointment.startTime.toISOString(),
              endTime: latestAppointment.endTime.toISOString(),
              status: latestAppointment.status
            }
          : null,
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
