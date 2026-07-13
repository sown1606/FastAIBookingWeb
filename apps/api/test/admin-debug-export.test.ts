import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import {
  AppointmentSource,
  AppointmentStatus,
  BookingAttemptStatus,
  CallEscalationStatus,
  CallRoutingOutcome,
  CallSessionStatus,
  ExternalProvider,
  Role,
  SalonStatus
} from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/db/prisma";
import { signAccessToken } from "../src/lib/jwt";

type Patch = {
  target: Record<string, unknown>;
  key: string;
  original: unknown;
};

const patches: Patch[] = [];
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

const ids = {
  admin: "00000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000002",
  salon: "99999999-9999-4999-8999-999999999999",
  call1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  call2: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  missingCall: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ai1: "11111111-1111-4111-8111-111111111111",
  ai2: "22222222-2222-4222-8222-222222222222",
  ai3: "33333333-3333-4333-8333-333333333333",
  ai4: "45454545-4545-4545-8545-454545454545",
  ai5: "56565656-5656-4565-8565-565656565656",
  missingAi: "44444444-4444-4444-8444-444444444444",
  transcript1: "55555555-5555-4555-8555-555555555555",
  transcript2: "66666666-6666-4666-8666-666666666666",
  booking1: "77777777-7777-4777-8777-777777777777",
  booking2: "88888888-8888-4888-8888-888888888888",
  appointment1: "12121212-1212-4212-8212-121212121212",
  appointment2: "34343434-3434-4434-8434-343434343434"
};

const patch = (target: Record<string, unknown>, key: string, value: unknown) => {
  patches.push({ target, key, original: target[key] });
  target[key] = value;
};

const restorePatches = () => {
  while (patches.length) {
    const item = patches.pop()!;
    item.target[item.key] = item.original;
  }
};

const tokenForRole = (role: Role) =>
  signAccessToken({
    userId: role === Role.PLATFORM_ADMIN ? ids.admin : ids.owner,
    email: role === Role.PLATFORM_ADMIN ? "admin@example.com" : "owner@example.com",
    role,
    salonId: role === Role.SALON_OWNER ? ids.salon : null,
    staffId: null
  });

const patchAuthUser = (role = Role.PLATFORM_ADMIN) => {
  patch(prisma.user as any, "findUnique", async () => ({
    id: role === Role.PLATFORM_ADMIN ? ids.admin : ids.owner,
    email: role === Role.PLATFORM_ADMIN ? "admin@example.com" : "owner@example.com",
    role,
    salonId: role === Role.SALON_OWNER ? ids.salon : null,
    isActive: true,
    staffId: null,
    staffProfile: null
  }));
};

const requestJson = async (
  path: string,
  body: unknown,
  token = tokenForRole(Role.PLATFORM_ADMIN)
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    body: (await response.json()) as any
  };
};

const now = new Date("2026-07-13T10:30:00.000Z");
const later = new Date("2026-07-13T10:31:00.000Z");

