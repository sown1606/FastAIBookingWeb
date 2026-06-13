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
  StaffStatus
} from "@prisma/client";
import { DateTime } from "luxon";
import { app } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/db/prisma";

type Patch = {
  target: Record<string, unknown>;
  key: string;
  original: unknown;
};

const patches: Patch[] = [];
let server: ReturnType<typeof app.listen>;
let baseUrl = "";
const originalInternalToken = env.FASTAIBOOKING_API_INTERNAL_TOKEN;
const originalDefaultSalonId = env.DEFAULT_SALON_ID;
const originalQueueId = env.AMAZON_CONNECT_QUEUE_ID_DEFAULT;

const ids = {
  ownerA: "11111111-1111-4111-8111-111111111111",
  ownerDefault: "22222222-2222-4222-8222-222222222222",
  salonA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  salonDefault: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  mia: "10000000-0000-4000-8000-000000000001",
  olivia: "10000000-0000-4000-8000-000000000002",
  nora: "10000000-0000-4000-8000-000000000003",
  trang: "10000000-0000-4000-8000-000000000004",
  amy: "10000000-0000-4000-8000-000000000006",
  kelly: "10000000-0000-4000-8000-000000000007",
  pedicure: "20000000-0000-4000-8000-000000000001",
  kietCustomer: "30000000-0000-4000-8000-000000000001"
};

const patch = (target: Record<string, unknown>, key: string, value: unknown) => {
  patches.push({ target, key, original: target[key] });
  target[key] = value;
};

const newId = (prefix: string, collection: unknown[]) => `${prefix}-${collection.length + 1}`;

const createInitialState = () => {
  const salons = [
    {
      id: ids.salonA,
      name: "Kiet Nails & Beauty",
      timezone: "America/New_York",
      ownerId: ids.ownerA,
      originalPhoneNumber: "8487029493",
      customerIncomingPhoneNumber: "8487029493",
      contactPhone: "+17325550000",
      notificationPhoneNumber: null,
      owner: { phone: "+17325550000" },
      settings: {
        callCenterEnabled: true,
        callbackRequestEnabled: true,
        smsFallbackEnabled: false,
        voicemailEnabled: true
      },
      callCenterAssignments: [{ agentUserId: "agent-1" }]
    },
    {
      id: ids.salonDefault,
      name: "Default Demo Salon",
      timezone: "America/New_York",
      ownerId: ids.ownerDefault,
      originalPhoneNumber: "2125550100",
      customerIncomingPhoneNumber: "2125550100",
      contactPhone: "+12125550100",
      notificationPhoneNumber: null,
      owner: { phone: "+12125550100" },
      settings: {
        callCenterEnabled: true,
        callbackRequestEnabled: true,
        smsFallbackEnabled: false,
        voicemailEnabled: true
      },
      callCenterAssignments: [{ agentUserId: "agent-1" }]
    }
  ];

  return {
    salons,
    services: [
      {
        id: "20000000-0000-4000-8000-000000000000",
        salonId: ids.salonA,
        name: "Manicure",
        durationMinutes: 40,
        priceCents: 3500,
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        id: ids.pedicure,
        salonId: ids.salonA,
        name: "Pedicure",
        durationMinutes: 45,
        priceCents: 4500,
        isActive: true,
        createdAt: new Date("2026-01-02T00:00:00.000Z")
      },
      {
        id: "20000000-0000-4000-8000-000000000003",
        salonId: ids.salonA,
        name: "Gel Manicure",
        durationMinutes: 60,
        priceCents: 5000,
        isActive: true,
        createdAt: new Date("2026-01-03T00:00:00.000Z")
      },
      {
        id: "20000000-0000-4000-8000-000000000004",
        salonId: ids.salonA,
        name: "Acrylic Full Set",
        durationMinutes: 100,
        priceCents: 8500,
        isActive: true,
        createdAt: new Date("2026-01-04T00:00:00.000Z")
      },
      {
        id: "20000000-0000-4000-8000-000000000005",
        salonId: ids.salonA,
        name: "Dip Powder",
        durationMinutes: 70,
        priceCents: 5800,
        isActive: true,
        createdAt: new Date("2026-01-05T00:00:00.000Z")
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        salonId: ids.salonDefault,
        name: "Pedicure",
        durationMinutes: 45,
        priceCents: 4500,
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      }
    ],
    staff: [
      {
        id: ids.trang,
        salonId: ids.salonA,
        fullName: "Trang",
        status: StaffStatus.ACTIVE,
        isBookable: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        id: ids.amy,
        salonId: ids.salonA,
        fullName: "Amy",
        status: StaffStatus.ACTIVE,
        isBookable: true,
        createdAt: new Date("2026-01-02T00:00:00.000Z")
      },
      {
        id: ids.kelly,
        salonId: ids.salonA,
        fullName: "Kelly",
        status: StaffStatus.ACTIVE,
        isBookable: true,
        createdAt: new Date("2026-01-03T00:00:00.000Z")
      },
      {
        id: "10000000-0000-4000-8000-000000000005",
        salonId: ids.salonDefault,
        fullName: "Mia Carter",
        status: StaffStatus.ACTIVE,
        isBookable: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      }
    ],
    customers: [
      {
        id: ids.kietCustomer,
        salonId: ids.salonA,
        firstName: "Kiet",
        lastName: "Nguyen",
        phone: "7325956266",
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      }
    ] as any[],
    appointments: [] as any[],
    appointmentServices: [] as any[],
    bookingAttempts: [] as any[],
    callSessions: [] as any[],
    transcripts: [] as any[],
    aiInteractionLogs: [] as any[],
    escalations: [] as any[],
    alerts: [] as any[],
    auditLogs: [] as any[],
    statusHistory: [] as any[],
    staffFindManyCalls: [] as any[],
    validationStaffIds: [] as string[],
    busyStaffIds: new Set<string>(),
    throwOnSalonFind: null as Error | null
  };
};