const buildAiInteraction = (input: {
  id: string;
  callSessionId: string;
  bookingAttemptId: string;
  transcriptId: string;
  contactId: string;
  createdAt: Date;
}) => ({
  id: input.id,
  salonId: ids.salon,
  provider: ExternalProvider.VERTEX,
  model: "unit-model",
  taskType: "amazon_connect_booking",
  requestText: `Caller requested a pedicure for ${input.contactId}`,
  requestPayload: {
    contactId: input.contactId,
    accessToken: "unit-access-token",
    attributes: {
      AmazonConnectContactId: input.contactId,
      lexTurnDebug: {
        contactId: input.contactId,
        slotDecisions: {
          serviceName: "Pedicure"
        }
      }
    }
  },
  responseText: "I can help with that.",
  responsePayload: {
    lexTurnDebug: {
      contactId: input.contactId,
      currentTurnTranscript: "I need a pedicure",
      authorization: "Bearer response-secret",
      slotDecisions: {
        requestedDate: "2026-07-14"
      }
    },
    turnHistory: [
      {
        index: 1,
        createdAt: input.createdAt.toISOString(),
        currentTurnTranscript: "I need a pedicure",
        responseText: "What time works?",
        contactId: input.contactId,
        trustedSlotsAfter: {
          serviceName: "Pedicure"
        },
        sessionAttributesAfter: {
          requestedDate: "2026-07-14"
        }
      }
    ]
  },
  parsedOutput: {
    serviceName: "Pedicure"
  },
  isValid: true,
  validationErrors: null,
  confidence: 0.96,
  interactionKey: null,
  isSynthetic: false,
  callSessionId: input.callSessionId,
  transcriptId: input.transcriptId,
  bookingAttemptId: input.bookingAttemptId,
  createdByUserId: null,
  createdAt: input.createdAt,
  callSession: {
    id: input.callSessionId,
    providerCallId: input.contactId,
    callerPhone: "+17325550101"
  },
  bookingAttempt: {
    id: input.bookingAttemptId,
    salonId: ids.salon,
    callSessionId: input.callSessionId,
    transcriptId: input.transcriptId,
    appointmentId: input.callSessionId === ids.call1 ? ids.appointment1 : ids.appointment2,
    status: BookingAttemptStatus.SUCCESS,
    source: "ai",
    customerName: "Kiet Nguyen",
    customerPhone: "+17325550101",
    requestedService: "Pedicure",
    requestedStaff: "Any staff",
    requestedDateTimeText: "tomorrow at 3 pm",
    normalizedRequest: {
      serviceName: "Pedicure"
    },
    alternativeSlots: null,
    failureReason: null,
    rawInput: {
      privateKey: "unit-private-key"
    },
    createdByUserId: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  },
  transcript: {
    id: input.transcriptId,
    salonId: ids.salon,
    callSessionId: input.callSessionId,
    transcriptSource: "amazon_connect",
    transcriptText: "Caller: I need a pedicure",
    transcriptSummary: "Pedicure booking request",
    speakerMap: null,
    startedAt: input.createdAt,
    endedAt: input.createdAt,
    rawPayload: {
      clientSecret: "unit-client-secret"
    },
    createdAt: input.createdAt
  },
  salon: {
    id: ids.salon,
    name: "Kiet Nails & Beauty"
  }
});

const ai1 = buildAiInteraction({
  id: ids.ai1,
  callSessionId: ids.call1,
  bookingAttemptId: ids.booking1,
  transcriptId: ids.transcript1,
  contactId: "contact-1",
  createdAt: now
});
const ai2 = buildAiInteraction({
  id: ids.ai2,
  callSessionId: ids.call1,
  bookingAttemptId: ids.booking1,
  transcriptId: ids.transcript1,
  contactId: "contact-1",
  createdAt: later
});
const ai3 = buildAiInteraction({
  id: ids.ai3,
  callSessionId: ids.call2,
  bookingAttemptId: ids.booking2,
  transcriptId: ids.transcript2,
  contactId: "contact-2",
  createdAt: later
});

const buildDetachedAiInteraction = (id: string, contactId: string, createdAt: Date) => {
  const interaction = buildAiInteraction({
    id,
    callSessionId: ids.missingCall,
    bookingAttemptId: `${id.slice(0, 8)}-7777-4777-8777-777777777777`,
    transcriptId: `${id.slice(0, 8)}-5555-4555-8555-555555555555`,
    contactId,
    createdAt
  });
  return {
    ...interaction,
    callSessionId: null,
    callSession: null,
    bookingAttempt: {
      ...interaction.bookingAttempt,
      callSessionId: null
    }
  };
};

const buildCall = (input: {
  id: string;
  providerCallId: string;
  transcriptId: string;
  bookingAttemptId: string;
  appointmentId: string;
  aiInteractions: any[];
}) => ({
  id: input.id,
  salonId: ids.salon,
  provider: ExternalProvider.AMAZON_CONNECT,
  providerCallId: input.providerCallId,
  providerAccountId: null,
  providerCompanyId: null,
  callerPhone: "+17325550101",
  originalPhoneNumber: "+17325550000",
  dialedPhone: "+18487029493",
  trackingNumber: "+18487029493",
  direction: "inbound",
  sourceName: "Amazon Connect",
  campaignName: "AI Reception",
  status: CallSessionStatus.COMPLETED,
  startedAt: now,
  answeredAt: now,
  endedAt: later,
  durationSeconds: 60,
  recordingUrl: "https://example.com/recording.wav",
  transcriptSummary: "Caller requested a pedicure.",
  aiSummary: {
    outcome: "booked"
  },
  bookingResult: null,
  routingOutcome: CallRoutingOutcome.AI_RECEPTION,
  language: "en",
  failureReason: null,
  finalResolution: "BOOKED",
  rawPayload: {
    Authorization: "Bearer raw-call-secret",
    Cookie: "session-cookie",
    callSessionId: input.id
  },
  createdAt: now,
  updatedAt: later,
  salon: {
    id: ids.salon,
    name: "Kiet Nails & Beauty",
    timezone: "America/New_York",
    status: SalonStatus.ACTIVE
  },
  events: [
    {
      id: `${input.id}-event`,
      salonId: ids.salon,
      callSessionId: input.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      providerEventId: `${input.providerCallId}-event`,
      eventType: "CALL_COMPLETED",
      eventTimestamp: later,
      statusBefore: CallSessionStatus.IN_PROGRESS,
      statusAfter: CallSessionStatus.COMPLETED,
      payload: {
        apiKey: "unit-api-key",
        contactId: input.providerCallId
      },
      payloadHash: `${input.id}-hash`,
      receivedAt: later,
      processedAt: later,
      processError: null
    }
  ],
  transcripts: [
    {
      id: input.transcriptId,
      salonId: ids.salon,
      callSessionId: input.id,
      transcriptSource: "amazon_connect",
      transcriptText: "Caller: I need a pedicure",
      transcriptSummary: "Pedicure booking request",
      speakerMap: null,
      startedAt: now,
      endedAt: later,
      rawPayload: {
        password: "unit-password"
      },
      createdAt: now
    }
  ],
  bookingAttempts: [
    {
      id: input.bookingAttemptId,
      salonId: ids.salon,
      callSessionId: input.id,
      transcriptId: input.transcriptId,
      appointmentId: input.appointmentId,
      status: BookingAttemptStatus.SUCCESS,
      source: "ai",
      customerName: "Kiet Nguyen",
      customerPhone: "+17325550101",
      requestedService: "Pedicure",
      requestedStaff: "Any staff",
      requestedDateTimeText: "tomorrow at 3 pm",
      normalizedRequest: {
        serviceName: "Pedicure"
      },
      alternativeSlots: null,
      failureReason: null,
      rawInput: {
        refreshToken: "unit-refresh-token"
      },
      createdByUserId: null,
      createdAt: now,
      updatedAt: later,
      appointment: {
        id: input.appointmentId,
        salonId: ids.salon,
        customerId: "customer-1",
        staffId: "staff-1",
        serviceId: "service-1",
        startTime: later,
        endTime: new Date("2026-07-13T11:31:00.000Z"),
        durationMinutes: 60,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.AI,
        notes: null,
        canceledReason: null,
        feedbackToken: null,
        createdByUserId: null,
        createdAt: now,
        updatedAt: later,
        customer: {
          id: "customer-1",
          firstName: "Kiet",
          lastName: "Nguyen",
          phone: "+17325550101"
        },
        staff: {
          id: "staff-1",
          fullName: "Amy"
        },
        service: {
          id: "service-1",
          name: "Pedicure",
          durationMinutes: 60,
          priceCents: 4500
        },
        appointmentServices: []
      }
    }
  ],
  aiInteractions: input.aiInteractions,
  callEscalations: [
    {
      id: `${input.id}-escalation`,
      salonId: ids.salon,
      callSessionId: input.id,
      status: CallEscalationStatus.CLOSED,
      routingOutcome: CallRoutingOutcome.AI_RECEPTION,
      escalationReason: null,
      requestedBy: "system",
      customerPhone: "+17325550101",
      queueId: null,
      queueName: null,
      amazonConnectContactId: input.providerCallId,
      assignedAgentUserId: null,
      messageToCaller: null,
      callbackPhone: null,
      smsRecipientPhone: null,
      voicemailRecordingUrl: null,
      operatorNotes: null,
      resolution: "BOOKED",
      qaNotes: "QA passed",
      metadata: {
        sessionToken: "unit-session-token"
      },
      requestedAt: now,
      queuedAt: null,
      connectedAt: null,
      closedAt: later,
      createdAt: now,
      updatedAt: later
    }
  ]
});