let state = createInitialState();

const resetMockState = () => {
  state = createInitialState();
  env.FASTAIBOOKING_API_INTERNAL_TOKEN = "unit-internal-token";
  env.DEFAULT_SALON_ID = ids.salonDefault;
  env.AMAZON_CONNECT_QUEUE_ID_DEFAULT = "queue-default";
};

const findSalon = (id?: string) => state.salons.find((salon) => salon.id === id) ?? null;

const findService = (id?: string) => state.services.find((service) => service.id === id) ?? null;

const hydrateAppointment = (appointment: any) => {
  const salon = findSalon(appointment.salonId);
  const customer = state.customers.find((item) => item.id === appointment.customerId);
  const staff = state.staff.find((item) => item.id === appointment.staffId);
  const service = findService(appointment.serviceId);
  const appointmentServices = state.appointmentServices
    .filter((item) => item.appointmentId === appointment.id)
    .map((item) => ({
      ...item,
      service: findService(item.serviceId)
    }));

  return {
    ...appointment,
    salon: { name: salon?.name, timezone: salon?.timezone },
    customer,
    staff,
    service,
    appointmentServices,
    workSessions: [],
    reminders: [],
    feedback: null,
    statusHistory: state.statusHistory.filter((item) => item.appointmentId === appointment.id)
  };
};