const setupAdminDebugMocks = (role = Role.PLATFORM_ADMIN) => {
  restorePatches();
  patchAuthUser(role);
  const state = {
    calls: [
      buildCall({
        id: ids.call1,
        providerCallId: "contact-1",
        transcriptId: ids.transcript1,
        bookingAttemptId: ids.booking1,
        appointmentId: ids.appointment1,
        aiInteractions: [ai1, ai2]
      }),
      buildCall({
        id: ids.call2,
        providerCallId: "contact-2",
        transcriptId: ids.transcript2,
        bookingAttemptId: ids.booking2,
        appointmentId: ids.appointment2,
        aiInteractions: [ai3]
      })
    ],
    aiInteractions: [ai1, ai2, ai3]
  };

  patch(prisma.callSession as any, "findMany", async (args: any) => {
    const requestedIds = new Set(args.where?.id?.in ?? []);
    return state.calls.filter((call) => requestedIds.has(call.id));
  });
  patch(prisma.aiInteractionLog as any, "findMany", async (args: any) => {
    const requestedIds = new Set(args.where?.id?.in ?? []);
    return state.aiInteractions.filter((interaction) => requestedIds.has(interaction.id));
  });

  return state;
};

before(() => {
  server = app.listen(0);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  restorePatches();
});

after(async () => {
  restorePatches();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
});

test("calls export accepts one valid call ID", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/calls/debug-export", { ids: [ids.call1] });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.exportType, "multi_call_debug");
  assert.equal(response.body.data.recordCount, 1);
  assert.equal(response.body.data.records[0].callSession.id, ids.call1);
});

test("calls export accepts multiple valid call IDs in requested order", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/calls/debug-export", {
    ids: [ids.call2, ids.call1]
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.data.records.map((record: any) => record.callSession.id),
    [ids.call2, ids.call1]
  );
});

test("calls export deduplicates duplicate IDs", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/calls/debug-export", {
    ids: [ids.call1, ids.call1]
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.requestedCount, 2);
  assert.equal(response.body.data.recordCount, 1);
});

test("calls export reports missing IDs under notFoundIds", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/calls/debug-export", {
    ids: [ids.call1, ids.missingCall]
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recordCount, 1);
  assert.deepEqual(response.body.data.notFoundIds, [ids.missingCall]);
});

test("calls export rejects more than 50 IDs", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/calls/debug-export", {
    ids: Array.from({ length: 51 }, (_value, index) => ids.call1.replace(/.$/, String(index % 10)))
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("calls export rejects invalid UUIDs", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/calls/debug-export", {
    ids: ["not-a-uuid"]
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("calls export forbids non-admin users", async () => {
  setupAdminDebugMocks(Role.SALON_OWNER);

  const response = await requestJson(
    "/api/v1/admin/calls/debug-export",
    { ids: [ids.call1] },
    tokenForRole(Role.SALON_OWNER)
  );

  assert.equal(response.status, 403);
});

test("calls export records include linked call debug data", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/calls/debug-export", { ids: [ids.call1] });
  const record = response.body.data.records[0];

  assert.equal(record.callSession.id, ids.call1);
  assert.equal(record.transcripts[0].transcriptText, "Caller: I need a pedicure");
  assert.equal(record.bookingAttempts[0].id, ids.booking1);
  assert.equal(record.aiInteractions.length, 2);
  assert.ok(record.turnHistories.length >= 2);
  assert.equal(record.escalationRecords[0].resolution, "BOOKED");
});

test("calls export redacts sensitive keys without removing useful debug IDs", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/calls/debug-export", { ids: [ids.call1] });
  const serialized = JSON.stringify(response.body.data);

  assert.match(serialized, /\[REDACTED\]/);
  assert.doesNotMatch(serialized, /Bearer raw-call-secret/);
  assert.doesNotMatch(serialized, /unit-refresh-token/);
  assert.doesNotMatch(serialized, /unit-password/);
  assert.match(serialized, new RegExp(ids.call1));
  assert.match(serialized, /contact-1/);
});

test("AI logs export returns linked call debug for one AI interaction", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/ai-logs/debug-export", { ids: [ids.ai1] });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.exportType, "multi_ai_call_debug");
  assert.equal(response.body.data.recordCount, 1);
  assert.equal(response.body.data.records[0].aiCallDebug.callSession.id, ids.call1);
});

test("AI logs export deduplicates multiple interactions from the same call", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/ai-logs/debug-export", {
    ids: [ids.ai1, ids.ai2]
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recordCount, 1);
  assert.equal(response.body.data.deduplicatedCount, 1);
});

test("AI logs export deduplicates interactions that share only ContactId", async () => {
  const state = setupAdminDebugMocks();
  state.aiInteractions.push(
    buildDetachedAiInteraction(ids.ai4, "detached-contact", now),
    buildDetachedAiInteraction(ids.ai5, "detached-contact", later)
  );

  const response = await requestJson("/api/v1/admin/ai-logs/debug-export", {
    ids: [ids.ai4, ids.ai5]
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recordCount, 1);
  assert.equal(response.body.data.deduplicatedCount, 1);
  assert.deepEqual(response.body.data.records[0].contactIds, ["detached-contact"]);
});

test("AI logs export returns multiple records for multiple calls", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/ai-logs/debug-export", {
    ids: [ids.ai1, ids.ai3]
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recordCount, 2);
  assert.deepEqual(
    response.body.data.records.map((record: any) => record.callSessionId),
    [ids.call1, ids.call2]
  );
});

test("AI logs export reports missing interaction IDs", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/ai-logs/debug-export", {
    ids: [ids.ai1, ids.missingAi]
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recordCount, 1);
  assert.deepEqual(response.body.data.notFoundIds, [ids.missingAi]);
});

test("AI logs export enforces the 50 ID maximum", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/ai-logs/debug-export", {
    ids: Array.from({ length: 51 }, (_value, index) => ids.ai1.replace(/.$/, String(index % 10)))
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("AI logs export redacts sensitive keys", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/ai-logs/debug-export", { ids: [ids.ai1] });
  const serialized = JSON.stringify(response.body.data);

  assert.match(serialized, /\[REDACTED\]/);
  assert.doesNotMatch(serialized, /unit-access-token/);
  assert.doesNotMatch(serialized, /response-secret/);
  assert.doesNotMatch(serialized, /unit-session-token/);
});

test("AI logs export preserves timeline and Amazon Connect ContactId", async () => {
  setupAdminDebugMocks();

  const response = await requestJson("/api/v1/admin/ai-logs/debug-export", { ids: [ids.ai1] });
  const record = response.body.data.records[0];

  assert.match(record.contactIds.join(" "), /contact-1/);
  assert.ok(record.aiCallDebug.timeline.length >= 1);
  assert.match(JSON.stringify(record.aiCallDebug.timeline), /contact-1/);
});