const setupPrismaMock = () => {
  patch(prisma as any, "$transaction", async (callback: (tx: any) => Promise<unknown>) => callback(prisma));
  patch(prisma as any, "$disconnect", async () => undefined);

  patch(prisma.salon as any, "findUnique", async (args: any) => {
    if (state.throwOnSalonFind) {
      throw state.throwOnSalonFind;
    }
    return findSalon(args?.where?.id);
  });
  patch(prisma.salon as any, "findFirst", async (args: any) => {
    const values = args?.where?.OR?.flatMap((item: any) =>
      [
        item.customerIncomingPhoneNumber?.in,
        item.originalPhoneNumber?.in,
        item.contactPhone?.in
      ].filter(Boolean)
    ).flat() ?? [];
    return (
      state.salons.find((salon) =>
        [salon.customerIncomingPhoneNumber, salon.originalPhoneNumber, salon.contactPhone].some(
          (value) => value && values.includes(value)
        )
      ) ?? null
    );
  });
  patch(prisma.salon as any, "findUniqueOrThrow", async (args: any) => {
    const salon = findSalon(args?.where?.id);
    if (!salon) {
      throw new Error("Salon not found");
    }
    return salon;
  });

  patch(prisma.integrationConfig as any, "findFirst", async (args: any) => {
    const values = args?.where?.configValue?.in ?? [];
    return values.includes("+18483487681") || values.includes("18483487681")
      ? { salon: findSalon(ids.salonA) }
      : null;
  });
  patch(prisma.integrationConfig as any, "count", async () => 1);
  patch(prisma.salonAiReceptionSetup as any, "findFirst", async () => null);

  patch(prisma.staff as any, "findMany", async (args: any) => {
    state.staffFindManyCalls.push(args);
    return state.staff.filter(
      (member) =>
        (!args?.where?.salonId || member.salonId === args.where.salonId) &&
        (!args?.where?.status || member.status === args.where.status) &&
        (args?.where?.isBookable === undefined || member.isBookable === args.where.isBookable)
    );
  });
  patch(prisma.staff as any, "findFirst", async (args: any) => {
    return (
      state.staff.find(
        (member) =>
          member.id === args?.where?.id &&
          member.salonId === args?.where?.salonId &&
          member.status === StaffStatus.ACTIVE &&
          member.isBookable
      ) ?? null
    );
  });
  patch(prisma.staff as any, "updateMany", async () => ({ count: 1 }));
  patch(prisma.staff as any, "update", async (args: any) => {
    const staff = state.staff.find((member) => member.id === args.where.id);
    if (staff) {
      Object.assign(staff, args.data);
    }
    return staff;
  });

  patch(prisma.service as any, "findMany", async (args: any) => {
    const idsFilter = args?.where?.id?.in as string[] | undefined;
    return state.services.filter(
      (service) =>
        (!args?.where?.salonId || service.salonId === args.where.salonId) &&
        (args?.where?.isActive === undefined || service.isActive === args.where.isActive) &&
        (!idsFilter || idsFilter.includes(service.id))
    );
  });
  patch(prisma.service as any, "findFirst", async (args: any) => {
    return (
      state.services.find(
        (service) =>
          (!args?.where?.id || service.id === args.where.id) &&
          (!args?.where?.salonId || service.salonId === args.where.salonId) &&
          (args?.where?.isActive === undefined || service.isActive === args.where.isActive)
      ) ?? null
    );
  });

  patch(prisma.staffService as any, "count", async () => 0);
  patch(prisma.staffService as any, "findFirst", async () => null);
  patch(prisma.businessHour as any, "findUnique", async () => ({
    isOpen: true,
    openTime: "08:00",
    closeTime: "20:00"
  }));

  patch(prisma.customer as any, "findFirst", async (args: any) => {
    if (args?.where?.id) {
      return (
        state.customers.find(
          (customer) => customer.id === args.where.id && customer.salonId === args.where.salonId
        ) ?? null
      );
    }
    const phoneCandidates = args?.where?.phone?.in as string[] | undefined;
    if (phoneCandidates) {
      return (
        state.customers.find(
          (customer) =>
            customer.salonId === args.where.salonId && phoneCandidates.includes(customer.phone)
        ) ?? null
      );
    }
    return (
      state.customers.find(
        (customer) =>
          customer.salonId === args?.where?.salonId &&
          customer.firstName.toLowerCase().includes(String(args?.where?.firstName?.contains ?? "").toLowerCase())
      ) ?? null
    );
  });
  patch(prisma.customer as any, "findMany", async (args: any) => {
    const contains = String(args?.where?.phone?.contains ?? "");
    const phoneCandidates = args?.where?.phone?.in as string[] | undefined;
    return state.customers.filter(
      (customer) =>
        customer.salonId === args?.where?.salonId &&
        (!phoneCandidates || phoneCandidates.includes(customer.phone)) &&
        (!contains || String(customer.phone).includes(contains))
    );
  });
  patch(prisma.customer as any, "create", async (args: any) => {
    const customer = {
      id: newId("customer", state.customers),
      ...args.data,
      createdAt: new Date()
    };
    state.customers.push(customer);
    return customer;
  });

  patch(prisma.appointment as any, "findFirst", async (args: any) => {
    if (args?.where?.id) {
      return (
        state.appointments.find(
          (appointment) =>
            appointment.id === args.where.id && appointment.salonId === args.where.salonId
        ) ?? null
      );
    }
    if (args?.where?.staffId) {
      state.validationStaffIds.push(args.where.staffId);
    }
    if (args?.where?.staffId && state.busyStaffIds.has(args.where.staffId)) {
      return { id: "busy-appointment" };
    }
    return null;
  });
  patch(prisma.appointment as any, "findMany", async (args: any) => {
    if (args?.where?.customerId) {
      const statusFilter = args.where.status?.in as AppointmentStatus[] | undefined;
      const startGte = args.where.startTime?.gte as Date | undefined;
      return state.appointments
        .filter(
          (appointment) =>
            appointment.salonId === args.where.salonId &&
            appointment.customerId === args.where.customerId &&
            (!statusFilter || statusFilter.includes(appointment.status)) &&
            (!startGte || appointment.startTime >= startGte)
        )
        .sort((left, right) => left.startTime.getTime() - right.startTime.getTime())
        .slice(0, args.take ?? 3)
        .map((appointment) => ({
          id: appointment.id,
          startTime: appointment.startTime,
          service: {
            name: findService(appointment.serviceId)?.name ?? "Appointment"
          },
          staff: {
            fullName:
              state.staff.find((member) => member.id === appointment.staffId)?.fullName ?? "Staff"
          }
        }));
    }
    if (args?.where?.staffId && state.busyStaffIds.has(args.where.staffId)) {
      return [
        {
          id: "busy-appointment",
          startTime: new Date("2026-05-28T21:00:00.000Z"),
          endTime: new Date("2026-05-28T21:45:00.000Z")
        }
      ];
    }
    return [];
  });
  patch(prisma.appointment as any, "create", async (args: any) => {
    const appointment = {
      id: newId("appointment", state.appointments),
      status: args.data.status ?? AppointmentStatus.SCHEDULED,
      source: args.data.source ?? AppointmentSource.DASHBOARD,
      ...args.data
    };
    state.appointments.push(appointment);
    return appointment;
  });
  patch(prisma.appointment as any, "update", async (args: any) => {
    const appointment = state.appointments.find((item) => item.id === args.where.id);
    Object.assign(appointment, args.data);
    return appointment;
  });
  patch(prisma.appointment as any, "findUniqueOrThrow", async (args: any) => {
    const appointment = state.appointments.find((item) => item.id === args.where.id);
    if (!appointment) {
      throw new Error("Appointment not found");
    }
    return hydrateAppointment(appointment);
  });

  patch(prisma.appointmentService as any, "deleteMany", async (args: any) => {
    state.appointmentServices = state.appointmentServices.filter(
      (item) => item.appointmentId !== args.where.appointmentId
    );
    return { count: 1 };
  });
  patch(prisma.appointmentService as any, "createMany", async (args: any) => {
    state.appointmentServices.push(...args.data);
    return { count: args.data.length };
  });
  patch(prisma.staffReminder as any, "deleteMany", async () => ({ count: 1 }));
  patch(prisma.staffReminder as any, "createMany", async (args: any) => ({ count: args.data.length }));
  patch(prisma.appointmentStatusHistory as any, "create", async (args: any) => {
    state.statusHistory.push(args.data);
    return args.data;
  });
  patch(prisma.auditLog as any, "create", async (args: any) => {
    state.auditLogs.push(args.data);
    return args.data;
  });
  patch(prisma.alert as any, "create", async (args: any) => {
    const alert = { id: newId("alert", state.alerts), ...args.data };
    state.alerts.push(alert);
    return alert;
  });

  patch(prisma.callSession as any, "upsert", async (args: any) => {
    const providerCallId = args.where.provider_providerCallId.providerCallId;
    let session = state.callSessions.find((item) => item.providerCallId === providerCallId);
    if (session) {
      Object.assign(session, args.update);
    } else {
      session = {
        id: newId("call-session", state.callSessions),
        ...args.create
      };
      state.callSessions.push(session);
    }
    return session;
  });
  patch(prisma.callSession as any, "findUnique", async (args: any) => {
    return state.callSessions.find((item) => item.id === args.where.id) ?? null;
  });
  patch(prisma.callSession as any, "findFirst", async (args: any) => {
    return (
      state.callSessions.find(
        (item) => item.id === args.where.id && item.salonId === args.where.salonId
      ) ?? null
    );
  });
  patch(prisma.callSession as any, "update", async (args: any) => {
    const session = state.callSessions.find((item) => item.id === args.where.id);
    if (session) {
      Object.assign(session, args.data);
    }
    return session;
  });
  patch(prisma.callTranscript as any, "create", async (args: any) => {
    const transcript = { id: newId("transcript", state.transcripts), ...args.data };
    state.transcripts.push(transcript);
    return transcript;
  });

  patch(prisma.bookingAttempt as any, "findFirst", async (args: any) => {
    return (
      state.bookingAttempts
        .filter(
          (attempt) =>
            attempt.callSessionId === args.where.callSessionId &&
            attempt.status === args.where.status
        )
        .at(-1) ?? null
    );
  });
  patch(prisma.bookingAttempt as any, "create", async (args: any) => {
    const attempt = { id: newId("attempt", state.bookingAttempts), ...args.data };
    state.bookingAttempts.push(attempt);
    return attempt;
  });
  patch(prisma.bookingAttempt as any, "update", async (args: any) => {
    const attempt = state.bookingAttempts.find((item) => item.id === args.where.id);
    Object.assign(attempt, args.data);
    return attempt;
  });

  patch(prisma.aiInteractionLog as any, "create", async (args: any) => {
    const log = { id: newId("ai-log", state.aiInteractionLogs), ...args.data };
    state.aiInteractionLogs.push(log);
    return log;
  });
  patch(prisma.aiInteractionLog as any, "update", async (args: any) => {
    const log = state.aiInteractionLogs.find((item) => item.id === args.where.id);
    Object.assign(log, args.data);
    return log;
  });

  patch(prisma.callEscalation as any, "findUnique", async (args: any) => {
    const escalation = state.escalations.find(
      (item) => item.callSessionId === args.where.callSessionId
    );
    if (!escalation) {
      return null;
    }
    if (args.select?.status) {
      return { status: escalation.status };
    }
    return escalation;
  });

  patch(prisma.callEscalation as any, "upsert", async (args: any) => {
    let escalation = state.escalations.find(
      (item) => item.callSessionId === args.where.callSessionId
    );
    if (escalation) {
      Object.assign(escalation, args.update);
    } else {
      escalation = { id: newId("escalation", state.escalations), ...args.create };
      state.escalations.push(escalation);
    }
    return escalation;
  });

  patch(prisma.user as any, "findMany", async () => []);
  patch(prisma.userNotification as any, "createMany", async (args: any) => ({
    count: Array.isArray(args.data) ? args.data.length : 0
  }));
  patch(prisma.pushToken as any, "findMany", async () => []);
  patch(prisma.callCenterSalonAssignment as any, "findMany", async (args: any) => {
    const salon = findSalon(args?.where?.salonId);
    return salon?.callCenterAssignments ?? [];
  });
};

const postInternalAppointment = async (payload: Record<string, unknown>, token = env.FASTAIBOOKING_API_INTERNAL_TOKEN) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}/api/v1/internal/ai/appointments`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  return {
    response,
    body: await response.json()
  };
};

const bookingPayload = (overrides: Record<string, unknown> = {}) => ({
  salonId: ids.salonA,
  intentName: "BookAppointmentIntent",
  customerName: "Kiet Nguyen",
  customerPhone: "+17325956266",
  serviceName: "Pedicure",
  requestedDate: "2026-05-28",
  requestedTime: "5 PM",
  confirmationState: "Confirmed",
  source: "amazon_connect_unit_test",
  ...overrides
});

before(async () => {
  setupPrismaMock();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  resetMockState();
});

after(async () => {
  env.FASTAIBOOKING_API_INTERNAL_TOKEN = originalInternalToken;
  env.DEFAULT_SALON_ID = originalDefaultSalonId;
  env.AMAZON_CONNECT_QUEUE_ID_DEFAULT = originalQueueId;
  for (const item of patches.reverse()) {
    item.target[item.key] = item.original;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
});

test("missing, invalid, and valid internal tokens are handled", async () => {
  env.FASTAIBOOKING_API_INTERNAL_TOKEN = undefined;
  let result = await postInternalAppointment({}, undefined);
  assert.equal(result.response.status, 503);
  assert.equal(result.body.error.code, "AI_INTERNAL_TOKEN_MISSING");

  env.FASTAIBOOKING_API_INTERNAL_TOKEN = "unit-internal-token";
  result = await postInternalAppointment({}, "wrong-token");
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error.code, "UNAUTHORIZED");

  result = await postInternalAppointment(bookingPayload({ customerName: undefined }));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(state.bookingAttempts.length, 1);
});

test("salon resolution supports explicit salonId, Amazon Connect called number, and default fallback", async () => {
  let result = await postInternalAppointment(bookingPayload({ requestedTime: undefined }));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.salonResolutionSource, "explicit_salon_id");

  resetMockState();
  result = await postInternalAppointment(
    bookingPayload({
      salonId: undefined,
      calledNumber: "+18483487681",
      amazonConnectPhoneNumber: "+18483487681",
      requestedTime: undefined
    })
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.salonResolutionSource, "amazon_connect_integration_config");

  resetMockState();
  result = await postInternalAppointment(
    bookingPayload({
      salonId: undefined,
      calledNumber: undefined,
      amazonConnectPhoneNumber: undefined,
      requestedTime: undefined
    })
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.salonResolutionSource, "default_salon_demo_fallback");
});

test("known Amazon Connect caller phone keeps Kiet instead of bad Lex name text", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "chang",
      customerPhone: undefined,
      callerPhone: "+17325956266",
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      attributes: {
        CustomerEndpointAddress: "+17325956266",
        customerName: "chang"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerId, ids.kietCustomer);
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Kiet");
  assert.equal(result.body.data.lexResponse.sessionAttributes.recognizedCustomerName, "Kiet");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerPhone, "+17325956266");
  assert.equal(state.appointments.length, 0);
});

test("known Amazon Connect caller phone skips name and phone prompts", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+17325956266",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      attributes: {
        CustomerEndpointAddress: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerId, ids.kietCustomer);
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Kiet");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerPhone, "+17325956266");
  assert.equal(
    result.body.data.missingFields.includes("customerName") ||
      result.body.data.missingFields.includes("customerPhone"),
    false
  );
  assert.match(result.body.data.lexResponse.message, /What service would you like today/i);
  assert.equal(state.appointments.length, 0);
});

test("missing booking fields return a Lex needs-input response instead of crashing", async () => {
  const result = await postInternalAppointment({
    salonId: ids.salonA,
    intentName: "BookAppointmentIntent",
    serviceName: "Pedicure"
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.fulfillmentState, "InProgress");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.match(result.body.data.lexResponse.message, /best name|phone number|day and time|service/i);
});

test("any-staff phrases resolve to an actual staff member before final confirmation", async () => {
  for (const phrase of ["any staff", "anyone", "whoever is available"]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        staffPreference: phrase,
        confirmationState: undefined
      })
    );

    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.outcome, "MISSING_INFO");
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
    assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Trang");
    assert.match(result.body.data.lexResponse.message, /I found Trang available/i);
    assert.equal(result.body.data.aiInteractionId, state.aiInteractionLogs[0].id);
    assert.equal(state.staffFindManyCalls[0].where.status, StaffStatus.ACTIVE);
    assert.equal(state.staffFindManyCalls[0].where.isBookable, true);
    assert.equal(state.appointments.length, 0);
  }
});

test("confirmed any-staff booking creates appointment with resolved staff id", async () => {
  const result = await postInternalAppointment(bookingPayload({ staffPreference: "anybody" }));

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.appointments[0].staffId, ids.trang);
  assert.equal(state.bookingAttempts.at(-1).requestedStaff, "Trang");
  assert.notEqual(state.bookingAttempts.at(-1).normalizedRequest.staffPreference, null);
});

test("transcript recovery normalizes pedicure aliases and confirms without re-asking date or time", async () => {
  for (const transcript of [
    "I want to book a pedicure tomorrow at five PM with Trang. My name is Kiet Nguyen. My phone number is 7325956266.",
    "I need a pedi cure tomorrow at five with Trang. My name is Kiet Nguyen. My phone number is 7325956266.",
    "I need a better cure tomorrow at five with Trang. My name is Kiet Nguyen. My phone number is 7325956266."
  ]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        customerName: undefined,
        customerPhone: undefined,
        serviceName: undefined,
        requestedDate: undefined,
        requestedTime: undefined,
        confirmationState: undefined,
        transcript
      })
    );

    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.outcome, "MISSING_INFO");
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
    assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Kiet Nguyen");
    assert.equal(result.body.data.lexResponse.sessionAttributes.customerPhone, "7325956266");
    assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
    assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "17:00");
    assert.match(result.body.data.lexResponse.message, /Just to confirm, pedicure with Trang on/i);
    assert.equal(state.appointments.length, 0);
  }
});

test("Kiet demo phrase confirms Pedicure with Trang tomorrow at 3 PM", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript:
        "I want to book a pedicure tomorrow at three PM with Trang. My name is Kiet Nguyen. My phone number is 7325956266."
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "15:00");
  assert.match(result.body.data.lexResponse.message, /Just to confirm, pedicure with Trang on/i);
  assert.equal(state.appointments.length, 0);
});

test("Kiet demo phrase confirms Pedicure with Kelly tomorrow at 2 PM", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript:
        "I want to book a pedicure tomorrow at two PM with Kelly. My name is Kiet Nguyen. My phone number is 7325956266."
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Kelly");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Kelly");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "14:00");
  assert.match(result.body.data.lexResponse.message, /Just to confirm, pedicure with Kelly on/i);
  assert.equal(state.appointments.length, 0);
});

test("confirmed transcript booking uses salon-timezone tomorrow and bare 1-7 hours as PM", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      transcript:
        "I need a better cure tomorrow at five with Trang. My name is Kiet Nguyen. My phone number is 7325956266."
    })
  );

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 1);
  const localStart = DateTime.fromJSDate(state.appointments[0].startTime, {
    zone: "utc"
  }).setZone("America/New_York");
  const expectedTomorrow = DateTime.now().setZone("America/New_York").plus({ days: 1 });
  assert.equal(localStart.toFormat("yyyy-MM-dd"), expectedTomorrow.toFormat("yyyy-MM-dd"));
  assert.equal(localStart.hour, 17);
  assert.equal(state.bookingAttempts.at(-1).requestedService, "Pedicure");
});

test("unclear service asks the canonical service list without escalation", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "pretty soon",
      staffPreference: "Trang",
      attributes: {
        serviceClarificationAttempts: "2"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.forceHumanEscalation, undefined);
  assert.match(
    result.body.data.lexResponse.message,
    /press 1 for Pedicure, 2 for Manicure, 3 for Gel Manicure, 4 for Acrylic Full Set, or 5 for Dip Powder/i
  );
  assert.equal(state.escalations.length, 0);
  assert.equal(state.appointments.length, 0);
});

test("invalid staff preferences are cleared and ask for staff without booking", async () => {
  for (const staffPreference of ["yes", "p.m.", "111115", "7325956266", "3 PM", "Not A Real Technician"]) {
    resetMockState();
    const result = await postInternalAppointment(bookingPayload({ staffPreference }));

    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.outcome, "MISSING_INFO");
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
    assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
    assert.match(result.body.data.lexResponse.message, /press 1 for Trang/i);
    const attempt = state.bookingAttempts.at(-1);
    assert.equal(attempt.requestedStaff, undefined);
    assert.equal(attempt.normalizedRequest.staffPreference, undefined);
    assert.equal(state.appointments.length, 0);
  }
});

test("service DTMF applies only to serviceName and continues to staff", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "1",
      attributes: {
        lastAskedSlot: "serviceName",
        serviceName: "pretty soon",
        requestedDate: "2026-05-28",
        requestedTime: "5 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, undefined);
  assert.equal(state.appointments.length, 0);
});

test("staff DTMF applies only to staffPreference and reaches confirmation", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "1",
      attributes: {
        lastAskedSlot: "staffPreference",
        serviceName: "Pedicure",
        requestedDate: "2026-05-28",
        requestedTime: "5 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Trang");
  assert.match(result.body.data.lexResponse.message, /pedicure/i);
  assert.match(result.body.data.lexResponse.message, /Trang/i);
  assert.equal(state.appointments.length, 0);
});

test("staff DTMF 3 maps to Kelly and does not ask staff again", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "3",
      attributes: {
        lastAskedSlot: "staffPreference",
        serviceName: "Pedicure",
        requestedDate: "2026-05-28",
        requestedTime: "2 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Kelly");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Kelly");
  assert.match(result.body.data.lexResponse.message, /pedicure with Kelly/i);
  assert.equal(state.appointments.length, 0);
});

test("staff DTMF 4 maps to any staff and resolves before confirmation", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "4",
      attributes: {
        lastAskedSlot: "staffPreference",
        serviceName: "Pedicure",
        requestedDate: "2026-05-28",
        requestedTime: "2 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Trang");
  assert.match(result.body.data.lexResponse.message, /I found Trang available/i);
  assert.equal(state.appointments.length, 0);
});

test("valid staff preference books only that active bookable staff member", async () => {
  const result = await postInternalAppointment(bookingPayload({ staffPreference: "Trang" }));

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  assert.equal(state.appointments[0].staffId, ids.trang);
  assert.ok(state.validationStaffIds.length >= 2);
  assert.deepEqual(new Set(state.validationStaffIds), new Set([ids.trang]));
});

test("valid Kelly staff preference books Kelly", async () => {
  const result = await postInternalAppointment(bookingPayload({ staffPreference: "Kelly" }));

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  assert.equal(state.appointments[0].staffId, ids.kelly);
  assert.deepEqual(new Set(state.validationStaffIds), new Set([ids.kelly]));
});

test("busy requested staff returns deduped alternatives", async () => {
  state.busyStaffIds.add(ids.trang);
  const result = await postInternalAppointment(bookingPayload({ staffPreference: "Trang" }));

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "NO_AVAILABILITY");
  assert.equal(result.body.data.alternatives.length, 2);
  assert.deepEqual(
    new Set(result.body.data.alternatives.map((slot: { staffName: string }) => slot.staffName)).size,
    result.body.data.alternatives.length
  );
  assert.deepEqual(
    new Set(result.body.data.alternatives.map((slot: { staffName: string }) => slot.staffName)),
    new Set(["Amy", "Trang"])
  );
  assert.match(result.body.data.lexResponse.message, /Trang is not available at 5 PM/i);
  assert.match(result.body.data.lexResponse.message, /press 1 for .* with Amy/i);
  assert.match(result.body.data.lexResponse.message, /press 2 for .* with Trang/i);
  assert.equal(state.appointments.length, 0);
});

test("yes to a single alternative asks final confirmation before booking", async () => {
  state.staff = state.staff.filter(
    (member) => member.salonId !== ids.salonA || member.id === ids.trang
  );
  state.busyStaffIds.add(ids.trang);
  const first = await postInternalAppointment(bookingPayload({ staffPreference: "Trang" }));
  assert.equal(first.body.data.outcome, "NO_AVAILABILITY");
  assert.equal(first.body.data.alternatives.length, 1);

  const firstAttributes = first.body.data.lexResponse.sessionAttributes;
  state.busyStaffIds.clear();
  const second = await postInternalAppointment(
    bookingPayload({
      customerName: firstAttributes.customerName,
      customerPhone: firstAttributes.customerPhone,
      serviceName: firstAttributes.serviceName,
      requestedDate: firstAttributes.requestedDate,
      requestedTime: firstAttributes.requestedTime,
      staffPreference: firstAttributes.staffPreference,
      confirmationState: "Confirmed",
      transcript: "yes",
      attributes: firstAttributes
    })
  );

  assert.equal(second.response.status, 200);
  assert.equal(second.body.data.outcome, "MISSING_INFO");
  assert.equal(second.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(second.body.data.lexResponse.sessionAttributes.awaitingAlternativeSelection, "false");
  assert.equal(second.body.data.lexResponse.sessionAttributes.awaitingFinalBookingConfirmation, "true");
  assert.equal(second.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.match(second.body.data.lexResponse.message, /Just to confirm, pedicure with Trang on/i);
  assert.equal(state.appointments.length, 0);

  const secondAttributes = second.body.data.lexResponse.sessionAttributes;
  const third = await postInternalAppointment(
    bookingPayload({
      customerName: secondAttributes.customerName,
      customerPhone: secondAttributes.customerPhone,
      serviceName: secondAttributes.serviceName,
      requestedDate: secondAttributes.requestedDate,
      requestedTime: secondAttributes.requestedTime,
      staffPreference: secondAttributes.staffPreference,
      confirmationState: "Confirmed",
      transcript: "yes",
      attributes: secondAttributes
    })
  );

  assert.equal(third.response.status, 201);
  assert.equal(third.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.appointments[0].staffId, ids.trang);
});

test("successful booking creates appointment, booking attempt, call session, transcript, and AI log", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: "Trang",
      amazonConnectContactId: "connect-contact-success",
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      transcript: "Kiet Nguyen wants a pedicure with Trang tomorrow at five PM."
    })
  );

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.bookingAttempts.length, 1);
  assert.equal(state.callSessions.length, 1);
  assert.equal(state.transcripts.length, 1);
  assert.equal(state.aiInteractionLogs.length, 1);
  assert.equal(result.body.data.callSessionId, state.callSessions[0].id);
  assert.equal(result.body.data.transcriptId, state.transcripts[0].id);
  assert.equal(result.body.data.aiInteractionId, state.aiInteractionLogs[0].id);
});

test("explicit human intent creates queued escalation with queue id", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      intentName: "HumanEscalationIntent",
      amazonConnectContactId: "connect-HumanEscalationIntent",
      transcript: "I want to speak to a real person."
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "HUMAN_ESCALATION");
  assert.equal(result.body.data.lexResponse.message, "Please wait while I connect you.");
  assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
  assert.equal(result.body.data.lexResponse.sessionAttributes.queueId, "queue-default");
  assert.equal(state.escalations[0].status, CallEscalationStatus.QUEUED);
  assert.equal(state.escalations[0].routingOutcome, CallRoutingOutcome.QUEUED);
  assert.equal(state.escalations[0].queueId, "queue-default");
});

test("cancel and reschedule intents use upcoming appointment context without transfer", async () => {
  for (const intentName of ["CancelAppointmentIntent", "RescheduleAppointmentIntent"]) {
    resetMockState();
    state.appointments.push({
      id: `upcoming-${intentName}`,
      salonId: ids.salonA,
      customerId: ids.kietCustomer,
      staffId: ids.trang,
      serviceId: ids.pedicure,
      startTime: DateTime.now()
        .setZone("America/New_York")
        .plus({ days: 1 })
        .set({ hour: 15, minute: 0, second: 0, millisecond: 0 })
        .toUTC()
        .toJSDate(),
      endTime: DateTime.now()
        .setZone("America/New_York")
        .plus({ days: 1 })
        .set({ hour: 15, minute: 45, second: 0, millisecond: 0 })
        .toUTC()
        .toJSDate(),
      durationMinutes: 45,
      status: AppointmentStatus.SCHEDULED,
      source: AppointmentSource.AI
    });

    const result = await postInternalAppointment(
      bookingPayload({
        intentName,
        amazonConnectContactId: `connect-${intentName}`,
        serviceName: undefined,
        requestedDate: undefined,
        requestedTime: undefined,
        confirmationState: undefined,
        transcript:
          intentName === "CancelAppointmentIntent"
            ? "I want to cancel my appointment."
            : "I want to reschedule my appointment."
      })
    );

    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.outcome, "MISSING_INFO");
    assert.match(result.body.data.lexResponse.message, /upcoming pedicure with Trang/i);
    assert.equal(result.body.data.lexResponse.sessionAttributes.customerId, ids.kietCustomer);
    assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Kiet");
    assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "false");
    assert.equal(result.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "false");
    assert.equal(
      result.body.data.lexResponse.sessionAttributes.awaitingExistingAppointmentHumanConfirmation,
      "true"
    );
    assert.equal(state.escalations.length, 0);
  }
});

test("explicit human intent does not transfer when no agents are assigned", async () => {
  state.salons[0].callCenterAssignments = [];

  const result = await postInternalAppointment(
    bookingPayload({
      intentName: "HumanEscalationIntent",
      amazonConnectContactId: "connect-human-no-agents",
      transcript: "I want to speak to a real person."
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "HUMAN_ESCALATION");
  assert.equal(result.body.data.lexResponse.message, "No agents available.");
  assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "false");
  assert.equal(result.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(result.body.data.lexResponse.sessionAttributes.queueId, undefined);
  assert.equal(state.escalations[0].status, CallEscalationStatus.CALLBACK_REQUESTED);
  assert.equal(state.escalations[0].routingOutcome, CallRoutingOutcome.CALLBACK_REQUEST);
  assert.equal(state.escalations[0].messageToCaller, "No agents available.");
});

test("backend errors and timeouts return safe Lex human escalation payloads", async () => {
  state.throwOnSalonFind = new Error("database query timed out");
  let result = await postInternalAppointment(bookingPayload());
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "HUMAN_ESCALATION");
  assert.equal(result.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
  assert.equal(result.body.data.lexResponse.sessionAttributes.escalationReason, "backend_timeout");
  assert.doesNotMatch(result.body.data.lexResponse.message, /database|query|timed out/i);

  resetMockState();
  state.throwOnSalonFind = new Error("database host detail");
  result = await postInternalAppointment(bookingPayload());
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.sessionAttributes.escalationReason, "backend_error");
  assert.doesNotMatch(result.body.data.lexResponse.message, /database|host detail/i);
});
