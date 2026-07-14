import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
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
import { listAIInteractionsForAdmin } from "../src/modules/ai/ai.service";

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
const originalStaffedAgentsOverride = process.env.AMAZON_CONNECT_STAFFED_AGENTS_OVERRIDE;
const originalAvailableAgentsOverride = process.env.AMAZON_CONNECT_AVAILABLE_AGENTS_OVERRIDE;

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
  kevin: "10000000-0000-4000-8000-000000000008",
  alex: "10000000-0000-4000-8000-000000000009",
  pedicure: "20000000-0000-4000-8000-000000000001",
  fullSet: "20000000-0000-4000-8000-000000000004",
  kietCustomer: "30000000-0000-4000-8000-000000000001"
};

const MOCK_BLOCKING_APPOINTMENT_STATUSES = new Set<AppointmentStatus>([
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS
]);

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
        isActive: false,
        createdAt: new Date("2026-01-03T00:00:00.000Z")
      },
      {
        id: "20000000-0000-4000-8000-000000000004",
        salonId: ids.salonA,
        name: "Full Set",
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
    staffServiceMappings: [ids.trang, ids.amy, ids.kelly].flatMap((staffId) =>
      [
        "20000000-0000-4000-8000-000000000000",
        ids.pedicure,
        "20000000-0000-4000-8000-000000000003",
        "20000000-0000-4000-8000-000000000004",
        "20000000-0000-4000-8000-000000000005"
      ].map((serviceId) => ({
        salonId: ids.salonA,
        staffId,
        serviceId
      }))
    ) as { salonId: string; staffId: string; serviceId: string }[] | null,
    businessHours: Array.from({ length: 7 }, (_value, dayOfWeek) => ({
      salonId: ids.salonA,
      dayOfWeek,
      isOpen: true,
      openTime: "08:00",
      closeTime: "20:00"
    })),
    staffServiceChecks: [] as any[],
	    busyStaffIds: new Set<string>(),
	    throwOnSalonFind: null as Error | null,
	    throwOnCustomerCreate: null as Error | null
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
  let transactionChain = Promise.resolve();
  patch(prisma as any, "$transaction", async (callback: (tx: any) => Promise<unknown>) => {
    const run = transactionChain.then(() => callback(prisma));
    transactionChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  });
  patch(prisma as any, "$disconnect", async () => undefined);
  patch(prisma as any, "$executeRaw", async () => 0);

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
  patch(prisma.salonSetting as any, "findUnique", async (args: any) => ({
    salonId: args?.where?.salonId,
    locale: "en-US"
  }));

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

  patch(prisma.staffService as any, "count", async (args: any) => {
    if (!state.staffServiceMappings) {
      return 0;
    }
    return state.staffServiceMappings.filter(
      (mapping) =>
        mapping.salonId === args?.where?.salonId &&
        mapping.serviceId === args?.where?.serviceId
    ).length;
  });
  patch(prisma.staffService as any, "findFirst", async (args: any) => {
    state.staffServiceChecks.push(args?.where);
    if (!state.staffServiceMappings) {
      return null;
    }
    return (
      state.staffServiceMappings.find(
        (mapping) =>
          mapping.salonId === args?.where?.salonId &&
          mapping.serviceId === args?.where?.serviceId &&
          mapping.staffId === args?.where?.staffId
      ) ?? null
    );
  });
  patch(prisma.staffService as any, "findMany", async (args: any) => {
    if (!state.staffServiceMappings) {
      return [];
    }
    return state.staffServiceMappings
      .filter(
        (mapping) =>
          (!args?.where?.salonId || mapping.salonId === args.where.salonId) &&
          (!args?.where?.serviceId || mapping.serviceId === args.where.serviceId)
      )
      .map((mapping) => ({
        ...mapping,
        staff: state.staff.find((member) => member.id === mapping.staffId)
      }))
      .filter(
        (mapping) =>
          mapping.staff &&
          mapping.staff.status === StaffStatus.ACTIVE &&
          mapping.staff.isBookable !== false
      );
  });
  patch(prisma.businessHour as any, "findUnique", async (args: any) => {
    const key = args?.where?.salonId_dayOfWeek;
    return (
      state.businessHours.find(
        (hour) => hour.salonId === key?.salonId && hour.dayOfWeek === key?.dayOfWeek
      ) ?? null
    );
  });

  patch(prisma.customer as any, "findFirst", async (args: any) => {
    const allowsCustomer = (customer: any) =>
      args?.where?.deletedAt === null ? customer.deletedAt === null || customer.deletedAt === undefined : true;
    if (args?.where?.id) {
      return (
        state.customers.find(
          (customer) => customer.id === args.where.id && customer.salonId === args.where.salonId && allowsCustomer(customer)
        ) ?? null
      );
    }
    const phoneCandidates = args?.where?.phone?.in as string[] | undefined;
    if (phoneCandidates) {
      return (
        state.customers.find(
          (customer) =>
            customer.salonId === args.where.salonId && phoneCandidates.includes(customer.phone) && allowsCustomer(customer)
        ) ?? null
      );
    }
    return (
      state.customers.find(
        (customer) =>
          customer.salonId === args?.where?.salonId &&
          allowsCustomer(customer) &&
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
        (args?.where?.deletedAt === null ? customer.deletedAt === null || customer.deletedAt === undefined : true) &&
        (!phoneCandidates || phoneCandidates.includes(customer.phone)) &&
        (!contains || String(customer.phone).includes(contains))
    );
  });
	  patch(prisma.customer as any, "create", async (args: any) => {
	    if (state.throwOnCustomerCreate) {
	      throw state.throwOnCustomerCreate;
	    }
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
      const appointment =
        state.appointments.find(
          (appointment) =>
            appointment.id === args.where.id && appointment.salonId === args.where.salonId
        ) ?? null;
      return appointment && args.include ? hydrateAppointment(appointment) : appointment;
    }
    if (args?.where?.staffId) {
      state.validationStaffIds.push(args.where.staffId);
    }
    if (args?.where?.staffId && args?.where?.startTime?.lt && args?.where?.endTime?.gt) {
      const statusFilter = args.where.status?.in as AppointmentStatus[] | undefined;
      const overlapping = state.appointments.find((appointment) => {
        const excludedId = args.where.id?.not;
        return (
          appointment.salonId === args.where.salonId &&
          appointment.staffId === args.where.staffId &&
          appointment.id !== excludedId &&
          (statusFilter ? statusFilter.includes(appointment.status) : MOCK_BLOCKING_APPOINTMENT_STATUSES.has(appointment.status)) &&
          appointment.startTime < args.where.startTime.lt &&
          appointment.endTime > args.where.endTime.gt
        );
      });
      if (overlapping) {
        return { id: overlapping.id };
      }
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
        createdAt: new Date(),
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
    const where = args.where ?? {};
    return (
      state.callSessions.find((item) => {
        if (where.id && item.id !== where.id) {
          return false;
        }
        if (where.salonId && item.salonId !== where.salonId) {
          return false;
        }
        if (where.provider && item.provider !== where.provider) {
          return false;
        }
        if (where.providerCallId && item.providerCallId !== where.providerCallId) {
          return false;
        }
        return true;
      }) ?? null
    );
  });
  patch(prisma.callSession as any, "findMany", async (args: any) => {
    const phoneCandidates = args?.where?.callerPhone?.in as string[] | undefined;
    return state.callSessions
      .filter(
        (item) =>
          item.salonId === args?.where?.salonId &&
          (!phoneCandidates || phoneCandidates.includes(item.callerPhone))
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, args.take ?? 25);
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
    const phoneCandidates = args?.where?.customerPhone?.in as string[] | undefined;
    if (phoneCandidates) {
      return (
        state.bookingAttempts
          .filter(
            (attempt) =>
              attempt.salonId === args.where.salonId &&
              phoneCandidates.includes(attempt.customerPhone) &&
              Boolean(attempt.customerName)
          )
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null
      );
    }
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
  patch(prisma.bookingAttempt as any, "findMany", async (args: any) => {
    const phoneCandidates = args?.where?.customerPhone?.in as string[] | undefined;
    if (phoneCandidates) {
      return state.bookingAttempts
        .filter(
          (attempt) =>
            attempt.salonId === args.where.salonId &&
            phoneCandidates.includes(attempt.customerPhone) &&
            Boolean(attempt.customerName)
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, args.take ?? 20);
    }
    return state.bookingAttempts
      .filter((attempt) => attempt.salonId === args?.where?.salonId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, args?.take ?? state.bookingAttempts.length);
  });
  patch(prisma.bookingAttempt as any, "create", async (args: any) => {
    const attempt = { id: newId("attempt", state.bookingAttempts), createdAt: new Date(), ...args.data };
    state.bookingAttempts.push(attempt);
    return attempt;
  });
  patch(prisma.bookingAttempt as any, "update", async (args: any) => {
    const attempt = state.bookingAttempts.find((item) => item.id === args.where.id);
    Object.assign(attempt, args.data);
    return attempt;
  });

  patch(prisma.aiInteractionLog as any, "create", async (args: any) => {
    const log = { id: newId("ai-log", state.aiInteractionLogs), createdAt: new Date(), ...args.data };
    state.aiInteractionLogs.push(log);
    return log;
  });
  patch(prisma.aiInteractionLog as any, "findFirst", async (args: any) => {
    return (
      state.aiInteractionLogs
        .filter(
          (item) =>
            (!args?.where?.salonId || item.salonId === args.where.salonId) &&
            (!args?.where?.provider || item.provider === args.where.provider) &&
            (!args?.where?.taskType || item.taskType === args.where.taskType) &&
            (!args?.where?.callSessionId || item.callSessionId === args.where.callSessionId)
        )
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0] ?? null
    );
  });
  patch(prisma.aiInteractionLog as any, "findUnique", async (args: any) => {
    if (args?.where?.interactionKey) {
      return (
        state.aiInteractionLogs.find((item) => item.interactionKey === args.where.interactionKey) ??
        null
      );
    }
    if (args?.where?.id) {
      return state.aiInteractionLogs.find((item) => item.id === args.where.id) ?? null;
    }
    return null;
  });
  patch(prisma.aiInteractionLog as any, "update", async (args: any) => {
    const log = state.aiInteractionLogs.find((item) =>
      args.where.id ? item.id === args.where.id : item.interactionKey === args.where.interactionKey
    );
    Object.assign(log, args.data);
    return log;
  });
  const matchesAIInteractionWhere = (item: any, where: any): boolean => {
    if (!where) {
      return true;
    }
    if (where.AND) {
      return where.AND.every((condition: any) => matchesAIInteractionWhere(item, condition));
    }
    if (where.OR) {
      return where.OR.some((condition: any) => matchesAIInteractionWhere(item, condition));
    }
    if (where.NOT) {
      return !where.NOT.some((condition: any) => matchesAIInteractionWhere(item, condition));
    }
    if (where.id && item.id !== where.id) {
      return false;
    }
    if (where.salonId && item.salonId !== where.salonId) {
      return false;
    }
    if (where.provider && item.provider !== where.provider) {
      return false;
    }
    if (where.taskType && item.taskType !== where.taskType) {
      return false;
    }
    if (where.callSessionId && item.callSessionId !== where.callSessionId) {
      return false;
    }
    if (where.isSynthetic !== undefined && item.isSynthetic !== where.isSynthetic) {
      return false;
    }
    const contains = (value: unknown, filter: any) =>
      typeof value === "string" &&
      typeof filter?.contains === "string" &&
      value.toLowerCase().includes(filter.contains.toLowerCase());
    if (where.requestText && !contains(item.requestText, where.requestText)) {
      return false;
    }
    if (where.responseText && !contains(item.responseText, where.responseText)) {
      return false;
    }
    if (where.requestPayload?.path && where.requestPayload?.string_starts_with) {
      const value = where.requestPayload.path.reduce(
        (current: unknown, key: string) =>
          current && typeof current === "object" && !Array.isArray(current)
            ? (current as Record<string, unknown>)[key]
            : undefined,
        item.requestPayload
      );
      return (
        typeof value === "string" &&
        value.toLowerCase().startsWith(String(where.requestPayload.string_starts_with).toLowerCase())
      );
    }
    if (where.callSession?.is?.providerCallId) {
      const session = state.callSessions.find((call) => call.id === item.callSessionId);
      const providerCallId = session?.providerCallId ?? "";
      const filter = where.callSession.is.providerCallId;
      if (filter.startsWith && !providerCallId.toLowerCase().startsWith(filter.startsWith.toLowerCase())) {
        return false;
      }
      if (filter.contains && !providerCallId.toLowerCase().includes(filter.contains.toLowerCase())) {
        return false;
      }
    }
    return true;
  };
  patch(prisma.aiInteractionLog as any, "findMany", async (args: any) => {
    return state.aiInteractionLogs
      .filter((item) => matchesAIInteractionWhere(item, args?.where))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(args?.skip ?? 0, (args?.skip ?? 0) + (args?.take ?? state.aiInteractionLogs.length))
      .map((item) => ({
        ...item,
        salon: findSalon(item.salonId),
        bookingAttempt: state.bookingAttempts.find((attempt) => attempt.id === item.bookingAttemptId) ?? null,
        transcript: state.transcripts.find((transcript) => transcript.id === item.transcriptId) ?? null,
        callSession: state.callSessions.find((call) => call.id === item.callSessionId) ?? null
      }));
  });
  patch(prisma.aiInteractionLog as any, "count", async (args: any) => {
    return state.aiInteractionLogs.filter((item) => matchesAIInteractionWhere(item, args?.where)).length;
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

const postOperatorQueueOutcome = async (
  payload: Record<string, unknown>,
  token = env.FASTAIBOOKING_API_INTERNAL_TOKEN
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}/api/v1/internal/ai/operator-queue-outcome`, {
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

const addKevinStaff = () => {
  state.staff.push({
    id: ids.kevin,
    salonId: ids.salonA,
    fullName: "Kevin",
    status: StaffStatus.ACTIVE,
    isBookable: true,
    createdAt: new Date("2026-01-04T00:00:00.000Z")
  });
  state.staffServiceMappings?.push(
    ...[
      "20000000-0000-4000-8000-000000000000",
      ids.pedicure,
      "20000000-0000-4000-8000-000000000003",
      "20000000-0000-4000-8000-000000000004",
      "20000000-0000-4000-8000-000000000005"
    ].map((serviceId) => ({
      salonId: ids.salonA,
      staffId: ids.kevin,
      serviceId
    }))
  );
};

const addAlexStaff = (options: { mapFullSet?: boolean } = {}) => {
  const mapFullSet = options.mapFullSet ?? true;
  state.staff.push({
    id: ids.alex,
    salonId: ids.salonA,
    fullName: "Alex",
    status: StaffStatus.ACTIVE,
    isBookable: true,
    createdAt: new Date("2026-01-05T00:00:00.000Z")
  });
  state.staffServiceMappings?.push(
    ...[
      "20000000-0000-4000-8000-000000000000",
      ids.pedicure,
      "20000000-0000-4000-8000-000000000003",
      ...(mapFullSet ? [ids.fullSet] : []),
      "20000000-0000-4000-8000-000000000005"
    ].map((serviceId) => ({
      salonId: ids.salonA,
      staffId: ids.alex,
      serviceId
    }))
  );
};

const repoRootPath = fileURLToPath(new URL("../../../", import.meta.url));

const collectTextFiles = (path: string): string[] => {
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .flatMap((entry) => collectTextFiles(join(path, entry)));
  }
  return [path];
};

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
  process.env.AMAZON_CONNECT_STAFFED_AGENTS_OVERRIDE = "1";
  process.env.AMAZON_CONNECT_AVAILABLE_AGENTS_OVERRIDE = "1";
});

after(async () => {
  env.FASTAIBOOKING_API_INTERNAL_TOKEN = originalInternalToken;
  env.DEFAULT_SALON_ID = originalDefaultSalonId;
  env.AMAZON_CONNECT_QUEUE_ID_DEFAULT = originalQueueId;
  if (originalStaffedAgentsOverride === undefined) {
    delete process.env.AMAZON_CONNECT_STAFFED_AGENTS_OVERRIDE;
  } else {
    process.env.AMAZON_CONNECT_STAFFED_AGENTS_OVERRIDE = originalStaffedAgentsOverride;
  }
  if (originalAvailableAgentsOverride === undefined) {
    delete process.env.AMAZON_CONNECT_AVAILABLE_AGENTS_OVERRIDE;
  } else {
    process.env.AMAZON_CONNECT_AVAILABLE_AGENTS_OVERRIDE = originalAvailableAgentsOverride;
  }
  for (const item of patches.reverse()) {
    item.target[item.key] = item.original;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
});

test("call flow customer text uses Full Set wording", () => {
  const scannedPaths = [
    "infra/lambda/booking-handler/index.mjs",
    "infra/aws/lex/FastAIBookingBot-v10",
    "infra/aws/connect/contact-flows/ai-reception.json",
    "apps/api/src/modules/ai/ai.service.ts",
    "tests/lambda/booking-handler.test.mjs",
    "apps/api/test/ai-internal.test.ts",
    "docs/AI_CALL_BOOKING_WORKFLOW_AUDIT.md"
  ];
  const staleServiceRoot = ["a", "crylic"].join("");
  const unavailablePhrase = ["AI services", "not available"].join(" ");
  const knownCallerName = ["k", "iet"].join("");
  const hardcodedKnownCallerFlow = new RegExp(
    [
      `check-${knownCallerName}-known-caller`,
      `set-${knownCallerName}-known-customer`,
      `${knownCallerName}-known-caller-greeting-prompt`
    ].join("|")
  );
  const staleWording = new RegExp(
    [
      `${staleServiceRoot} Full Set`,
      `${staleServiceRoot} full set`,
      `${staleServiceRoot} set`,
      `${staleServiceRoot}s`,
      `full ${staleServiceRoot} set`,
      `${staleServiceRoot} appointment`,
      `\\b${staleServiceRoot}\\b`
    ].join("|"),
    "i"
  );

  for (const relativePath of scannedPaths) {
    for (const filePath of collectTextFiles(join(repoRootPath, relativePath))) {
      const fileContent = readFileSync(filePath, "utf8");
      assert.doesNotMatch(fileContent, staleWording, filePath);
      assert.doesNotMatch(fileContent, new RegExp(unavailablePhrase, "i"), filePath);
      assert.doesNotMatch(fileContent, hardcodedKnownCallerFlow, filePath);
    }
  }
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

  result = await postInternalAppointment(bookingPayload({ customerName: undefined, staffPreference: "Trang" }));
  assert.equal(result.response.status, 201);
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
  assert.match(result.body.data.lexResponse.message, /Welcome back, Kiet\. How may I help you today/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /1 for Pedicure/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /5 for Dip Powder/i);
  assert.equal(state.appointments.length, 0);
});

test("known caller acknowledgement is spoken once and can be corrected for current booking", async () => {
  state.customers.push({
    id: "customer-lee-known",
    salonId: ids.salonA,
    firstName: "Lee",
    lastName: "Stored",
    phone: "84798171999",
    createdAt: new Date("2026-01-10T00:00:00.000Z")
  } as any);

  const first = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+84798171999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-known-lee-once",
      attributes: {
        CustomerEndpointAddress: "+84798171999"
      }
    })
  );

  assert.match(first.body.data.lexResponse.message, /Welcome back, Lee/i);
  assert.equal(first.body.data.lexResponse.sessionAttributes.knownCallerAcknowledged, "true");
  assert.equal(first.body.data.lexResponse.sessionAttributes.customerName, "Lee");
  assert.equal(first.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");

  const second = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+84798171999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-known-lee-once",
      currentTurnTranscript: "I want Pedicure",
      transcript: "I want Pedicure",
      attributes: first.body.data.lexResponse.sessionAttributes
    })
  );

  assert.doesNotMatch(second.body.data.lexResponse.message, /Welcome back/i);
  assert.equal(second.body.data.lexResponse.sessionAttributes.customerName, "Lee");
  assert.equal(second.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");

  const correction = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+84798171999",
      serviceName: "Full Set",
      requestedDate: "2026-05-28",
      requestedTime: "2 PM",
      staffPreference: "Trang",
      staffId: ids.trang,
      confirmationState: undefined,
      amazonConnectContactId: "connect-known-lee-correction",
      currentTurnTranscript: "That's not my name. My name is Thuyet.",
      transcript: "That's not my name. My name is Thuyet.",
      attributes: {
        CustomerEndpointAddress: "+84798171999",
        serviceName: "Full Set",
        requestedDate: "2026-05-28",
        requestedTime: "2 PM",
        staffPreference: "Trang",
        staffId: ids.trang
      }
    })
  );

  assert.equal(correction.body.data.lexResponse.sessionAttributes.customerName, "Thuyet");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.customerNameSource, "current_turn_explicit");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.requestedDate, "2026-05-28");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.requestedTime, "2 PM");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(state.customers.find((customer) => customer.id === "customer-lee-known")?.firstName, "Lee");
});

test("known caller initial booking turn skips name and preserves all booking fields", async () => {
  state.customers.push({
    id: "customer-lee-initial",
    salonId: ids.salonA,
    firstName: "Lee",
    lastName: "Stored",
    phone: "84798171999",
    createdAt: new Date("2026-01-10T00:00:00.000Z")
  } as any);

  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+84798171999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-known-lee-initial",
      currentTurnTranscript: "I want to book a Pedicure tomorrow at 2 PM with any staff.",
      transcript: "I want to book a Pedicure tomorrow at 2 PM with any staff.",
      attributes: {
        CustomerEndpointAddress: "+84798171999"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.doesNotMatch(result.body.data.lexResponse.message, /may i have your name|what name/i);
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Lee");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerNameSource, "phone_lookup");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerProfileSource, "active_customer");
  assert.equal(result.body.data.lexResponse.sessionAttributes.knownCallerLookupAttempted, "true");
  assert.equal(result.body.data.lexResponse.sessionAttributes.knownCallerLookupStatus, "FOUND");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "14:00");
});

test("production g p s transcript resolves Full Set, 3 PM, Trang, and known caller", async () => {
  state.customers.push({
    id: "customer-lee-gps",
    salonId: ids.salonA,
    firstName: "Lee",
    lastName: "Stored",
    phone: "84798171999",
    createdAt: new Date("2026-01-10T00:00:00.000Z")
  } as any);

  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+84798171999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-known-lee-gps",
      currentTurnTranscript: "book full set tomorrow at g p s with chang",
      transcript: "book full set tomorrow at g p s with chang",
      attributes: {
        CustomerEndpointAddress: "+84798171999"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.doesNotMatch(result.body.data.lexResponse.message, /what time|may i have your name|what name/i);
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Lee");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "15:00");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang);

  const negative = await postInternalAppointment(
    bookingPayload({
      requestedTime: undefined,
      confirmationState: undefined,
      currentTurnTranscript: "Tell me about GPS",
      transcript: "Tell me about GPS"
    })
  );

  assert.notEqual(negative.body.data.lexResponse.sessionAttributes.requestedTime, "15:00");
});

test("known caller rejection without a new name asks for name and preserves booking fields", async () => {
  state.customers.push({
    id: "customer-lee-reject",
    salonId: ids.salonA,
    firstName: "Lee",
    lastName: "Stored",
    phone: "84798171999",
    createdAt: new Date("2026-01-10T00:00:00.000Z")
  } as any);

  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+84798171999",
      serviceName: "Full Set",
      requestedDate: "2026-05-28",
      requestedTime: "2 PM",
      staffPreference: "Trang",
      staffId: ids.trang,
      confirmationState: undefined,
      amazonConnectContactId: "connect-known-lee-reject",
      currentTurnTranscript: "That's not me.",
      transcript: "That's not me.",
      attributes: {
        CustomerEndpointAddress: "+84798171999",
        serviceName: "Full Set",
        requestedDate: "2026-05-28",
        requestedTime: "2 PM",
        staffPreference: "Trang",
        staffId: ids.trang
      }
    })
  );

  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "customerName");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerNameSource, "current_turn_rejected_profile");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, "2026-05-28");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "2 PM");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
});

test("partial booking fragment asks for service without greeting again", async () => {
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
      transcript: "i want to book",
      currentTurnTranscript: "i want to book",
      attributes: {
        CustomerEndpointAddress: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.match(result.body.data.lexResponse.message, /Sure\. Which service would you like\?/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /Welcome back/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /Sorry, I/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /list the services/i);
  assert.equal(state.appointments.length, 0);
});

test("recognized customer name noise is not reused for greeting or booking summary", async () => {
  state.customers.push({
    id: "customer-with-noise",
    salonId: ids.salonA,
    firstName: "with",
    lastName: "",
    phone: "8483489999",
    createdAt: new Date("2026-01-02T00:00:00.000Z")
  });

  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+18483489999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      attributes: {
        CustomerEndpointAddress: "+18483489999"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerId, "customer-with-noise");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.recognizedCustomerName, undefined);
  assert.doesNotMatch(result.body.data.lexResponse.message, /Welcome back,\s*with/i);
  assert.equal(state.appointments.length, 0);
});

test("customerName turn rejects with Kevin noise and accepts clear call-me phrase", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  const noise = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+18483481234",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      currentTurnTranscript: "with Kevin",
      transcript: "with Kevin",
      attributes: {
        lastAskedSlot: "customerName",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerPhone: "+18483481234"
      }
    })
  );

  assert.equal(noise.response.status, 200);
  assert.equal(noise.body.data.lexResponse.dialogAction.slotToElicit, "customerName");
  assert.equal(noise.body.data.lexResponse.sessionAttributes.customerName, undefined);
  assert.equal(state.customers.some((customer) => customer.firstName === "with"), false);
  assert.notEqual(state.bookingAttempts.at(-1)?.customerName, "with");

  const clearName = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+18483481235",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      currentTurnTranscript: "you can call me Lee",
      transcript: "you can call me Lee",
      attributes: {
        lastAskedSlot: "customerName",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerPhone: "+18483481235"
      }
    })
  );

  assert.equal(clearName.response.status, 200);
  assert.equal(clearName.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(clearName.body.data.lexResponse.sessionAttributes.customerName, "Lee");
  assert.equal(state.appointments.length, 0);
});

test("explicit customer name stays sticky through first available and time change", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const contactId = "connect-sticky-name";
  state.customers.push({
    id: "customer-invalid-phone-name",
    salonId: ids.salonA,
    firstName: "with",
    lastName: "",
    phone: "18483481236",
    createdAt: new Date("2026-01-02T00:00:00.000Z")
  });

  const nameTurn = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+18483481236",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      currentTurnTranscript: "my name is Pham",
      transcript: "my name is Pham",
      attributes: {
        AmazonConnectContactId: contactId,
        lastAskedSlot: "customerName",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        customerPhone: "+18483481236"
      }
    })
  );

  assert.equal(nameTurn.response.status, 200);
  assert.equal(nameTurn.body.data.lexResponse.sessionAttributes.customerName, "Pham");
  assert.equal(nameTurn.body.data.lexResponse.sessionAttributes.customerNameSource, "current_turn_explicit");
  assert.equal(nameTurn.body.data.lexResponse.sessionAttributes.customerNameNeedsReview, undefined);
  assert.doesNotMatch(nameTurn.body.data.lexResponse.message, /Welcome back,\s*with/i);

  const staffTurn = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+18483481236",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      currentTurnTranscript: "first available",
      transcript: "first available",
      attributes: {
        ...nameTurn.body.data.lexResponse.sessionAttributes,
        AmazonConnectContactId: contactId,
        lastAskedSlot: "staffPreference"
      }
    })
  );

  assert.equal(staffTurn.response.status, 200);
  assert.equal(staffTurn.body.data.lexResponse.sessionAttributes.customerName, "Pham");
  assert.notEqual(staffTurn.body.data.lexResponse.dialogAction.slotToElicit, "customerName");
  assert.doesNotMatch(staffTurn.body.data.lexResponse.message, /catch your name|May I have your name/i);

  const timeTurn = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+18483481236",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      currentTurnTranscript: "change it to eleven a m",
      transcript: "change it to eleven a m",
      attributes: {
        ...staffTurn.body.data.lexResponse.sessionAttributes,
        AmazonConnectContactId: contactId,
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true"
      }
    })
  );

  assert.equal(timeTurn.response.status, 200);
  assert.equal(timeTurn.body.data.lexResponse.sessionAttributes.customerName, "Pham");
  assert.notEqual(timeTurn.body.data.lexResponse.dialogAction.slotToElicit, "customerName");
  assert.doesNotMatch(timeTurn.body.data.lexResponse.message, /catch your name|May I have your name/i);
  assert.equal(state.customers.some((customer) => customer.firstName === "with" && customer.id !== "customer-invalid-phone-name"), false);
});

test("AI caller memory does not reuse names from historical booking attempts", async () => {
  const first = await postInternalAppointment(
    bookingPayload({
      customerName: "Thuyet",
      customerPhone: "+84798171999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "my name is Thuyet",
      amazonConnectContactId: undefined
    })
  );

  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.outcome, "MISSING_INFO");
  assert.equal(state.bookingAttempts.at(-1)?.customerName, "Thuyet");
  assert.equal(state.bookingAttempts.at(-1)?.customerPhone, "+84798171999");
  state.bookingAttempts.push({
    id: "attempt-bad-caller-name",
    salonId: ids.salonA,
    callSessionId: null,
    status: BookingAttemptStatus.NEEDS_INPUT,
    source: "amazon_connect_ai",
    customerName: "three",
    customerPhone: "+84798171999",
    requestedService: "Full Set",
    requestedStaff: null,
    requestedDateTimeText: "2026-07-09",
    normalizedRequest: {},
    failureReason: "Historical misrecognized caller name.",
    rawInput: {},
    createdAt: new Date(Date.now() + 1000),
    updatedAt: new Date(Date.now() + 1000)
  });

  const second = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+84798171999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "I want to book a manicure",
      amazonConnectContactId: undefined
    })
  );

  assert.equal(second.response.status, 200);
  assert.equal(second.body.data.lexResponse.sessionAttributes.customerName, undefined);
  assert.equal(second.body.data.lexResponse.sessionAttributes.customerPhone, "+84798171999");
  assert.equal(second.body.data.lexResponse.sessionAttributes.customerNameSource, undefined);
  assert.equal(second.body.data.missingFields.includes("customerName"), true);
  assert.equal(second.body.data.missingFields.includes("customerPhone"), false);
  assert.match(second.body.data.lexResponse.message, /May I have your name/i);
  assert.notEqual(second.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
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
  assert.match(result.body.data.lexResponse.message, /May I have your name/i);
});

test("Full Set phrase reaches confirmation without asking service again", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript:
        "Hi, I want to book Full Set tomorrow at 3 PM with Trang. My name is Kiet Nguyen. My phone number is 7325956266."
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.notEqual(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.match(result.body.data.lexResponse.message, /just to confirm: Full Set tomorrow at 3 PM with Trang/i);
  assert.deepEqual(new Set(state.validationStaffIds), new Set([ids.trang]));
  assert.equal(state.appointments.length, 0);
});

test("production Full Set and Trang ASR variants reach one final confirmation", async () => {
  const expectedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const cases = [
    "book full set tomorrow at two pm with frank",
    "book princess tomorrow at two pm with jen",
    "food set tomorrow at two p m with hang",
    "book full set tomorrow at two pm with trang"
  ];

  for (const phrase of cases) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: undefined,
        requestedDate: undefined,
        requestedTime: undefined,
        staffPreference: undefined,
        confirmationState: undefined,
        amazonConnectContactId: `connect-${phrase.replace(/[^a-z0-9]+/g, "-")}`,
        currentTurnTranscript: phrase,
        transcript: phrase
      })
    );

    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, expectedDate, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang, phrase);
    assert.match(result.body.data.lexResponse.message, /just to confirm: Full Set tomorrow at 2 PM with Trang/i, phrase);
    assert.equal(state.callSessions.length, 1, phrase);
    assert.equal(state.aiInteractionLogs.length, 1, phrase);
    assert.equal(state.appointments.length, 0, phrase);
  }
});

test("Trang ASR confusion does not override active exact Frank Jen or Hang staff", async () => {
  const staffByName = [
    ["Frank", "10000000-0000-4000-8000-000000000020"],
    ["Jen", "10000000-0000-4000-8000-000000000021"],
    ["Hang", "10000000-0000-4000-8000-000000000022"]
  ] as const;

  for (const [staffName, staffId] of staffByName) {
    resetMockState();
    state.staff.push({
      id: staffId,
      salonId: ids.salonA,
      fullName: staffName,
      status: StaffStatus.ACTIVE,
      isBookable: true,
      createdAt: new Date("2026-01-07T00:00:00.000Z")
    });
    state.staffServiceMappings?.push({
      salonId: ids.salonA,
      staffId,
      serviceId: ids.fullSet
    });

    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: undefined,
        requestedDate: undefined,
        requestedTime: undefined,
        staffPreference: undefined,
        confirmationState: undefined,
        currentTurnTranscript: `book full set tomorrow at two pm with ${staffName.toLowerCase()}`,
        transcript: `book full set tomorrow at two pm with ${staffName.toLowerCase()}`
      })
    );

    assert.equal(result.response.status, 200, staffName);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", staffName);
    assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set", staffName);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, staffName, staffName);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, staffId, staffName);
    assert.doesNotMatch(result.body.data.lexResponse.message, /with Trang/i, staffName);
  }
});

test("Trang and Princess corrections are scoped away from names time changes and unrelated text", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  const nameTurn = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      currentTurnTranscript: "my name is Jen",
      transcript: "my name is Jen",
      attributes: {
        lastAskedSlot: "customerName",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "2 PM",
        customerPhone: "+17325956266"
      }
    })
  );
  assert.equal(nameTurn.response.status, 200);
  assert.equal(nameTurn.body.data.lexResponse.sessionAttributes.customerName, "Jen");
  assert.notEqual(nameTurn.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");

  const timeTurn = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      currentTurnTranscript: "change it to two PM",
      transcript: "change it to two PM",
      attributes: {
        lastAskedSlot: "requestedTime",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );
  assert.equal(timeTurn.response.status, 200);
  assert.notEqual(timeTurn.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(timeTurn.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");

  const unrelatedPrincess = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      currentTurnTranscript: "my daughter is a princess",
      transcript: "my daughter is a princess"
    })
  );
  assert.equal(unrelatedPrincess.response.status, 200);
  assert.notEqual(unrelatedPrincess.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(unrelatedPrincess.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
});

test("current turn staff alias overrides stale staff while preserving Jane", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  state.customers.push({
    id: "89e51525-297d-4b2a-b438-f64c4848683a",
    salonId: ids.salonA,
    firstName: "Jane",
    lastName: "",
    phone: "+84978634886",
    createdAt: new Date("2026-07-10T00:00:00.000Z")
  });

  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "Jane",
      customerPhone: "+84978634886",
      callerPhone: "+84978634886",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "marvell",
      confirmationState: undefined,
      amazonConnectContactId: "bb0b6ac3-a5be-4c9d-abac-7297a301d7bc",
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "at three p m with chang",
      transcript: "it one pull step the marvell at three p m with chang",
      attributes: {
        AmazonConnectContactId: "bb0b6ac3-a5be-4c9d-abac-7297a301d7bc",
        CustomerEndpointAddress: "+84978634886",
        lastAskedSlot: "requestedTime",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "marvell",
        customerName: "Jane",
        recognizedCustomerName: "Jane",
        customerNameSource: "customer",
        customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
        customerPhone: "+84978634886"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerId, "89e51525-297d-4b2a-b438-f64c4848683a");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Jane");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerPhone, "+84978634886");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "3 PM");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(result.body.data.lexResponse.sessionAttributes.selectedStaffId, ids.trang);
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffId, ids.trang);
  assert.doesNotMatch(JSON.stringify(result.body.data.lexResponse.sessionAttributes), /marvell/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /what service|which service|staff would you like|what name/i);
  assert.match(result.body.data.lexResponse.message, /Jane, just to confirm: Full Set tomorrow at 3 PM with Trang/i);
  assert.equal(state.appointments.length, 0);
});

test("Emmy and correction staff phrases resolve to Amy without selecting Trang", async () => {
  const phrases = [
    "Amy",
    "Amie",
    "Emmy",
    "Emmie",
    "with emmy",
    "I want emmy",
    "no I want emmy not change",
    "Emmy, not Trang",
    "Amy, not Trang",
    "Not Trang, Amy",
    "No, Amy"
  ];

  for (const phrase of phrases) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        staffPreference: phrase,
        confirmationState: undefined,
        currentTurnTranscript: phrase,
        transcript: phrase
      })
    );

    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Amy", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.amy, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.selectedStaffId, ids.amy, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffId, ids.amy, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Amy", phrase);
    assert.doesNotMatch(result.body.data.lexResponse.message, /with Trang|found Trang/i, phrase);
    if (/Trang/i.test(phrase)) {
      assert.match(result.body.data.lexResponse.message, /exclude Trang/i, phrase);
    }
    assert.match(result.body.data.lexResponse.message, /Amy/i, phrase);
    assert.deepEqual(new Set(state.validationStaffIds), new Set([ids.amy]), phrase);
    assert.equal(state.appointments.length, 0, phrase);
  }
});

test("unknown explicit staff asks clarification without reusing Trang or Any staff", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      requestedDate,
      requestedTime: "11 AM",
      staffPreference: "Trang",
      staffId: ids.trang,
      confirmationState: undefined,
      currentTurnTranscript: "with Emily",
      transcript: "with Emily",
      attributes: {
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "11 AM",
        staffPreference: "Trang",
        staffId: ids.trang,
        selectedStaffId: ids.trang,
        confirmedStaffId: ids.trang,
        confirmedStaffName: "Trang",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266",
        lastAskedSlot: "staffPreference"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.match(result.body.data.lexResponse.message, /didn't find that technician/i);
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "11 AM");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.selectedStaffId, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffId, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, undefined);
  assert.deepEqual(state.validationStaffIds, []);
  assert.equal(state.appointments.length, 0);
});

test("final confirmation correction from Emmy replaces Trang and books Amy only after fresh yes", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const contactId = "connect-emmy-correction";

  const correction = await postInternalAppointment(
    bookingPayload({
      requestedDate,
      requestedTime: "11 AM",
      staffPreference: "Trang",
      staffId: ids.trang,
      customerName: "Jane",
      customerPhone: "+18485550123",
      confirmationState: "None",
      amazonConnectContactId: contactId,
      currentTurnTranscript: "no i want emmy not chang",
      transcript: "no i want emmy not chang",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        confirmationFingerprint: "old-trang-fingerprint",
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "11 AM",
        staffPreference: "Trang",
        staffId: ids.trang,
        selectedStaffId: ids.trang,
        confirmedStaffId: ids.trang,
        confirmedStaffName: "Trang",
        customerName: "Jane",
        customerPhone: "+18485550123"
      }
    })
  );

  assert.equal(correction.response.status, 200);
  assert.equal(correction.body.data.outcome, "MISSING_INFO");
  assert.equal(correction.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(correction.body.data.lexResponse.sessionAttributes.requestedTime, "11 AM");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.customerName, "Jane");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
  assert.equal(correction.body.data.lexResponse.sessionAttributes.staffId, ids.amy);
  assert.equal(correction.body.data.lexResponse.sessionAttributes.selectedStaffId, ids.amy);
  assert.equal(correction.body.data.lexResponse.sessionAttributes.confirmedStaffId, ids.amy);
  assert.equal(correction.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Amy");
  assert.notEqual(
    correction.body.data.lexResponse.sessionAttributes.confirmationFingerprint,
    "old-trang-fingerprint"
  );
  assert.match(correction.body.data.lexResponse.message, /Amy/i);
  assert.match(correction.body.data.lexResponse.message, /exclude Trang/i);
  assert.doesNotMatch(correction.body.data.lexResponse.message, /with Trang|found Trang/i);
  assert.equal(state.appointments.length, 0);

  const confirmed = await postInternalAppointment(
    bookingPayload({
      requestedDate,
      requestedTime: "11 AM",
      staffPreference: "Amy",
      staffId: ids.amy,
      customerName: "Jane",
      customerPhone: "+18485550123",
      confirmationState: "Confirmed",
      amazonConnectContactId: contactId,
      currentTurnTranscript: "yes",
      transcript: "yes",
      attributes: correction.body.data.lexResponse.sessionAttributes
    })
  );

  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.appointments[0].staffId, ids.amy);
  assert.match(confirmed.body.data.lexResponse.message, /Amy/i);
});

test("not Trang without replacement excludes Trang and confirms next eligible staff", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      requestedDate,
      requestedTime: "11 AM",
      staffPreference: "Trang",
      staffId: ids.trang,
      customerName: "Jane",
      customerPhone: "+18485550124",
      confirmationState: "None",
      currentTurnTranscript: "No, not Trang",
      transcript: "No, not Trang",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "11 AM",
        staffPreference: "Trang",
        staffId: ids.trang,
        selectedStaffId: ids.trang,
        confirmedStaffId: ids.trang,
        confirmedStaffName: "Trang",
        customerName: "Jane",
        customerPhone: "+18485550124"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "11 AM");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Jane");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.amy);
  assert.match(result.body.data.lexResponse.sessionAttributes.excludedStaffIds, new RegExp(ids.trang));
  assert.match(result.body.data.lexResponse.sessionAttributes.excludedStaffNames, /trang/i);
  assert.match(result.body.data.lexResponse.message, /exclude Trang/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /with Trang/i);
  assert.equal(state.appointments.length, 0);
});

test("Emmy is ambiguous when salon also has an active bookable Emmy", async () => {
  const emmyId = "10000000-0000-4000-8000-000000000009";
  state.staff.push({
    id: emmyId,
    salonId: ids.salonA,
    fullName: "Emmy",
    status: StaffStatus.ACTIVE,
    isBookable: true,
    createdAt: new Date("2026-01-04T00:00:00.000Z")
  });
  state.staffServiceMappings?.push({
    salonId: ids.salonA,
    staffId: emmyId,
    serviceId: ids.pedicure
  });

  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: "with Emmy",
      confirmationState: undefined,
      currentTurnTranscript: "with Emmy",
      transcript: "with Emmy",
      attributes: {
        lastAskedSlot: "staffPreference"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, undefined);
  assert.match(result.body.data.lexResponse.message, /Amy/i);
  assert.match(result.body.data.lexResponse.message, /Emmy/i);
  assert.deepEqual(state.validationStaffIds, []);
  assert.equal(state.appointments.length, 0);
});

test("one-shot Full Set greeting with spoken p m captures time before confirmation", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  state.customers.push({
    id: "89e51525-297d-4b2a-b438-f64c4848683a",
    salonId: ids.salonA,
    firstName: "Jane",
    lastName: "",
    phone: "+84978634886",
    createdAt: new Date("2026-07-10T00:00:00.000Z")
  });

  const transcript = "Hi, I want to book Full Set tomorrow at three p m with Trang.";
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "Jane",
      customerPhone: "+84978634886",
      callerPhone: "+84978634886",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "codex-live-oneshot-spoken-pm",
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: transcript,
      transcript,
      attributes: {
        AmazonConnectContactId: "codex-live-oneshot-spoken-pm",
        CustomerEndpointAddress: "+84978634886",
        currentTurnTranscript: transcript,
        customerName: "Jane",
        recognizedCustomerName: "Jane",
        customerNameSource: "customer",
        customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
        customerPhone: "+84978634886"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Jane");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "15:00");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.match(result.body.data.lexResponse.message, /Jane, just to confirm: Full Set tomorrow at 3 PM with Trang/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /What time|what service|what name|Which staff/i);
});

test("Full Set full utterance with Lee keeps service date time and staff", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+84798171999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "I want to book a Full Set tomorrow at 3 PM with Trang. My name is Lee."
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Lee");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerPhone, "+84798171999");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "15:00");
  assert.notEqual(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(result.body.data.lexResponse.dialogAction.slotToElicit, "requestedDate");
  assert.notEqual(result.body.data.lexResponse.dialogAction.slotToElicit, "requestedTime");
  assert.notEqual(result.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
});

test("spoken Lee creates a new customer without inheriting Phan", async () => {
  const customerPhone = "+84999990001";
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "Lee",
      customerPhone,
      serviceName: "Full Set",
      staffPreference: "Trang",
      confirmationState: "Confirmed",
      amazonConnectContactId: "connect-spoken-lee-new-profile"
    })
  );

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  const customer = state.customers.find((item) => item.phone === customerPhone);
  assert.ok(customer);
  assert.equal(customer.firstName, "Lee");
  assert.equal(customer.lastName, "");
  assert.equal(state.appointments[0].customerId, customer.id);
});

test("existing Lee Phan profile is reused without silently overwriting surname", async () => {
  const customerPhone = "+84999990002";
  state.customers.push({
    id: "customer-lee-phan",
    salonId: ids.salonA,
    firstName: "Lee",
    lastName: "Phan",
    phone: customerPhone,
    createdAt: new Date("2026-01-10T00:00:00.000Z")
  } as any);

  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "Lee",
      customerPhone,
      serviceName: "Full Set",
      staffPreference: "Trang",
      confirmationState: "Confirmed",
      amazonConnectContactId: "connect-spoken-lee-existing-profile",
      currentTurnTranscript: "my name is Lee",
      transcript: "my name is Lee"
    })
  );

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  const customer = state.customers.find((item) => item.id === "customer-lee-phan");
  assert.equal(customer?.firstName, "Lee");
  assert.equal(customer?.lastName, "Phan");
  assert.equal(state.appointments[0].customerId, "customer-lee-phan");
  assert.equal(state.bookingAttempts.at(-1)?.normalizedRequest.recognizedCustomerId, "customer-lee-phan");
  assert.equal(state.bookingAttempts.at(-1)?.normalizedRequest.spokenCustomerName, "Lee");
  assert.equal(state.bookingAttempts.at(-1)?.normalizedRequest.persistedCustomerFirstName, "Lee");
  assert.equal(state.bookingAttempts.at(-1)?.normalizedRequest.persistedCustomerLastName, "Phan");
  assert.equal(state.bookingAttempts.at(-1)?.normalizedRequest.customerProfileSource, "active_customer");
});

test("Full Set speech aliases resolve to the active Full Set service", async () => {
  for (const phrase of [
    "full set",
    "fullset",
    "full-set",
    "full sets",
    "full nail set",
    "nail full set",
    "full nail",
    "nail set",
    "new set",
    "complete set",
    "false set",
    "fall set",
    "four set",
    "phone set",
    "room set",
    "pull set",
    "pull step",
    "pool set",
    "food set",
    "fool set",
    "foot set",
    "boom set",
    "book a set",
    "want a set",
    "a nail set",
    "full step",
    "full said",
    "fullsat",
    "set of nails"
  ]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: undefined,
        requestedDate: undefined,
        requestedTime: undefined,
        staffPreference: "Trang",
        confirmationState: undefined,
        transcript: `I want to book a ${phrase} tomorrow at 3 PM. My name is Kiet Nguyen. My phone number is 7325956266.`
      })
    );

    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set", phrase);
    assert.notEqual(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName", phrase);
  }
});

test("invalid placeholder services are cleared and active service menu excludes inactive Gel", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "test service",
      staffPreference: "Trang",
      confirmationState: undefined,
      currentTurnTranscript: "test service",
      transcript: "test service",
      attributes: {
        serviceName: "service",
        confirmedServiceName: "test service",
        requestedDate: "2026-05-28",
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, undefined);
  assert.doesNotMatch(result.body.data.lexResponse.message, /I have your service/i);
  assert.doesNotMatch(result.body.data.lexResponse.sessionAttributes.activeDtmfOptionsJson, /Gel Manicure/);
  assert.doesNotMatch(result.body.data.lexResponse.sessionAttributes.activeServiceNames, /Gel Manicure/);
  assert.equal(state.bookingAttempts.at(-1)?.requestedService, undefined);
});

test("unsupported service requests activate service DTMF and never become staff", async () => {
  for (const phrase of ["I want gel", "I want gel nails", "I want haircut", "I want a facial"]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: undefined,
        requestedDate: undefined,
        requestedTime: undefined,
        staffPreference: undefined,
        confirmationState: undefined,
        amazonConnectContactId: `connect-unsupported-${phrase.replace(/\W+/g, "-")}`,
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          currentTurnTranscript: phrase,
          customerName: "Lee",
          customerPhone: "+17325956266"
        }
      })
    );

    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot", phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.activeDtmfMenu, "service", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, undefined, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, undefined, phrase);
    assert.equal(state.bookingAttempts.at(-1)?.requestedStaff, undefined, phrase);
    assert.equal(state.bookingAttempts.at(-1)?.normalizedRequest.serviceClarificationReason, "unsupported_service", phrase);
    assert.doesNotMatch(result.body.data.lexResponse.sessionAttributes.activeServiceNames, /Gel Manicure/, phrase);
    assert.doesNotMatch(result.body.data.lexResponse.sessionAttributes.activeDtmfOptionsJson, /Gel Manicure/, phrase);
    assert.match(result.body.data.lexResponse.message, /available services|Press 1/i, phrase);
    assert.equal(state.appointments.length, 0, phrase);
  }
});

test("verified pedicure ASR and service menu fallback preserve exact Manicure", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const fiftyKill = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate,
      requestedTime: "11 AM",
      staffPreference: "Amy",
      staffId: ids.amy,
      confirmationState: undefined,
      currentTurnTranscript: "fifty kill",
      transcript: "fifty kill",
      attributes: {
        lastAskedSlot: "serviceName",
        requestedDate,
        requestedTime: "11 AM",
        staffPreference: "Amy",
        staffId: ids.amy,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(fiftyKill.response.status, 200);
  assert.equal(fiftyKill.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(fiftyKill.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(fiftyKill.body.data.lexResponse.sessionAttributes.requestedTime, "11 AM");
  assert.equal(fiftyKill.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
  assert.equal(state.appointments.length, 0);

  resetMockState();
  const manicure = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate,
      requestedTime: "11 AM",
      staffPreference: "Amy",
      staffId: ids.amy,
      confirmationState: undefined,
      currentTurnTranscript: "manicure",
      transcript: "manicure",
      attributes: {
        lastAskedSlot: "serviceName",
        requestedDate,
        requestedTime: "11 AM",
        staffPreference: "Amy",
        staffId: ids.amy,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(manicure.response.status, 200);
  assert.equal(manicure.body.data.lexResponse.sessionAttributes.serviceName, "Manicure");
  assert.notEqual(manicure.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
});

test("first unresolved service attempt provides stable numbered menu and DTMF 1 selects Pedicure", async () => {
  const requestedDate = "2026-05-28";
  const first = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate,
      requestedTime: "5 PM",
      staffPreference: "Amy",
      staffId: ids.amy,
      confirmationState: undefined,
      currentTurnTranscript: "fifty unknown",
      transcript: "fifty unknown",
      attributes: {
        lastAskedSlot: "serviceName",
        serviceClarificationAttempts: "1",
        requestedDate,
        requestedTime: "5 PM",
        staffPreference: "Amy",
        staffId: ids.amy,
        knownCallerAcknowledged: "true",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  const firstAttrs = first.body.data.lexResponse.sessionAttributes;
  assert.equal(first.body.data.outcome, "MISSING_INFO");
  assert.equal(first.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.equal(firstAttrs.activeDtmfMenu, "service");
  assert.match(first.body.data.lexResponse.message, /Press 1 for Pedicure.*Press 2 for Manicure.*Press 3 for Full Set.*Press 4 for Dip Powder/i);
  assert.equal(JSON.parse(firstAttrs.activeDtmfOptionsJson)["1"], "Pedicure");
  assert.equal(JSON.parse(firstAttrs.serviceDtmfServiceIds)["1"], ids.pedicure);
  assert.equal(firstAttrs.serviceRecognitionFailureCount, "1");

  const second = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "1",
      attributes: firstAttrs
    })
  );

  const secondAttrs = second.body.data.lexResponse.sessionAttributes;
  assert.equal(second.response.status, 200);
  assert.equal(secondAttrs.serviceName, "Pedicure");
  assert.equal(secondAttrs.confirmedServiceName, "Pedicure");
  assert.equal(secondAttrs.requestedDate, requestedDate);
  assert.equal(secondAttrs.requestedTime, "5 PM");
  assert.equal(secondAttrs.staffPreference, "Amy");
  assert.equal(secondAttrs.staffId, ids.amy);
  assert.equal(state.appointments.length, 0);
});

test("ambiguous Manicure after unresolved service asks confirmation with service keypad", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Manicure",
      requestedDate: "2026-05-28",
      requestedTime: "5 PM",
      staffPreference: "Amy",
      staffId: ids.amy,
      confirmationState: undefined,
      currentTurnTranscript: "manicure",
      transcript: "manicure",
      attributes: {
        lastAskedSlot: "serviceName",
        serviceRecognitionFailureCount: "1",
        asrDiagnostics: JSON.stringify({
          topTranscript: "manicure",
          nBestAlternatives: [
            { transcript: "manicure", confidence: 0.62 },
            { transcript: "pedicure", confidence: 0.58 }
          ],
          confidence: 0.62,
          inputMode: "Speech"
        }),
        requestedDate: "2026-05-28",
        requestedTime: "5 PM",
        staffPreference: "Amy",
        staffId: ids.amy,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  const attrs = result.body.data.lexResponse.sessionAttributes;
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.equal(attrs.serviceName, undefined);
  assert.match(result.body.data.lexResponse.message, /I heard Manicure.*misheard Pedicure/i);
  assert.match(result.body.data.lexResponse.message, /Press 1 for Pedicure/i);
  assert.equal(attrs.activeDtmfMenu, "service");
  assert.equal(state.appointments.length, 0);
});

test("generic gel asks before selecting the one active gel-related alternative", async () => {
  state.services.push({
    id: "20000000-0000-4000-8000-000000000006",
    salonId: ids.salonA,
    name: "Builder Gel Fill Update",
    durationMinutes: 80,
    priceCents: 7000,
    isActive: true,
    createdAt: new Date("2026-01-06T00:00:00.000Z")
  });

  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-gel-builder-clarify",
      currentTurnTranscript: "I want gel",
      transcript: "I want gel",
      attributes: {
        customerName: "Lee",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceSuggestionName, "Builder Gel Fill Update");
  assert.match(result.body.data.lexResponse.message, /Did you mean Builder Gel Fill Update/i);
  assert.equal(state.appointments.length, 0);
});

test("current food set wins over stale placeholder service", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      staffPreference: "Trang",
      confirmationState: undefined,
      currentTurnTranscript: "food set",
      transcript: "food set",
      attributes: {
        lastAskedSlot: "serviceName",
        serviceName: "test service",
        confirmedServiceName: "test service",
        requestedDate: "2026-05-28",
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.match(result.body.data.lexResponse.message, /just to confirm: Full Set .* with Trang/i);
  assert.equal(state.bookingAttempts.at(-1)?.requestedService, "Full Set");
});

test("food without set does not resolve to Full Set", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      staffPreference: "Trang",
      confirmationState: undefined,
      currentTurnTranscript: "I need food",
      transcript: "I need food",
      attributes: {
        requestedDate: "2026-05-28",
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(state.bookingAttempts.at(-1)?.requestedService, undefined);
});

test("scoped princess ASR resolves to Full Set unless Princess is an active exact service", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  let result = await postInternalAppointment(
    bookingPayload({
      serviceName: "princess",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      currentTurnTranscript: "princess",
      transcript: "princess",
      attributes: {
        lastAskedSlot: "serviceName",
        activeDtmfMenu: "service",
        serviceAliasCorrectionRaw: "princess"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.notEqual(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");

  resetMockState();
  const princessServiceId = "20000000-0000-4000-8000-000000000099";
  state.services.push({
    id: princessServiceId,
    salonId: ids.salonA,
    name: "Princess",
    durationMinutes: 30,
    priceCents: 3000,
    isActive: true,
    createdAt: new Date("2026-01-06T00:00:00.000Z")
  });
  state.staffServiceMappings?.push({
    salonId: ids.salonA,
    staffId: ids.trang,
    serviceId: princessServiceId
  });

  result = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      currentTurnTranscript: "book princess tomorrow at two pm with trang",
      transcript: "book princess tomorrow at two pm with trang",
      attributes: {
        serviceAliasCorrectionRaw: "princess"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Princess");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Princess");
  assert.match(result.body.data.lexResponse.message, /Princess/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /Full Set/i);
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
  assert.equal(state.bookingAttempts.at(-1).normalizedRequest.staffId, ids.trang);
  assert.equal(state.bookingAttempts.at(-1).normalizedRequest.selectedStaffId, ids.trang);
  assert.equal(state.bookingAttempts.at(-1).normalizedRequest.confirmedStaffId, ids.trang);
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(result.body.data.lexResponse.sessionAttributes.selectedStaffId, ids.trang);
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffId, ids.trang);
  assert.match(result.body.data.lexResponse.message, /with Trang/i);
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
    assert.match(result.body.data.lexResponse.message, /just to confirm: Pedicure .* with Trang/i);
    assert.equal(state.appointments.length, 0);
  }
});

test("logged eddie here utterance matches Pedicure for known caller without overwriting Kiet", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+17325956266",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: "Trang",
      confirmationState: undefined,
      transcript: "I want to have eddie here tomorrow at seven p.m.",
      attributes: {
        CustomerEndpointAddress: "+17325956266",
        customerName: "Kit"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Kiet");
  assert.equal(result.body.data.lexResponse.sessionAttributes.recognizedCustomerName, "Kiet");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "19:00");
  assert.match(result.body.data.lexResponse.message, /Pedicure .* with Trang/i);
  assert.equal(state.appointments.length, 0);
});

test("unrelated service noise does not map to Pedicure", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: undefined,
      callerPhone: "+17325956266",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: "Trang",
      confirmationState: undefined,
      transcript: "I want to have a haircut tomorrow at seven p.m."
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, undefined);
  assert.equal(state.appointments.length, 0);
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
  assert.match(result.body.data.lexResponse.message, /just to confirm: Pedicure .* with Trang/i);
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
  assert.match(result.body.data.lexResponse.message, /just to confirm: Pedicure .* with Kelly/i);
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
  assert.match(result.body.data.lexResponse.message, /1 for Pedicure/i);
  assert.match(result.body.data.lexResponse.message, /2 for Manicure/i);
  assert.match(result.body.data.lexResponse.message, /4 for Dip Powder/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /Gel Manicure/i);
  assert.match(result.body.data.lexResponse.message, /0 for a person/i);
  assert.equal(result.body.data.lexResponse.sessionAttributes.activeDtmfMenu, "service");
  assert.equal(state.escalations.length, 0);
  assert.equal(state.appointments.length, 0);
});

test("unclear staff keeps asking instead of defaulting to first available", async () => {
  const first = await postInternalAppointment(
    bookingPayload({
      staffPreference: "Not A Real Technician",
      confirmationState: undefined
    })
  );

  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.outcome, "MISSING_INFO");
  assert.equal(first.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(first.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.match(first.body.data.lexResponse.message, /Which staff would you like, Trang, Amy, Kelly, or first available/i);
  assert.equal(first.body.data.lexResponse.sessionAttributes.activeDtmfMenu, "staff");
  assert.equal(state.appointments.length, 0);

  const second = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "I am not sure",
      attributes: first.body.data.lexResponse.sessionAttributes
    })
  );

  assert.equal(second.response.status, 200);
  assert.equal(second.body.data.outcome, "MISSING_INFO");
  assert.equal(second.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(second.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.equal(second.body.data.lexResponse.sessionAttributes.staffPreference, undefined);
  assert.equal(second.body.data.lexResponse.sessionAttributes.staffId, undefined);
  assert.match(second.body.data.lexResponse.message, /Which staff would you like, Trang, Amy, Kelly, or first available/i);
  assert.equal(second.body.data.lexResponse.sessionAttributes.staffMenuWasSpoken, undefined);
  assert.equal(state.appointments.length, 0);
});

test("service DTMF applies only to serviceName before staff prompt", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "1",
      attributes: {
        lastAskedSlot: "serviceName",
        activeDtmfMenu: "service",
        activeDtmfOptionsJson: JSON.stringify({ "1": "Pedicure", "0": "__operator__" }),
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
  assert.match(result.body.data.lexResponse.message, /Which staff would you like, Trang, Amy, Kelly, or first available/i);
  assert.equal(state.appointments.length, 0);
});

test("service DTMF 4 maps to Full Set", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      staffPreference: "Trang",
      confirmationState: undefined,
      transcript: "4",
      attributes: {
        lastAskedSlot: "serviceName",
        activeDtmfMenu: "service",
        activeDtmfOptionsJson: JSON.stringify({ "4": "Full Set", "0": "__operator__" }),
        serviceName: "unclear",
        requestedDate: "2026-05-28",
        requestedTime: "3 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.match(result.body.data.lexResponse.message, /just to confirm: Full Set .* with Trang/i);
  assert.deepEqual(new Set(state.validationStaffIds), new Set([ids.trang]));
  assert.equal(state.appointments.length, 0);
});

test("service digit does not map without active service DTMF menu", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      staffPreference: "Trang",
      confirmationState: undefined,
      transcript: "4",
      attributes: {
        lastAskedSlot: "serviceName",
        requestedDate: "2026-05-28",
        requestedTime: "3 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(state.appointments.length, 0);
});

test("digit noise after Full Set tomorrow 3 PM preserves previous date and time", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "Kiet Nguyen",
      customerPhone: "+17325956266",
      serviceName: "Full Set",
      requestedDate: "2027-02-03",
      requestedTime: "2 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "two three",
      currentTurnTranscript: "two three",
      attributes: {
        lastAskedSlot: "requestedDate",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate: "2026-05-28",
        requestedTime: "3 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, "2026-05-28");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "3 PM");
  assert.notEqual(result.body.data.lexResponse.sessionAttributes.requestedDate, "2027-02-03");
  assert.match(result.body.data.lexResponse.message, /Which staff would you like, Trang, Amy, Kelly, or first available/i);
  assert.equal(state.appointments.length, 0);
});

test("active service DTMF menu maps 4 to Full Set before stale lastAskedSlot", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "Kiet Nguyen",
      customerPhone: "+17325956266",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "4",
      attributes: {
        lastAskedSlot: "requestedDate",
        activeDtmfMenu: "service",
        activeDtmfOptionsJson: JSON.stringify({ "4": "Full Set" }),
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "requestedDate");
});

test("active staff DTMF menu maps digit without polluting service or time", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "2",
      attributes: {
        lastAskedSlot: "requestedDate",
        activeDtmfMenu: "staff",
        staffDtmfOptions: JSON.stringify({
          "1": "Trang",
          "2": "Amy",
          "3": "Kelly",
          "4": "Any staff"
        }),
        staffDtmfStaffIds: JSON.stringify({
          "1": ids.trang,
          "2": ids.amy,
          "3": ids.kelly
        }),
        serviceName: "Pedicure",
        requestedDate: "2026-05-28",
        requestedTime: "2 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "2 PM");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.amy);
});

test("unclear customer name digit noise asks caller to spell", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "two three",
      customerPhone: "+18483480000",
      serviceName: "Full Set",
      requestedDate: "2026-05-28",
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      transcript: "two three",
      currentTurnTranscript: "two three",
      attributes: {
        lastAskedSlot: "customerName",
        askedSlotsCount: "1",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate: "2026-05-28",
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerPhone: "+18483480000"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "customerName");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, undefined);
  assert.match(result.body.data.lexResponse.message, /Could you say your first name slowly/i);
  assert.equal(state.appointments.length, 0);
});

test("international caller provides Jane while customerName is the active slot", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "Jane",
      customerPhone: "+84978634886",
      callerPhone: "+84978634886",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Any staff",
      confirmationState: undefined,
      amazonConnectContactId: "7a82c651-5091-4f32-84f0-bf37d004317c",
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "Jane",
      transcript: "Jane",
      attributes: {
        AmazonConnectContactId: "7a82c651-5091-4f32-84f0-bf37d004317c",
        CustomerEndpointAddress: "+84978634886",
        lastAskedSlot: "customerName",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Any staff",
        customerPhone: "+84978634886"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.notEqual(result.body.data.lexResponse.dialogAction.type, "ElicitIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Jane");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerPhone, "+84978634886");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "3 PM");
  assert.notEqual(result.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
  assert.doesNotMatch(result.body.data.lexResponse.message, /trouble checking/i);
});

test("international Amazon Connect customer persistence keeps +84 phone and does not name-match unrelated Jane", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  state.customers.push({
    id: "customer-existing-jane",
    salonId: ids.salonA,
    firstName: "Jane",
    lastName: "Existing",
    phone: "+17325550123",
    createdAt: new Date("2026-01-03T00:00:00.000Z")
  });
  state.customers.push({
    id: "customer-archived-jane",
    salonId: ids.salonA,
    firstName: "Archived",
    lastName: "Unknown",
    phone: "+84978634886",
    deletedAt: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-04T00:00:00.000Z")
  });

  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "Jane",
      customerPhone: "+84978634886",
      callerPhone: "+84978634886",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: "Confirmed",
      amazonConnectContactId: "connect-international-persist",
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "yes",
      transcript: "yes",
      attributes: {
        AmazonConnectContactId: "connect-international-persist",
        CustomerEndpointAddress: "+84978634886",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerName: "Jane",
        customerPhone: "+84978634886"
      }
    })
  );

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  const createdCustomer = state.customers.find((customer) => customer.phone === "+84978634886" && !customer.deletedAt);
  assert.ok(createdCustomer);
  assert.equal(createdCustomer.firstName, "Jane");
  assert.equal(createdCustomer.lastName, "");
  assert.notEqual(createdCustomer.id, "customer-existing-jane");
  assert.notEqual(createdCustomer.id, "customer-archived-jane");
  assert.equal(state.appointments[0].customerId, createdCustomer.id);
});

test("customer names colliding with staff names are accepted while asking customerName", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  for (const name of ["Amy", "Kelly", "Trang", "Jane"]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        customerName: name,
        customerPhone: `+18483480${String(name.length).padStart(3, "0")}`,
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        confirmationState: undefined,
        currentTurnTranscript: name,
        transcript: name,
        attributes: {
          lastAskedSlot: "customerName",
          serviceName: "Full Set",
          requestedDate,
          requestedTime: "3 PM",
          staffPreference: "Trang",
          customerPhone: `+18483480${String(name.length).padStart(3, "0")}`
        }
      })
    );

    assert.equal(result.response.status, 200, name);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", name);
    assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, name);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  }
});

test("spoken spelling is collapsed for customerName answers", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  for (const [spoken, expected] of [
    ["J A N E", "Jane"],
    ["K I E T", "Kiet"]
  ] as const) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        customerName: undefined,
        customerPhone: "+18483481234",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        confirmationState: undefined,
        currentTurnTranscript: spoken,
        transcript: spoken,
        attributes: {
          lastAskedSlot: "customerName",
          serviceName: "Full Set",
          requestedDate,
          requestedTime: "3 PM",
          staffPreference: "Trang",
          customerPhone: "+18483481234"
        }
      })
    );

    assert.equal(result.response.status, 200, spoken);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", spoken);
    assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, expected);
  }
});

test("repeated unclear customerName uses temporary phone fallback and continues", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: "two three",
      customerPhone: "+84978634886",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      currentTurnTranscript: "two three",
      transcript: "two three",
      attributes: {
        lastAskedSlot: "customerName",
        askedSlotsCount: "2",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerPhone: "+84978634886"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Guest 4886");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerNameSource, "phone_fallback");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerNameNeedsReview, "true");
  assert.match(result.body.data.lexResponse.message, /Guest ending in 4886/i);
  assert.notEqual(result.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
});

test("repeat service while asking customer name keeps context in AI log response", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+18483480000",
      serviceName: "Full Set",
      requestedDate: "2026-05-28",
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      transcript: "full set",
      currentTurnTranscript: "full set",
      attributes: {
        lastAskedSlot: "customerName",
        askedSlotsCount: "1",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate: "2026-05-28",
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerPhone: "+18483480000"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "customerName");
  assert.match(result.body.data.lexResponse.message, /I already have Full Set for/i);
  assert.match(result.body.data.lexResponse.message, /May I have your name/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /could you spell the name/i);
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnHistory[0].lastAskedSlotAfter, "customerName");
  assert.match(
    state.aiInteractionLogs[0].responsePayload.turnHistory[0].responseText,
    /I already have Full Set/i
  );
});

test("stale production full-set service row stays Full Set in phone flow", async () => {
  const fullSetService = state.services.find((service) => service.name === "Full Set");
  assert.ok(fullSetService);
  const staleFullSetName = ["Acr", "ylic ", "Full Set"].join("");
  fullSetService.name = staleFullSetName;

  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: staleFullSetName,
      staffPreference: "Trang",
      confirmationState: undefined,
      transcript: "my name is Thuyet",
      attributes: {
        lastAskedSlot: "customerName",
        serviceName: staleFullSetName,
        requestedDate: "2026-05-28",
        requestedTime: "3 PM",
        customerPhone: "+18483487681"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.match(result.body.data.lexResponse.message, /just to confirm: Full Set .* with Trang/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, new RegExp(staleFullSetName, "i"));
  assert.equal(state.bookingAttempts.at(-1)?.requestedService, "Full Set");
  assert.equal((state.bookingAttempts.at(-1)?.normalizedRequest as any)?.serviceName, "Full Set");
});

test("after service DTMF 4, name and date turns keep Full Set", async () => {
  const first = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+18483487681",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "4",
      attributes: {
        lastAskedSlot: "serviceName",
        activeDtmfMenu: "service",
        activeDtmfOptionsJson: JSON.stringify({ "4": "Full Set", "0": "__operator__" }),
        customerPhone: "+18483487681"
      }
    })
  );

  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(first.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.notEqual(first.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
  assert.notEqual(first.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "true");

  const nameTurn = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+18483487681",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "my name is Thuyet",
      attributes: {
        ...first.body.data.lexResponse.sessionAttributes,
        lastAskedSlot: "customerName"
      }
    })
  );

  assert.equal(nameTurn.response.status, 200);
  assert.equal(nameTurn.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(nameTurn.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(nameTurn.body.data.lexResponse.sessionAttributes.customerName, "Thuyet");
  assert.notEqual(nameTurn.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
  assert.notEqual(nameTurn.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "true");
  assert.notEqual(nameTurn.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");

  const dateTurn = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+18483487681",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "tomorrow at 3 PM",
      attributes: {
        ...first.body.data.lexResponse.sessionAttributes,
        lastAskedSlot: "requestedDate"
      }
    })
  );

  assert.equal(dateTurn.response.status, 200);
  assert.equal(dateTurn.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(dateTurn.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(dateTurn.body.data.lexResponse.sessionAttributes.requestedTime, "15:00");
  assert.notEqual(dateTurn.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
  assert.notEqual(dateTurn.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "true");
  assert.notEqual(dateTurn.body.data.lexResponse.dialogAction.slotToElicit, "serviceName");
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
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(result.body.data.lexResponse.sessionAttributes.selectedStaffId, ids.trang);
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
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.kelly);
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Kelly");
  assert.match(result.body.data.lexResponse.message, /Pedicure .* with Kelly/i);
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
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Trang");
  assert.match(result.body.data.lexResponse.message, /I found Trang available/i);
  assert.equal(state.appointments.length, 0);
});

test("staff DTMF uses session staffId mapping instead of name-only matching", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "2",
      attributes: {
        lastAskedSlot: "staffPreference",
        staffDtmfOptions: JSON.stringify({
          "1": "Trang",
          "2": "Amy",
          "3": "Kelly",
          "4": "Any staff"
        }),
        staffDtmfStaffIds: JSON.stringify({
          "1": ids.trang,
          "2": ids.amy,
          "3": ids.kelly
        }),
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
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.amy);
  assert.deepEqual(new Set(state.validationStaffIds), new Set([ids.amy]));
  assert.equal(state.appointments.length, 0);
});

test("missing staff asks once, then first available resolves before confirmation", async () => {
  const first = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined
    })
  );

  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.outcome, "MISSING_INFO");
  assert.equal(first.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(first.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.match(first.body.data.lexResponse.message, /Got it, Pedicure\. Which staff would you like, Trang, Amy, Kelly, or first available/i);
  assert.equal(first.body.data.lexResponse.sessionAttributes.activeDtmfMenu, "staff");
  assert.match(first.body.data.lexResponse.sessionAttributes.activeDtmfOptionsJson, /"4":"Any staff"/);
  assert.equal(state.appointments.length, 0);

  const second = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "first available",
      attributes: first.body.data.lexResponse.sessionAttributes
    })
  );

  assert.equal(second.response.status, 200);
  assert.equal(second.body.data.outcome, "MISSING_INFO");
  assert.equal(second.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(second.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(second.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.match(second.body.data.lexResponse.message, /I found Trang available/i);
  assert.match(second.body.data.lexResponse.message, /just to confirm: Pedicure .* with Trang/i);
  assert.equal(state.appointments.length, 0);
});

test("Any staff exact phrase and live ASR variants never persist raw unmatched staff", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const exact = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      requestedDate,
      requestedTime: "14:00",
      confirmationState: undefined,
      currentTurnTranscript: "I want to book a Pedicure tomorrow at 2 PM. Any staff is fine.",
      transcript: "I want to book a Pedicure tomorrow at 2 PM. Any staff is fine."
    })
  );

  assert.equal(exact.response.status, 200);
  assert.equal(exact.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.doesNotMatch(exact.body.data.lexResponse.message, /didn.t find that technician/i);
  assert.notEqual(state.bookingAttempts.at(-1)?.requestedStaff, "anystop");

  for (const phrase of [
    "any stop",
    "anystop",
    "any stop if i",
    "any stuff",
    "any star",
    "first available",
    "first avaiable",
    "what available",
    "who available",
    "one available",
    "which available",
    "available"
  ]) {
    resetMockState();
    process.env.AMAZON_CONNECT_STAFFED_AGENTS_OVERRIDE = "1";
    process.env.AMAZON_CONNECT_AVAILABLE_AGENTS_OVERRIDE = "1";
    const result = await postInternalAppointment(
      bookingPayload({
        staffPreference: undefined,
        requestedDate,
        requestedTime: "14:00",
        confirmationState: undefined,
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          lastAskedSlot: "staffPreference",
          activeDtmfMenu: "staff",
          staffRecognitionFailureCount: "2",
          invalidStaffPreferenceIgnored: "true",
          serviceName: "Pedicure",
          requestedDate,
          requestedTime: "14:00",
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );

    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.doesNotMatch(result.body.data.lexResponse.message, /didn.t find that technician/i, phrase);
    assert.notEqual(result.body.data.lexResponse.sessionAttributes.staffPreference, phrase, phrase);
    assert.notEqual(state.bookingAttempts.at(-1)?.requestedStaff, "anystop", phrase);
    assert.notEqual(state.bookingAttempts.at(-1)?.normalizedRequest.staffPreference, "anystop", phrase);
  }
});

test("Any time is fine does not infer Any staff and invalid raw staff is diagnostic only", async () => {
  const negative = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      requestedTime: undefined,
      confirmationState: undefined,
      currentTurnTranscript: "I want a Pedicure tomorrow afternoon. Any time is fine.",
      transcript: "I want a Pedicure tomorrow afternoon. Any time is fine."
    })
  );

  assert.equal(negative.response.status, 200);
  assert.notEqual(negative.body.data.lexResponse.sessionAttributes.staffPreference, "Any staff");

  const invalid = await postInternalAppointment(
    bookingPayload({
      staffPreference: "anystop",
      confirmationState: undefined,
      currentTurnTranscript: "anystop",
      transcript: "anystop"
    })
  );

  assert.equal(invalid.response.status, 200);
  assert.equal(invalid.body.data.lexResponse.sessionAttributes.staffPreference, undefined);
  assert.equal(state.bookingAttempts.at(-1)?.requestedStaff, undefined);
  assert.equal(state.bookingAttempts.at(-1)?.normalizedRequest.unrecognizedStaffUtterance, "anystop");
});

test("invalid staff DTMF repeats staff options without booking", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined,
      transcript: "9",
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
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.match(result.body.data.lexResponse.message, /I didn't find that option/i);
  assert.match(result.body.data.lexResponse.message, /Which staff would you like, Trang, Amy, Kelly, or first available/i);
  assert.equal(state.appointments.length, 0);
});

test("staff DTMF mapping stays stable across failed speech retries", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const first = await postInternalAppointment(
    bookingPayload({
      serviceName: "Pedicure",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-staff-menu-stability",
      currentTurnTranscript: "check",
      transcript: "check",
      attributes: {
        lastAskedSlot: "staffPreference",
        askedSlotsCount: "1",
        activeDtmfMenu: "staff",
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "2 PM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(first.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.equal(first.body.data.lexResponse.sessionAttributes.staffMenuWasSpoken, undefined);
  assert.match(first.body.data.lexResponse.message, /Which staff would you like, Trang, Amy, Kelly, or first available/i);
  const firstOptions = first.body.data.lexResponse.sessionAttributes.activeDtmfOptionsJson;
  const parsedOptions = JSON.parse(firstOptions);
  const trangDigit = Object.entries(parsedOptions).find(([, value]) => value === "Trang")?.[0];
  assert.ok(trangDigit);

  const second = await postInternalAppointment(
    bookingPayload({
      serviceName: "Pedicure",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-staff-menu-stability",
      currentTurnTranscript: "ten",
      transcript: "ten",
      attributes: first.body.data.lexResponse.sessionAttributes
    })
  );

  assert.equal(second.body.data.lexResponse.sessionAttributes.activeDtmfOptionsJson, firstOptions);
  assert.equal(second.body.data.lexResponse.sessionAttributes.staffMenuWasSpoken, "true");
  assert.match(second.body.data.lexResponse.message, /press 1 for Trang/i);
  assert.match(second.body.data.lexResponse.message, /press 4 for first available/i);

  const third = await postInternalAppointment(
    bookingPayload({
      serviceName: "Pedicure",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-staff-menu-stability",
      currentTurnTranscript: "check",
      transcript: "check",
      attributes: second.body.data.lexResponse.sessionAttributes
    })
  );

  assert.equal(third.body.data.lexResponse.sessionAttributes.activeDtmfOptionsJson, firstOptions);
  assert.doesNotMatch(third.body.data.lexResponse.message, /press 1.*press 2.*press 3/i);
  assert.match(third.body.data.lexResponse.message, /Please say a listed staff name or press one of the numbers/i);

  const selected = await postInternalAppointment(
    bookingPayload({
      serviceName: "Pedicure",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-staff-menu-stability",
      currentTurnTranscript: trangDigit,
      transcript: trangDigit,
      attributes: third.body.data.lexResponse.sessionAttributes
    })
  );

  assert.equal(selected.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(selected.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(selected.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(state.appointments.length, 0);
});

test("no active staff does not crash the AI booking flow", async () => {
  state.staff = state.staff.filter((member) => member.salonId !== ids.salonA);

  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: undefined,
      confirmationState: undefined,
      attributes: {
        lastAskedSlot: "staffPreference"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "NO_AVAILABILITY");
  assert.equal(result.body.data.alternatives.length, 0);
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

test("explicitly unmapped staff elicits staffPreference without backend retry", async () => {
  state.staffServiceMappings = [
    {
      salonId: ids.salonA,
      serviceId: ids.pedicure,
      staffId: ids.kelly
    }
  ];

  const result = await postInternalAppointment(bookingPayload({ staffPreference: "Trang" }));

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.equal(result.body.data.lexResponse.sessionAttributes.lastAskedSlot, "staffPreference");
  assert.equal(result.body.data.lexResponse.sessionAttributes.activeDtmfMenu, "staff");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.match(result.body.data.lexResponse.sessionAttributes.customerName, /Kiet/);
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerPhone, "+17325956266");
  assert.equal(result.body.data.lexResponse.sessionAttributes.awaitingBackendRetryConfirmation, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.recoverableErrorReason, undefined);
  assert.match(result.body.data.lexResponse.message, /Trang doesn't provide Pedicure/i);
  assert.equal(state.appointments.length, 0);
  assert.equal(state.validationStaffIds.includes(ids.trang), false);
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
  assert.equal(state.bookingAttempts.at(-1)?.normalizedRequest.availabilityReasonCode, "APPOINTMENT_OVERLAP");
  assert.match(result.body.data.lexResponse.message, /Trang already has an appointment at 5 PM/i);
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
      confirmationState: "None",
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
  assert.match(second.body.data.lexResponse.message, /just to confirm: Pedicure .* with Trang/i);
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

test("natural final confirmations create or return one appointment for the contact", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  for (const phrase of [
    "yes this is correct",
    "yeah correct",
    "correct yes yes correct yes",
    "that's right",
    "please book it",
    "correct"
  ]) {
    resetMockState();
    const contactId = `fef46abd-f101-475a-97d0-${phrase.replace(/\W+/g, "").slice(0, 12)}`;
    const confirmation = await postInternalAppointment(bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "Hi, I want to book Full Set tomorrow at 3 PM with Trang.",
      transcript: "Hi, I want to book Full Set tomorrow at 3 PM with Trang.",
      attributes: {
        AmazonConnectContactId: contactId,
        CustomerEndpointAddress: "+17325956266",
        customerPhone: "+17325956266"
      }
    }));
    assert.equal(confirmation.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.ok(confirmation.body.data.lexResponse.sessionAttributes.confirmationFingerprint, phrase);
    const payload = bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: "None",
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: phrase,
      transcript: phrase,
      attributes: {
        ...confirmation.body.data.lexResponse.sessionAttributes,
        AmazonConnectContactId: contactId,
        CustomerEndpointAddress: "+17325956266",
        currentTurnTranscript: phrase
      }
    });

    const first = await postInternalAppointment(payload);
    const second = await postInternalAppointment(payload);

    assert.equal(first.response.status, 201, phrase);
    assert.equal(second.response.status, 201, phrase);
    assert.equal(first.body.data.outcome, "BOOKED", phrase);
    assert.equal(second.body.data.outcome, "BOOKED", phrase);
    assert.equal(first.body.data.appointment.id, second.body.data.appointment.id, phrase);
    assert.equal(state.appointments.length, 1, phrase);
    assert.equal(state.aiInteractionLogs.length, 1, phrase);
    assert.ok(first.body.data.appointment.id, phrase);
    assert.equal(first.body.data.lexResponse.fulfillmentState, "Fulfilled", phrase);
    assert.equal(first.body.data.lexResponse.sessionAttributes.awaitingFinalBookingConfirmation, "false", phrase);
    assert.doesNotMatch(first.body.data.lexResponse.message, /Is that correct/i, phrase);
  }
});

test("final confirmation-only phrases preserve trusted Alex and book exactly once", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  for (const phrase of [
    "yes",
    "go ahead",
    "please go ahead",
    "book it",
    "please book it",
    "confirm it",
    "sounds good",
    "that's right",
    "proceed"
  ]) {
    resetMockState();
    addAlexStaff();
    const contactId = `connect-final-alex-${phrase.replace(/\W+/g, "-")}`;
    const confirmation = await postInternalAppointment(
      bookingPayload({
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "2 PM",
        staffPreference: "Alex",
        staffId: ids.alex,
        confirmationState: undefined,
        amazonConnectContactId: contactId,
        amazonConnectPhoneNumber: "+18483487681",
        calledNumber: "+18483487681",
        currentTurnTranscript: "Full Set tomorrow at 2 PM with Alex",
        transcript: "Full Set tomorrow at 2 PM with Alex",
        attributes: {
          AmazonConnectContactId: contactId,
          CustomerEndpointAddress: "+17325956266",
          customerPhone: "+17325956266"
        }
      })
    );
    const attrs = confirmation.body.data.lexResponse.sessionAttributes;
    assert.equal(confirmation.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.equal(attrs.staffPreference, "Alex", phrase);
    assert.equal(attrs.staffId, ids.alex, phrase);
    assert.equal(attrs.selectedStaffId, ids.alex, phrase);
    assert.equal(attrs.confirmedStaffId, ids.alex, phrase);
    assert.equal(attrs.confirmedStaffName, "Alex", phrase);

    const payload = bookingPayload({
      serviceName: "Full Set",
      requestedDate: attrs.requestedDate,
      requestedTime: attrs.requestedTime,
      staffPreference: attrs.staffPreference,
      staffId: attrs.staffId,
      confirmationState: "None",
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: phrase,
      transcript: phrase,
      attributes: {
        ...attrs,
        AmazonConnectContactId: contactId,
        CustomerEndpointAddress: "+17325956266",
        currentTurnTranscript: phrase
      }
    });
    const first = await postInternalAppointment(payload);
    const second = await postInternalAppointment(payload);

    assert.equal(first.response.status, 201, phrase);
    assert.equal(second.response.status, 201, phrase);
    assert.equal(first.body.data.outcome, "BOOKED", phrase);
    assert.equal(second.body.data.outcome, "BOOKED", phrase);
    assert.equal(first.body.data.appointment.id, second.body.data.appointment.id, phrase);
    assert.equal(state.appointments.length, 1, phrase);
    assert.equal(state.appointments[0].staffId, ids.alex, phrase);
    assert.equal(state.bookingAttempts.filter((attempt) => attempt.status === BookingAttemptStatus.SUCCESS).length, 1, phrase);
    assert.equal(state.aiInteractionLogs.length, 1, phrase);
    assert.ok(state.validationStaffIds.length >= 1, phrase);
    assert.ok(state.validationStaffIds.every((staffId) => staffId === ids.alex), phrase);
    assert.equal(first.body.data.lexResponse.sessionAttributes.staffPreference, "Alex", phrase);
    assert.equal(first.body.data.lexResponse.sessionAttributes.staffId, ids.alex, phrase);
    assert.equal(first.body.data.lexResponse.sessionAttributes.selectedStaffId, ids.alex, phrase);
    assert.equal(first.body.data.lexResponse.sessionAttributes.confirmedStaffId, ids.alex, phrase);
    assert.equal(first.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Alex", phrase);
    assert.doesNotMatch(first.body.data.lexResponse.message, /technician|didn't find/i, phrase);
    assert.notEqual(first.body.data.lexResponse.sessionAttributes.staffPreference, phrase, phrase);
  }
});

test("denied final confirmations do not create appointments and preserve booking slots", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  for (const phrase of [
    "no",
    "nope",
    "no that is wrong",
    "that's not correct",
    "do not book it",
    "don't book it",
    "cancel it",
    "wait no"
  ]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        confirmationState: "None",
        amazonConnectContactId: `connect-denied-${phrase.replace(/\W+/g, "-")}`,
        amazonConnectPhoneNumber: "+18483487681",
        calledNumber: "+18483487681",
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          lastAskedSlot: "bookingConfirmation",
          awaitingFinalBookingConfirmation: "true",
          bookingConfirmationAsked: "true",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate,
          requestedTime: "3 PM",
          staffPreference: "Trang",
          confirmedStaffName: "Trang",
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );

    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(state.appointments.length, 0, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "3 PM", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang", phrase);
    assert.match(result.body.data.lexResponse.message, /Which detail would you like to change/i, phrase);
  }
});

test("final confirmation change request updates only the requested time before reconfirming", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: "None",
      amazonConnectContactId: "connect-change-final-time",
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "no, make it 10 AM",
      transcript: "no, make it 10 AM",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        confirmedStaffName: "Trang",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(state.appointments.length, 0);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "10:00");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
});

test("active booking change date preserves time and staff before fresh confirmation", async () => {
  const previousDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate: previousDate,
      requestedTime: "1 PM",
      staffPreference: "Trang",
      confirmationState: "None",
      amazonConnectContactId: "connect-change-final-date",
      currentTurnTranscript: "change it to Monday",
      transcript: "change it to Monday",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        requestedDate: previousDate,
        requestedTime: "1 PM",
        staffPreference: "Trang",
        staffId: ids.trang,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  const updatedDate = result.body.data.lexResponse.sessionAttributes.requestedDate;
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(DateTime.fromISO(updatedDate).weekday, 1);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "1 PM");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(state.appointments.length, 0);
});

test("active booking change date and time updates both values once", async () => {
  const previousDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate: previousDate,
      requestedTime: "1 PM",
      staffPreference: "Trang",
      confirmationState: "None",
      amazonConnectContactId: "connect-change-final-date-time",
      currentTurnTranscript: "Monday at two PM",
      transcript: "Monday at two PM",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        requestedDate: previousDate,
        requestedTime: "1 PM",
        staffPreference: "Trang",
        staffId: ids.trang,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(DateTime.fromISO(result.body.data.lexResponse.sessionAttributes.requestedDate).weekday, 1);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "14:00");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(state.appointments.length, 0);
});

test("final confirmation slot changes beat affirmation tokens and update fields atomically", async () => {
  const contactId = "connect-final-change-atomic";
  const confirmation = await postInternalAppointment(
    bookingPayload({
      requestedDate: "2026-05-28",
      requestedTime: "2 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      currentTurnTranscript: "Pedicure tomorrow at 2 PM with Trang",
      transcript: "Pedicure tomorrow at 2 PM with Trang"
    })
  );
  const attrs = confirmation.body.data.lexResponse.sessionAttributes;
  assert.equal(confirmation.body.data.lexResponse.dialogAction.type, "ConfirmIntent");

  const change = await postInternalAppointment(
    bookingPayload({
      requestedDate: attrs.requestedDate,
      requestedTime: attrs.requestedTime,
      staffPreference: attrs.staffPreference,
      confirmationState: "None",
      amazonConnectContactId: contactId,
      currentTurnTranscript: "yes, but make it 4 PM and Amy",
      transcript: "yes, but make it 4 PM and Amy",
      attributes: {
        ...attrs,
        currentTurnTranscript: "yes, but make it 4 PM and Amy"
      }
    })
  );

  assert.equal(change.body.data.outcome, "MISSING_INFO");
  assert.equal(change.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(change.body.data.lexResponse.sessionAttributes.requestedDate, attrs.requestedDate);
  assert.equal(change.body.data.lexResponse.sessionAttributes.requestedTime, "16:00");
  assert.equal(change.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
  assert.equal(state.appointments.length, 0);
  assert.match(change.body.data.lexResponse.message, /4 PM.*Amy/i);
});

test("time-only final correction preserves the existing date", async () => {
  const requestedDate = "2026-05-29";
  const result = await postInternalAppointment(
    bookingPayload({
      requestedDate,
      requestedTime: "9 AM",
      staffPreference: "Amy",
      confirmationState: "None",
      amazonConnectContactId: "connect-time-only-date-preserve",
      currentTurnTranscript: "No, I want 10 AM only.",
      transcript: "No, I want 10 AM only.",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "9 AM",
        staffPreference: "Amy",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "10:00");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
});

test("business hours are explained before staff availability", async () => {
  state.businessHours = state.businessHours.map((hour) => ({
    ...hour,
    isOpen: true,
    openTime: "09:00",
    closeTime: "18:00"
  }));
  const result = await postInternalAppointment(
    bookingPayload({
      requestedDate: "2026-05-28",
      requestedTime: "1 AM",
      staffPreference: "Kelly",
      confirmationState: undefined,
      amazonConnectContactId: "connect-outside-hours"
    })
  );

  assert.equal(result.body.data.outcome, "NO_AVAILABILITY");
  assert.match(result.body.data.lexResponse.message, /open Thursday from 9 AM to 6 PM/i);
  assert.match(result.body.data.lexResponse.message, /cannot book 1 AM/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /Kelly is not available/i);
  assert.equal(result.body.data.lexResponse.sessionAttributes.awaitingAlternativeSelection, "false");
  assert.equal(state.appointments.length, 0);
});

test("specific Alex conflict reports overlap and does not create another appointment", async () => {
  addAlexStaff();
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const start = DateTime.fromISO(`${requestedDate}T14:00:00`, { zone: "America/New_York" }).toUTC();
  state.appointments.push({
    id: "existing-alex-overlap",
    salonId: ids.salonA,
    customerId: ids.kietCustomer,
    staffId: ids.alex,
    serviceId: ids.fullSet,
    startTime: start.toJSDate(),
    endTime: start.plus({ minutes: 100 }).toJSDate(),
    status: AppointmentStatus.CONFIRMED,
    source: AppointmentSource.DASHBOARD
  });

  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: "Alex",
      staffId: ids.alex,
      confirmationState: undefined,
      amazonConnectContactId: "connect-alex-overlap"
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "NO_AVAILABILITY");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.validationStaffIds[0], ids.alex);
  assert.match(state.bookingAttempts[0].failureReason, /overlaps with an existing booking/i);
  assert.equal(state.bookingAttempts[0].status, BookingAttemptStatus.NO_AVAILABILITY);
  assert.equal(state.bookingAttempts[0].appointmentId, undefined);
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "requestedTime");
});

test("staff prompt scoped dang resolves to Trang and generic words do not", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const dang = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "1 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-dang-trang",
      currentTurnTranscript: "dang",
      transcript: "dang",
      attributes: {
        lastAskedSlot: "staffPreference",
        activeDtmfMenu: "staff",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "1 PM",
        customerName: "Lee",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(dang.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(dang.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(dang.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.doesNotMatch(dang.body.data.lexResponse.message, /didn't find that technician/i);
  assert.equal(state.appointments.length, 0);

  for (const phrase of ["change it to two PM", "check", "ten"]) {
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "1 PM",
        staffPreference: undefined,
        confirmationState: undefined,
        amazonConnectContactId: `connect-staff-no-trang-${phrase.replace(/\s+/g, "-")}`,
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          lastAskedSlot: "staffPreference",
          activeDtmfMenu: "staff",
          serviceName: "Full Set",
          requestedDate,
          requestedTime: "1 PM",
          customerName: "Lee",
          customerPhone: "+17325956266"
        }
      })
    );

    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, undefined, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, undefined, phrase);
    assert.doesNotMatch(result.body.data.lexResponse.message, /with Trang/i, phrase);
  }
});

test("Trang overlap from dang returns overlap reason and canceled overlap does not block", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const start = DateTime.fromISO(`${requestedDate}T13:00:00`, { zone: "America/New_York" }).toUTC();
  state.appointments.push({
    id: "existing-trang-overlap",
    salonId: ids.salonA,
    customerId: ids.kietCustomer,
    staffId: ids.trang,
    serviceId: ids.fullSet,
    startTime: start.toJSDate(),
    endTime: start.plus({ minutes: 100 }).toJSDate(),
    status: AppointmentStatus.CONFIRMED,
    source: AppointmentSource.DASHBOARD
  });

  const overlap = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "1 PM",
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-trang-dang-overlap",
      currentTurnTranscript: "dang",
      transcript: "dang",
      attributes: {
        lastAskedSlot: "staffPreference",
        activeDtmfMenu: "staff",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "1 PM",
        customerName: "Lee",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(overlap.body.data.outcome, "NO_AVAILABILITY");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.validationStaffIds[0], ids.trang);
  assert.equal(state.bookingAttempts.at(-1)?.normalizedRequest.availabilityReasonCode, "APPOINTMENT_OVERLAP");
  assert.match(overlap.body.data.lexResponse.message, /Trang already has an appointment/i);
  assert.doesNotMatch(overlap.body.data.lexResponse.message, /didn't find that technician|staff not found/i);

  resetMockState();
  const canceledStart = DateTime.fromISO(`${requestedDate}T13:00:00`, { zone: "America/New_York" }).toUTC();
  state.appointments.push({
    id: "canceled-trang-overlap",
    salonId: ids.salonA,
    customerId: ids.kietCustomer,
    staffId: ids.trang,
    serviceId: ids.fullSet,
    startTime: canceledStart.toJSDate(),
    endTime: canceledStart.plus({ minutes: 100 }).toJSDate(),
    status: AppointmentStatus.CANCELED,
    source: AppointmentSource.DASHBOARD
  });
  const booked = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "1 PM",
      staffPreference: "dang",
      confirmationState: "Confirmed",
      amazonConnectContactId: "connect-trang-dang-canceled-overlap",
      currentTurnTranscript: "dang",
      transcript: "dang",
      attributes: {
        lastAskedSlot: "staffPreference",
        activeDtmfMenu: "staff",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "1 PM",
        customerName: "Lee",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(booked.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 2);
  assert.equal(state.appointments.at(-1)?.staffId, ids.trang);
});

test("canceled Alex overlap does not block booking", async () => {
  addAlexStaff();
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const start = DateTime.fromISO(`${requestedDate}T14:00:00`, { zone: "America/New_York" }).toUTC();
  state.appointments.push({
    id: "canceled-alex-overlap",
    salonId: ids.salonA,
    customerId: ids.kietCustomer,
    staffId: ids.alex,
    serviceId: ids.fullSet,
    startTime: start.toJSDate(),
    endTime: start.plus({ minutes: 100 }).toJSDate(),
    status: AppointmentStatus.CANCELED,
    source: AppointmentSource.DASHBOARD
  });
  const contactId = "connect-alex-canceled-overlap";
  const confirmation = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: "Alex",
      staffId: ids.alex,
      confirmationState: undefined,
      amazonConnectContactId: contactId
    })
  );
  assert.equal(confirmation.body.data.lexResponse.dialogAction.type, "ConfirmIntent");

  const booked = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: "Alex",
      staffId: ids.alex,
      confirmationState: "None",
      amazonConnectContactId: contactId,
      currentTurnTranscript: "go ahead",
      transcript: "go ahead",
      attributes: confirmation.body.data.lexResponse.sessionAttributes
    })
  );

  assert.equal(booked.response.status, 201);
  assert.equal(booked.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 2);
  assert.equal(state.appointments[1].staffId, ids.alex);
  assert.equal(state.appointments[1].status, AppointmentStatus.SCHEDULED);
  assert.ok(state.validationStaffIds.every((staffId) => staffId === ids.alex));
});

test("Alex not mapped to Full Set asks for another staff instead of saying busy", async () => {
  addAlexStaff({ mapFullSet: false });
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: "Alex",
      staffId: ids.alex,
      confirmationState: undefined,
      amazonConnectContactId: "connect-alex-not-mapped"
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.match(state.bookingAttempts[0].failureReason, /STAFF_NOT_MAPPED/i);
  assert.match(result.body.data.lexResponse.message, /doesn't provide Full Set/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /busy|not available/i);
  assert.equal(state.appointments.length, 0);
  assert.equal(state.validationStaffIds.length, 0);
});

test("Alex outside business hours reports business hours instead of staff busy", async () => {
  addAlexStaff();
  state.businessHours = state.businessHours.map((hour) => ({
    ...hour,
    isOpen: true,
    openTime: "09:00",
    closeTime: "12:00"
  }));
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: "Alex",
      staffId: ids.alex,
      confirmationState: undefined,
      amazonConnectContactId: "connect-alex-outside-hours"
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "NO_AVAILABILITY");
  assert.match(state.bookingAttempts[0].failureReason, /outside business hours/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /Alex is not available/i);
  assert.equal(state.appointments.length, 0);
  assert.equal(state.validationStaffIds.length, 0);
});

test("alternative rejection clears the old offer instead of repeating it", async () => {
  state.busyStaffIds.add(ids.trang);
  const first = await postInternalAppointment(
    bookingPayload({
      staffPreference: "Trang",
      amazonConnectContactId: "connect-alt-reject",
      confirmationState: undefined
    })
  );
  assert.equal(first.body.data.outcome, "NO_AVAILABILITY");
  assert.equal(first.body.data.lexResponse.sessionAttributes.awaitingAlternativeSelection, "true");

  const second = await postInternalAppointment(
    bookingPayload({
      requestedDate: first.body.data.lexResponse.sessionAttributes.requestedDate,
      requestedTime: first.body.data.lexResponse.sessionAttributes.requestedTime,
      staffPreference: first.body.data.lexResponse.sessionAttributes.staffPreference,
      confirmationState: undefined,
      amazonConnectContactId: "connect-alt-reject",
      currentTurnTranscript: "no",
      transcript: "no",
      attributes: {
        ...first.body.data.lexResponse.sessionAttributes,
        currentTurnTranscript: "no"
      }
    })
  );

  assert.equal(second.body.data.outcome, "MISSING_INFO");
  assert.equal(second.body.data.lexResponse.dialogAction.slotToElicit, "requestedTime");
  assert.equal(second.body.data.lexResponse.sessionAttributes.awaitingAlternativeSelection, undefined);
  assert.doesNotMatch(second.body.data.lexResponse.message, /press 1/i);
});

test("Kevin trailing okay does not affirm stale Amy state", async () => {
  state.staff.push({
    id: ids.kevin,
    salonId: ids.salonA,
    fullName: "kenvin",
    status: StaffStatus.ACTIVE,
    isBookable: true,
    createdAt: new Date("2026-01-04T00:00:00.000Z")
  });
  state.staffServiceMappings?.push({
    salonId: ids.salonA,
    staffId: ids.kevin,
    serviceId: ids.pedicure
  });
  const contactId = "connect-kevin-safety";
  const confirmation = await postInternalAppointment(
    bookingPayload({
      requestedDate: "2026-05-28",
      requestedTime: "3 PM",
      staffPreference: "Amy",
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      currentTurnTranscript: "Pedicure tomorrow at 3 PM with Amy",
      transcript: "Pedicure tomorrow at 3 PM with Amy"
    })
  );
  const attrs = confirmation.body.data.lexResponse.sessionAttributes;
  const result = await postInternalAppointment(
    bookingPayload({
      requestedDate: attrs.requestedDate,
      requestedTime: attrs.requestedTime,
      staffPreference: attrs.staffPreference,
      confirmationState: "None",
      amazonConnectContactId: contactId,
      currentTurnTranscript: "I want Kevin to do a pedicure at 3 PM tomorrow okay.",
      transcript: "I want Kevin to do a pedicure at 3 PM tomorrow okay.",
      attributes: {
        ...attrs,
        currentTurnTranscript: "I want Kevin to do a pedicure at 3 PM tomorrow okay."
      }
    })
  );

  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "kenvin");
  assert.equal(state.appointments.length, 0);
  assert.doesNotMatch(result.body.data.lexResponse.message, /with Amy/i);
});

test("final confirmation uses trusted 11 AM instead of stale initial 10 PM transcript", async () => {
  state.businessHours = state.businessHours.map((hour) => ({
    ...hour,
    openTime: "09:00",
    closeTime: "18:00"
  }));
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  const confirmation = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "11:00",
      staffPreference: "Amy",
      confirmationState: undefined,
      amazonConnectContactId: "connect-stale-10pm-trusted-11am",
      currentTurnTranscript: "eleven a m",
      transcript: "eleven a m",
      attributes: {
        initialBookingUtterance: "I want to book a full set tomorrow at ten p m",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate,
        requestedTime: "11:00",
        staffPreference: "Amy",
        confirmedStaffName: "Amy",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );
  assert.equal(confirmation.body.data.lexResponse.dialogAction.type, "ConfirmIntent");

  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "11:00",
      staffPreference: "Amy",
      confirmationState: "Confirmed",
      amazonConnectContactId: "connect-stale-10pm-trusted-11am",
      currentTurnTranscript: "yeah that's correct",
      transcript: "I want to book a full set tomorrow at ten p m. no change it to eleven a m. yeah that's correct",
      attributes: {
        ...confirmation.body.data.lexResponse.sessionAttributes,
        initialBookingUtterance: "I want to book a full set tomorrow at ten p m"
      }
    })
  );
  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 1);
  const localStart = DateTime.fromJSDate(state.appointments[0].startTime, { zone: "utc" }).setZone(
    "America/New_York"
  );
  assert.equal(localStart.hour, 11);
  assert.notEqual(localStart.hour, 22);
});

test("empty current turn does not replay initial transcript or duplicate logs", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const payload = bookingPayload({
    serviceName: "Full Set",
    requestedDate,
    requestedTime: "3 PM",
    staffPreference: "Trang",
    confirmationState: "None",
    amazonConnectContactId: "connect-empty-current-turn",
    currentTurnTranscript: "",
    aggregatedBookingTranscript: "i want to book pool set",
    transcript: "i want to book pool set",
    attributes: {
      currentTurnTranscript: "",
      aggregatedBookingTranscript: "i want to book pool set",
      originatingRequestId: "lex-empty-request-1",
      lastAskedSlot: "bookingConfirmation",
      awaitingFinalBookingConfirmation: "true",
      bookingConfirmationAsked: "true",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      staffId: ids.trang,
      customerName: "Kiet Nguyen",
      customerPhone: "+17325956266",
      lexTurnDebug: {
        currentTurnTranscript: "",
        originatingRequestId: "lex-empty-request-1"
      }
    }
  });

  const first = await postInternalAppointment(payload);
  const second = await postInternalAppointment(payload);

  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(state.appointments.length, 0);
  assert.equal(state.transcripts.length, 0);
  assert.equal(state.bookingAttempts.length, 1);
  assert.equal(state.aiInteractionLogs.length, 1);
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnHistory.length, 1);
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnHistory[0].currentTurnTranscript, "");
  assert.notEqual(
    state.aiInteractionLogs[0].responsePayload.turnHistory[0].currentTurnTranscript,
    "i want to book pool set"
  );
  assert.equal(
    state.aiInteractionLogs[0].responsePayload.turnHistory[0].aggregatedBookingTranscript,
    "i want to book pool set"
  );
  assert.equal(state.bookingAttempts[0].transcriptId, undefined);
});

test("10 AM remains valid inside 9 to 6 business hours", async () => {
  state.businessHours = state.businessHours.map((hour) => ({
    ...hour,
    openTime: "09:00",
    closeTime: "18:00"
  }));
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Manicure",
      requestedDate,
      requestedTime: "10 AM",
      staffPreference: "Amy",
      confirmationState: "Confirmed",
      amazonConnectContactId: "connect-control-10am",
      currentTurnTranscript: "yes"
    })
  );

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.outcome, "BOOKED");
  const localStart = DateTime.fromJSDate(state.appointments[0].startTime, { zone: "utc" }).setZone(
    "America/New_York"
  );
  assert.equal(localStart.hour, 10);
});

test("bare okay at final confirmation reprompts and does not create appointment", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Amy",
      confirmationState: "Confirmed",
      amazonConnectContactId: "connect-final-bare-okay",
      currentTurnTranscript: "okay",
      transcript: "okay",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Amy",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(state.appointments.length, 0);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.match(result.body.data.lexResponse.message, /Please say yes to confirm/i);
  assert.equal(result.body.data.lexResponse.sessionAttributes.conversationComplete, "false");
});

test("staff change before final confirmation requires a fresh confirmation before booking", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const changeResult = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: "None",
      amazonConnectContactId: "connect-final-change-staff",
      currentTurnTranscript: "with Amy instead",
      transcript: "with Amy instead",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        staffId: ids.trang,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(changeResult.response.status, 200);
  assert.equal(changeResult.body.data.outcome, "MISSING_INFO");
  assert.equal(state.appointments.length, 0);
  assert.equal(changeResult.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(changeResult.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
  assert.equal(changeResult.body.data.lexResponse.sessionAttributes.staffId, ids.amy);
  assert.equal(changeResult.body.data.lexResponse.sessionAttributes.conversationComplete, "false");

  const confirmResult = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Amy",
      staffId: ids.amy,
      confirmationState: "Confirmed",
      amazonConnectContactId: "connect-final-change-staff",
      currentTurnTranscript: "yes, that's correct",
      transcript: "yes, that's correct",
      attributes: changeResult.body.data.lexResponse.sessionAttributes
    })
  );

  assert.equal(confirmResult.response.status, 201);
  assert.equal(confirmResult.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.appointments[0].staffId, ids.amy);
});

test("active booking staff change to Kevin wins over previous Trang without name pollution", async () => {
  addKevinStaff();
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  for (const phrase of ["with Kevin", "Kevin Kevin"]) {
    resetMockState();
    addKevinStaff();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        staffId: ids.trang,
        confirmationState: "None",
        amazonConnectContactId: `connect-final-change-kevin-${phrase.replace(/\s+/g, "-")}`,
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          lastAskedSlot: "bookingConfirmation",
          awaitingFinalBookingConfirmation: "true",
          bookingConfirmationAsked: "true",
          serviceName: "Full Set",
          requestedDate,
          requestedTime: "3 PM",
          staffPreference: "Trang",
          staffId: ids.trang,
          selectedStaffId: ids.trang,
          confirmedStaffId: ids.trang,
          confirmedStaffName: "Trang",
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );

    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Kevin", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.kevin, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.selectedStaffId, ids.kevin, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffId, ids.kevin, phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Kevin", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Kiet", phrase);
    assert.notEqual(state.bookingAttempts.at(-1)?.customerName, "with", phrase);
    assert.equal(state.appointments.length, 0, phrase);
  }
});

test("active booking multi-field change updates date time and staff in one turn", async () => {
  addKevinStaff();
  const previousDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate: previousDate,
      requestedTime: "1 PM",
      staffPreference: "Trang",
      staffId: ids.trang,
      confirmationState: "None",
      amazonConnectContactId: "connect-final-change-multifield",
      currentTurnTranscript: "change it to Monday at two PM with Kevin",
      transcript: "change it to Monday at two PM with Kevin",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        requestedDate: previousDate,
        requestedTime: "1 PM",
        staffPreference: "Trang",
        staffId: ids.trang,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(DateTime.fromISO(result.body.data.lexResponse.sessionAttributes.requestedDate).weekday, 1);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "14:00");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Kevin");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.kevin);
  assert.equal(state.appointments.length, 0);
});

test("time-only final correction preserves non-first Kevin staff identity", async () => {
  addKevinStaff();
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: "Kevin",
      staffId: ids.kevin,
      confirmationState: "None",
      amazonConnectContactId: "connect-final-time-only-kevin",
      currentTurnTranscript: "no uh change it into four p m",
      transcript: "no uh change it into four p m",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate,
        requestedTime: "2 PM",
        staffPreference: "Kevin",
        staffId: ids.kevin,
        selectedStaffId: ids.kevin,
        confirmedStaffId: ids.kevin,
        confirmedStaffName: "Kevin",
        customerName: "Lee",
        customerPhone: "+17325956266",
        confirmationFingerprint: "old-kevin-two-pm"
      }
    })
  );

  const attrs = result.body.data.lexResponse.sessionAttributes;
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(attrs.serviceName, "Full Set");
  assert.equal(attrs.requestedDate, requestedDate);
  assert.equal(attrs.requestedTime, "16:00");
  assert.equal(attrs.staffPreference, "Kevin");
  assert.equal(attrs.staffId, ids.kevin);
  assert.equal(attrs.selectedStaffId, ids.kevin);
  assert.equal(attrs.confirmedStaffId, ids.kevin);
  assert.equal(attrs.confirmedStaffName, "Kevin");
  assert.notEqual(attrs.confirmationFingerprint, "old-kevin-two-pm");
  assert.equal(state.appointments.length, 0);
});

test("production Alex time correction then go ahead keeps Alex through booking", async () => {
  addAlexStaff();
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const contactId = "connect-production-alex-time-go-ahead";
  const correction = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "11 AM",
      staffPreference: "Alex",
      staffId: ids.alex,
      confirmationState: "None",
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "no change it into two pm",
      transcript: "no change it into two pm",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate,
        requestedTime: "11 AM",
        staffPreference: "Alex",
        staffId: ids.alex,
        selectedStaffId: ids.alex,
        confirmedStaffId: ids.alex,
        confirmedStaffName: "Alex",
        customerName: "Lee",
        customerPhone: "+17325956266",
        confirmationFingerprint: "old-alex-eleven-am"
      }
    })
  );
  const attrs = correction.body.data.lexResponse.sessionAttributes;

  assert.equal(correction.response.status, 200);
  assert.equal(correction.body.data.outcome, "MISSING_INFO");
  assert.equal(correction.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(attrs.requestedTime, "14:00");
  assert.equal(attrs.staffPreference, "Alex");
  assert.equal(attrs.staffId, ids.alex);
  assert.equal(attrs.selectedStaffId, ids.alex);
  assert.equal(attrs.confirmedStaffId, ids.alex);
  assert.equal(attrs.confirmedStaffName, "Alex");
  assert.equal(state.appointments.length, 0);

  const booked = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate: attrs.requestedDate,
      requestedTime: attrs.requestedTime,
      staffPreference: attrs.staffPreference,
      staffId: attrs.staffId,
      confirmationState: "None",
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "go ahead",
      transcript: "go ahead",
      attributes: {
        ...attrs,
        currentTurnTranscript: "go ahead"
      }
    })
  );

  assert.equal(booked.response.status, 201);
  assert.equal(booked.body.data.outcome, "BOOKED");
  assert.equal(booked.body.data.lexResponse.sessionAttributes.staffPreference, "Alex");
  assert.equal(booked.body.data.lexResponse.sessionAttributes.staffId, ids.alex);
  assert.equal(booked.body.data.lexResponse.sessionAttributes.selectedStaffId, ids.alex);
  assert.equal(booked.body.data.lexResponse.sessionAttributes.confirmedStaffId, ids.alex);
  assert.equal(booked.body.data.lexResponse.sessionAttributes.confirmedStaffName, "Alex");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.appointments[0].staffId, ids.alex);
  assert.ok(state.validationStaffIds.every((staffId) => staffId === ids.alex));
  assert.doesNotMatch(booked.body.data.lexResponse.message, /technician|didn't find/i);
});

test("spoken minute final correction preserves Kevin and exact minutes", async () => {
  addKevinStaff();
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "2 PM",
      staffPreference: "Kevin",
      staffId: ids.kevin,
      confirmationState: "None",
      amazonConnectContactId: "connect-final-time-minutes-kevin",
      currentTurnTranscript: "change it to three fifty PM",
      transcript: "change it to three fifty PM",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        confirmedServiceName: "Full Set",
        requestedDate,
        requestedTime: "2 PM",
        staffPreference: "Kevin",
        staffId: ids.kevin,
        selectedStaffId: ids.kevin,
        confirmedStaffId: ids.kevin,
        confirmedStaffName: "Kevin",
        customerName: "Lee",
        customerPhone: "+17325956266"
      }
    })
  );

  const attrs = result.body.data.lexResponse.sessionAttributes;
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(attrs.requestedTime, "15:50");
  assert.equal(attrs.staffPreference, "Kevin");
  assert.equal(attrs.staffId, ids.kevin);
  assert.equal(attrs.selectedStaffId, ids.kevin);
  assert.equal(attrs.confirmedStaffId, ids.kevin);
  assert.equal(attrs.confirmedStaffName, "Kevin");
  assert.match(result.body.data.lexResponse.message, /3:50 PM/i);
  assert.equal(state.appointments.length, 0);
});

test("first available ASR variants enter explicit-any flow without staff clarification", async () => {
  for (const phrase of [
    "for available",
    "first avaiable",
    "any staff is fine",
    "any stuff is fine",
    "any stop is fine",
    "and the staff is fine",
    "first available",
    "what available",
    "who available",
    "one available",
    "which available",
    "available"
  ]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: "Manicure",
        requestedDate: DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd"),
        requestedTime: "5 PM",
        staffPreference: undefined,
        confirmationState: undefined,
        amazonConnectContactId: `connect-any-${phrase.replace(/\s+/g, "-")}`,
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          lastAskedSlot: "staffPreference",
          serviceName: "Manicure",
          requestedDate: DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd"),
          requestedTime: "5 PM",
          customerName: "Lee",
          customerPhone: "+17325956266"
        }
      })
    );

    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang", phrase);
    assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang, phrase);
    assert.doesNotMatch(result.body.data.lexResponse.message, /didn't find that technician/i, phrase);
    assert.equal(state.appointments.length, 0, phrase);
  }
});

test("ungrounded thirty five ASR does not become 5 PM or Any staff", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  for (const phrase of ["and it's thirty five", "thirty five", "and its thirty five"]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "5 PM",
        staffPreference: undefined,
        confirmationState: undefined,
        amazonConnectContactId: `connect-ungrounded-${phrase.replace(/\W+/g, "-")}`,
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          lastAskedSlot: "requestedTime",
          serviceName: "Pedicure",
          requestedDate,
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );

    const attrs = result.body.data.lexResponse.sessionAttributes;
    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "requestedTime", phrase);
    assert.notEqual(attrs.requestedTime, "5 PM", phrase);
    assert.notEqual(attrs.requestedTime, "17:00", phrase);
    assert.notEqual(attrs.staffPreference, "Any staff", phrase);
    assert.equal(state.appointments.length, 0, phrase);
  }
});

test("what available does not become Any staff outside staff context", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Manicure",
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      currentTurnTranscript: "what available",
      transcript: "what available",
      attributes: {
        lastAskedSlot: "requestedDate",
        serviceName: "Manicure",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  const attrs = result.body.data.lexResponse.sessionAttributes;
  assert.equal(result.response.status, 200);
  assert.notEqual(attrs.staffPreference, "Any staff");
  assert.notEqual(attrs.staffPreference, "Trang");
  assert.equal(attrs.staffId, undefined);
  assert.notEqual(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.equal(state.appointments.length, 0);
});

test("tomorrow afternoon without an exact hour asks for requestedTime", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Pedicure",
      requestedDate,
      requestedTime: undefined,
      staffPreference: "Any staff",
      confirmationState: undefined,
      amazonConnectContactId: "connect-afternoon-needs-time",
      currentTurnTranscript: "i want to book a pedicure tomorrow afternoon",
      transcript: "i want to book a pedicure tomorrow afternoon",
      attributes: {
        serviceName: "Pedicure",
        requestedDate,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "requestedTime");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, undefined);
  assert.equal(state.appointments.length, 0);
});

test("generic services clarification preserves date time and Amy when service is answered", async () => {
  const today = DateTime.now().setZone("America/New_York").toFormat("yyyy-MM-dd");

  for (const serviceName of ["Pedicure", "Manicure", "Full Set", "Dip Powder"]) {
    resetMockState();
    const contactId = `connect-generic-service-${serviceName.replace(/\s+/g, "-").toLowerCase()}`;
    const first = await postInternalAppointment(
      bookingPayload({
        serviceName: "services",
        requestedDate: today,
        requestedTime: "2 PM",
        staffPreference: "Amy",
        staffId: ids.amy,
        confirmationState: undefined,
        amazonConnectContactId: contactId,
        currentTurnTranscript: "at two p m with amy",
        transcript: "I want to book services today at 2 PM with Amy",
        attributes: {
          AmazonConnectContactId: contactId,
          currentTurnTranscript: "at two p m with amy",
          requestedDate: today,
          requestedTime: "2 PM",
          staffPreference: "Amy",
          staffId: ids.amy,
          selectedStaffId: ids.amy,
          confirmedStaffId: ids.amy,
          confirmedStaffName: "Amy",
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );

    assert.equal(first.body.data.outcome, "MISSING_INFO", serviceName);
    assert.equal(first.body.data.lexResponse.dialogAction.slotToElicit, "serviceName", serviceName);
    assert.equal(first.body.data.lexResponse.sessionAttributes.requestedDate, today, serviceName);
    assert.equal(first.body.data.lexResponse.sessionAttributes.requestedTime, "2 PM", serviceName);
    assert.equal(first.body.data.lexResponse.sessionAttributes.staffPreference, "Amy", serviceName);

    const second = await postInternalAppointment(
      bookingPayload({
        serviceName,
        requestedDate: first.body.data.lexResponse.sessionAttributes.requestedDate,
        requestedTime: first.body.data.lexResponse.sessionAttributes.requestedTime,
        staffPreference: first.body.data.lexResponse.sessionAttributes.staffPreference,
        staffId: first.body.data.lexResponse.sessionAttributes.staffId,
        confirmationState: undefined,
        amazonConnectContactId: contactId,
        currentTurnTranscript: serviceName,
        transcript: serviceName,
        attributes: {
          ...first.body.data.lexResponse.sessionAttributes,
          AmazonConnectContactId: contactId,
          lastAskedSlot: "serviceName",
          currentTurnTranscript: serviceName
        }
      })
    );

    const attrs = second.body.data.lexResponse.sessionAttributes;
    assert.equal(second.response.status, 200, serviceName);
    assert.equal(second.body.data.outcome, "MISSING_INFO", serviceName);
    if (serviceName === "Manicure") {
      assert.equal(second.body.data.lexResponse.dialogAction.type, "ElicitSlot", serviceName);
      assert.equal(second.body.data.lexResponse.dialogAction.slotToElicit, "serviceName", serviceName);
      assert.equal(attrs.serviceName, undefined, serviceName);
      assert.equal(attrs.requestedDate, today, serviceName);
      assert.equal(attrs.requestedTime, "2 PM", serviceName);
      assert.equal(attrs.staffPreference, "Amy", serviceName);
      assert.equal(attrs.staffId, ids.amy, serviceName);
      assert.equal(attrs.activeDtmfMenu, "service", serviceName);
      assert.match(second.body.data.lexResponse.message, /I heard Manicure/i, serviceName);
      assert.match(second.body.data.lexResponse.message, /Press 1 for Pedicure.*Press 2 for Manicure/i, serviceName);
      assert.equal(state.appointments.length, 0, serviceName);
      continue;
    }
    assert.equal(second.body.data.lexResponse.dialogAction.type, "ConfirmIntent", serviceName);
    assert.equal(attrs.serviceName, serviceName, serviceName);
    assert.equal(attrs.requestedDate, today, serviceName);
    assert.equal(attrs.requestedTime, "2 PM", serviceName);
    assert.equal(attrs.staffPreference, "Amy", serviceName);
    assert.equal(attrs.staffId, ids.amy, serviceName);
    assert.doesNotMatch(second.body.data.lexResponse.message, /which service|what day|what time|which staff|what name/i, serviceName);
    assert.equal(state.appointments.length, 0, serviceName);
  }
});

test("staff exclusions select first available while excluding Amy for explicit any-staff phrases", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  for (const phrase of ["any staff but not Amy", "anyone except Amy", "first available except Amy"]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "5 PM",
        staffPreference: "Any staff",
        staffId: ids.amy,
        confirmationState: undefined,
        amazonConnectContactId: `connect-exclude-amy-${phrase.replace(/\W+/g, "-")}`,
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          lastAskedSlot: "staffPreference",
          serviceName: "Pedicure",
          requestedDate,
          requestedTime: "5 PM",
          staffPreference: "Amy",
          staffId: ids.amy,
          selectedStaffId: ids.amy,
          confirmedStaffId: ids.amy,
          confirmedStaffName: "Amy",
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );

    const attrs = result.body.data.lexResponse.sessionAttributes;
    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.equal(attrs.staffPreference, "Trang", phrase);
    assert.equal(attrs.staffId, ids.trang, phrase);
    assert.notEqual(attrs.selectedStaffId, ids.amy, phrase);
    assert.notEqual(attrs.confirmedStaffId, ids.amy, phrase);
    assert.notEqual(attrs.confirmedStaffName, "Amy", phrase);
    assert.match(attrs.excludedStaffNames, /amy/i, phrase);
    assert.doesNotMatch(result.body.data.lexResponse.message, /with Amy/i, phrase);
    assert.equal(attrs.serviceName, "Pedicure", phrase);
    assert.equal(attrs.requestedDate, requestedDate, phrase);
    assert.equal(attrs.requestedTime, "5 PM", phrase);
  }
});

test("Trang negative ASR variants stay excluded through Any staff selection", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  for (const phrase of [
    "any staff but not praying",
    "only staff but not trained",
    "only staff not trained",
    "any staff but not Trang",
    "anyone except Trang",
    "first available except Trang"
  ]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: "Manicure",
        requestedDate,
        requestedTime: "11 AM",
        staffPreference: "Trang",
        staffId: ids.trang,
        confirmationState: undefined,
        amazonConnectContactId: `connect-exclude-trang-${phrase.replace(/\W+/g, "-")}`,
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          lastAskedSlot: "staffPreference",
          activeDtmfMenu: "staff",
          serviceName: "Manicure",
          requestedDate,
          requestedTime: "11 AM",
          staffPreference: "Trang",
          staffId: ids.trang,
          selectedStaffId: ids.trang,
          confirmedStaffId: ids.trang,
          confirmedStaffName: "Trang",
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );

    const attrs = result.body.data.lexResponse.sessionAttributes;
    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.equal(attrs.staffPreference, "Amy", phrase);
    assert.equal(attrs.staffId, ids.amy, phrase);
    assert.match(attrs.excludedStaffIds, new RegExp(ids.trang), phrase);
    assert.match(attrs.excludedStaffNames, /trang/i, phrase);
    assert.doesNotMatch(attrs.activeDtmfOptionsJson ?? "", /Trang/i, phrase);
    assert.doesNotMatch(result.body.data.lexResponse.message, /with Trang|found Trang/i, phrase);
    assert.match(result.body.data.lexResponse.message, /exclude Trang/i, phrase);
    assert.equal(attrs.serviceName, "Manicure", phrase);
    assert.equal(attrs.requestedDate, requestedDate, phrase);
    assert.equal(attrs.requestedTime, "11 AM", phrase);
    assert.equal(state.appointments.length, 0, phrase);
  }
});

test("production staff exclusion sequence keeps booking fields sticky and does not book before confirmation", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").toFormat("yyyy-MM-dd");
  const contactId = "connect-production-exclusion-sequence";

  const anyStop = await postInternalAppointment(
    bookingPayload({
      serviceName: "Manicure",
      requestedDate,
      requestedTime: "11 AM",
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      currentTurnTranscript: "any stop",
      transcript: "any stop",
      attributes: {
        AmazonConnectContactId: contactId,
        lastAskedSlot: "staffPreference",
        activeDtmfMenu: "staff",
        serviceName: "Manicure",
        requestedDate,
        requestedTime: "11 AM",
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );
  assert.equal(anyStop.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(anyStop.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(state.appointments.length, 0);

  const rejectTrang = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      currentTurnTranscript: "no i don't want jang",
      transcript: "no i don't want jang",
      attributes: {
        ...anyStop.body.data.lexResponse.sessionAttributes,
        AmazonConnectContactId: contactId,
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true"
      }
    })
  );
  assert.match(rejectTrang.body.data.lexResponse.sessionAttributes.excludedStaffNames, /trang/i);
  assert.doesNotMatch(rejectTrang.body.data.lexResponse.message, /Which detail would you like to change/i);
  assert.equal(rejectTrang.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(rejectTrang.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
  assert.equal(rejectTrang.body.data.lexResponse.sessionAttributes.staffId, ids.amy);
  assert.match(rejectTrang.body.data.lexResponse.message, /exclude Trang/i);

  const anotherStaff = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      currentTurnTranscript: "i want another staff",
      transcript: "i want another staff",
      attributes: {
        ...rejectTrang.body.data.lexResponse.sessionAttributes,
        AmazonConnectContactId: contactId,
        lastAskedSlot: "staffPreference"
      }
    })
  );

  const final = await postInternalAppointment(
    bookingPayload({
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      currentTurnTranscript: "any staff but not praying",
      transcript: "any staff but not praying",
      attributes: {
        ...anotherStaff.body.data.lexResponse.sessionAttributes,
        AmazonConnectContactId: contactId,
        lastAskedSlot: "staffPreference",
        activeDtmfMenu: "staff"
      }
    })
  );

  const attrs = final.body.data.lexResponse.sessionAttributes;
  assert.equal(final.response.status, 200);
  assert.equal(final.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(attrs.serviceName, "Manicure");
  assert.equal(attrs.requestedDate, requestedDate);
  assert.equal(attrs.requestedTime, "11 AM");
  assert.equal(attrs.customerName, "Kiet");
  assert.equal(attrs.staffPreference, "Kelly");
  assert.equal(attrs.staffId, ids.kelly);
  assert.match(attrs.excludedStaffIds, new RegExp(ids.trang));
  assert.match(attrs.excludedStaffIds, new RegExp(ids.amy));
  assert.match(attrs.excludedStaffNames, /trang/i);
  assert.match(attrs.excludedStaffNames, /amy/i);
  assert.doesNotMatch(attrs.activeDtmfOptionsJson ?? "", /Trang/i);
  assert.doesNotMatch(attrs.activeDtmfOptionsJson ?? "", /Amy/i);
  assert.doesNotMatch(final.body.data.lexResponse.message, /with Trang|found Trang/i);
  assert.match(final.body.data.lexResponse.message, /just to confirm: Manicure .* 11 AM with Kelly/i);
  assert.equal(state.appointments.length, 0);
});

test("negative Trang ASR aliases do not override exact active staff name collisions", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const collisionStaff = [
    ["Jang", "10000000-0000-4000-8000-000000000101"],
    ["Praying", "10000000-0000-4000-8000-000000000102"],
    ["Trained", "10000000-0000-4000-8000-000000000103"]
  ];

  for (const [staffName, staffId] of collisionStaff) {
    resetMockState();
    state.staff.push({
      id: staffId,
      salonId: ids.salonA,
      fullName: staffName,
      status: StaffStatus.ACTIVE,
      isBookable: true,
      createdAt: new Date("2026-01-10T00:00:00.000Z")
    });
    state.staffServiceMappings?.push({
      salonId: ids.salonA,
      staffId,
      serviceId: "20000000-0000-4000-8000-000000000000"
    });

    const positive = await postInternalAppointment(
      bookingPayload({
        serviceName: "Manicure",
        requestedDate,
        requestedTime: "11 AM",
        staffPreference: undefined,
        confirmationState: undefined,
        currentTurnTranscript: staffName.toLowerCase(),
        transcript: staffName.toLowerCase(),
        attributes: {
          lastAskedSlot: "staffPreference",
          activeDtmfMenu: "staff",
          serviceName: "Manicure",
          requestedDate,
          requestedTime: "11 AM",
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );
    assert.equal(positive.body.data.lexResponse.sessionAttributes.staffPreference, staffName, staffName);
    assert.equal(positive.body.data.lexResponse.sessionAttributes.staffId, staffId, staffName);

    const negative = await postInternalAppointment(
      bookingPayload({
        serviceName: "Manicure",
        requestedDate,
        requestedTime: "11 AM",
        staffPreference: "Any staff",
        staffId: ids.trang,
        confirmationState: undefined,
        currentTurnTranscript: `any staff but not ${staffName.toLowerCase()}`,
        transcript: `any staff but not ${staffName.toLowerCase()}`,
        attributes: {
          lastAskedSlot: "staffPreference",
          activeDtmfMenu: "staff",
          serviceName: "Manicure",
          requestedDate,
          requestedTime: "11 AM",
          staffPreference: "Trang",
          staffId: ids.trang,
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );
    assert.match(negative.body.data.lexResponse.sessionAttributes.excludedStaffIds, new RegExp(staffId), staffName);
    assert.doesNotMatch(negative.body.data.lexResponse.sessionAttributes.excludedStaffIds ?? "", new RegExp(ids.trang), staffName);
  }
});

test("staff exclusion control phrases exclude Amy and confirm the next eligible staff", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");

  for (const phrase of [
    "not Amy",
    "I don't want Amy",
    "another person, not Amy",
    "another staff",
    "another technician",
    "another stop",
    "someone else",
    "change the staff",
    "no, just change the staff"
  ]) {
    resetMockState();
    const result = await postInternalAppointment(
      bookingPayload({
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "5 PM",
        staffPreference: "Amy",
        staffId: ids.amy,
        confirmationState: "None",
        amazonConnectContactId: `connect-clear-amy-${phrase.replace(/\W+/g, "-")}`,
        currentTurnTranscript: phrase,
        transcript: phrase,
        attributes: {
          lastAskedSlot: "bookingConfirmation",
          awaitingFinalBookingConfirmation: "true",
          bookingConfirmationAsked: "true",
          serviceName: "Pedicure",
          requestedDate,
          requestedTime: "5 PM",
          staffPreference: "Amy",
          staffId: ids.amy,
          selectedStaffId: ids.amy,
          confirmedStaffId: ids.amy,
          confirmedStaffName: "Amy",
          customerName: "Kiet Nguyen",
          customerPhone: "+17325956266"
        }
      })
    );

    const attrs = result.body.data.lexResponse.sessionAttributes;
    assert.equal(result.response.status, 200, phrase);
    assert.equal(result.body.data.outcome, "MISSING_INFO", phrase);
    assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent", phrase);
    assert.notEqual(attrs.staffPreference, "Amy", phrase);
    assert.notEqual(attrs.staffId, ids.amy, phrase);
    assert.equal(attrs.selectedStaffId, attrs.staffId, phrase);
    assert.equal(attrs.confirmedStaffId, attrs.staffId, phrase);
    assert.ok(attrs.confirmedStaffName, phrase);
    assert.match(attrs.excludedStaffNames, /amy/i, phrase);
    assert.equal(attrs.serviceName, "Pedicure", phrase);
    assert.equal(attrs.requestedDate, requestedDate, phrase);
    assert.equal(attrs.requestedTime, "5 PM", phrase);
    assert.doesNotMatch(result.body.data.lexResponse.message, /with Amy|with Just/i, phrase);
    assert.match(result.body.data.lexResponse.message, /exclude Amy/i, phrase);
    assert.equal(state.appointments.length, 0, phrase);
  }
});

test("explicit Amy request removes Amy from staff exclusions", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Pedicure",
      requestedDate,
      requestedTime: "5 PM",
      staffPreference: undefined,
      staffId: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-wants-amy-after-exclusion",
      currentTurnTranscript: "I want Amy",
      transcript: "I want Amy",
      attributes: {
        lastAskedSlot: "staffPreference",
        activeDtmfMenu: "staff",
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "5 PM",
        excludedStaffIds: JSON.stringify([ids.amy]),
        excludedStaffNames: JSON.stringify(["amy"]),
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  const attrs = result.body.data.lexResponse.sessionAttributes;
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(attrs.staffPreference, "Amy");
  assert.equal(attrs.staffId, ids.amy);
  assert.equal(attrs.excludedStaffIds, undefined);
  assert.equal(attrs.excludedStaffNames, undefined);
  assert.match(result.body.data.lexResponse.message, /with Amy/i);
});

test("explicit Trang request removes Trang from staff exclusions", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Manicure",
      requestedDate,
      requestedTime: "11 AM",
      staffPreference: undefined,
      staffId: undefined,
      confirmationState: undefined,
      amazonConnectContactId: "connect-wants-trang-after-exclusion",
      currentTurnTranscript: "I want Trang",
      transcript: "I want Trang",
      attributes: {
        lastAskedSlot: "staffPreference",
        activeDtmfMenu: "staff",
        serviceName: "Manicure",
        requestedDate,
        requestedTime: "11 AM",
        excludedStaffIds: JSON.stringify([ids.trang]),
        excludedStaffNames: JSON.stringify(["Trang"]),
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  const attrs = result.body.data.lexResponse.sessionAttributes;
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(attrs.staffPreference, "Trang");
  assert.equal(attrs.staffId, ids.trang);
  assert.equal(attrs.excludedStaffIds, undefined);
  assert.equal(attrs.excludedStaffNames, undefined);
  assert.match(result.body.data.lexResponse.message, /with Trang/i);
});

test("staff exclusion says clearly when no other mapped technician is available", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  state.staffServiceMappings = state.staffServiceMappings?.filter(
    (mapping) => mapping.serviceId !== ids.pedicure || mapping.staffId === ids.amy
  ) ?? null;
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Pedicure",
      requestedDate,
      requestedTime: "5 PM",
      staffPreference: "Any staff",
      staffId: ids.amy,
      confirmationState: undefined,
      amazonConnectContactId: "connect-no-other-after-amy-exclusion",
      currentTurnTranscript: "any staff but not Amy",
      transcript: "any staff but not Amy",
      attributes: {
        lastAskedSlot: "staffPreference",
        serviceName: "Pedicure",
        requestedDate,
        requestedTime: "5 PM",
        staffPreference: "Amy",
        staffId: ids.amy,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.match(result.body.data.lexResponse.message, /another technician/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /found Amy|with Amy/i);
  assert.equal(state.appointments.length, 0);
});

test("time-only answer does not invent requestedDate today", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: "Amy",
      staffId: ids.amy,
      confirmationState: undefined,
      amazonConnectContactId: "connect-time-no-date",
      currentTurnTranscript: "two p m",
      transcript: "two p m",
      attributes: {
        lastAskedSlot: "requestedTime",
        serviceName: "Full Set",
        staffPreference: "Amy",
        staffId: ids.amy,
        customerName: "Lee",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "requestedDate");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "14:00");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Amy");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.amy);
  assert.equal(state.appointments.length, 0);
});

test("ptq service ASR resolves to Pedicure and is not stored as staff", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+84798171999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: "ptq",
      confirmationState: undefined,
      amazonConnectContactId: "connect-ptq-service",
      currentTurnTranscript: "hi i want to book a p t q tomorrow",
      transcript: "hi i want to book a p t q tomorrow",
      attributes: {
        currentTurnTranscript: "hi i want to book a p t q tomorrow"
      }
    })
  );

  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.confirmedServiceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, undefined);
  assert.notEqual(state.bookingAttempts.at(-1)?.requestedStaff, "ptq");
  assert.equal(state.appointments.length, 0);
});

test("active booking fragment with does not overwrite staff or customer name", async () => {
  addKevinStaff();
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      staffId: ids.trang,
      confirmationState: "None",
      amazonConnectContactId: "connect-final-fragment-with",
      currentTurnTranscript: "with",
      transcript: "with",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        staffId: ids.trang,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Kiet");
  assert.notEqual(state.bookingAttempts.at(-1)?.customerName, "with");
  assert.equal(state.appointments.length, 0);
});

test("not today clears only date and preserves active booking draft fields", async () => {
  const today = DateTime.now().setZone("America/New_York").toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate: today,
      requestedTime: "1 PM",
      staffPreference: "Trang",
      staffId: ids.trang,
      confirmationState: "None",
      amazonConnectContactId: "connect-final-not-today",
      currentTurnTranscript: "not today",
      transcript: "not today",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        requestedDate: today,
        requestedTime: "1 PM",
        staffPreference: "Trang",
        staffId: ids.trang,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "requestedDate");
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedDate, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.requestedTime, "1 PM");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(result.body.data.lexResponse.sessionAttributes.staffId, ids.trang);
  assert.equal(state.appointments.length, 0);
});

test("closed Friday is not kept trusted and Monday replacement works", async () => {
  state.businessHours = state.businessHours.map((hour) =>
    hour.dayOfWeek === 5 ? { ...hour, isOpen: false } : hour
  );
  const friday = "2026-05-29";
  const closed = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate: friday,
      requestedTime: "2 PM",
      staffPreference: "Trang",
      staffId: ids.trang,
      confirmationState: "None",
      amazonConnectContactId: "connect-closed-friday-then-monday",
      currentTurnTranscript: "next Friday",
      transcript: "next Friday",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        requestedDate: friday,
        requestedTime: "2 PM",
        staffPreference: "Trang",
        staffId: ids.trang,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(closed.response.status, 200);
  assert.equal(closed.body.data.outcome, "NO_AVAILABILITY");
  assert.equal(closed.body.data.lexResponse.sessionAttributes.requestedDate, undefined);
  assert.equal(closed.body.data.lexResponse.sessionAttributes.requestedTime, "2 PM");
  assert.equal(closed.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(closed.body.data.lexResponse.sessionAttributes.lastAskedSlot, "requestedDate");

  const monday = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate: undefined,
      requestedTime: "2 PM",
      staffPreference: "Trang",
      staffId: ids.trang,
      confirmationState: "None",
      amazonConnectContactId: "connect-closed-friday-then-monday",
      currentTurnTranscript: "Monday",
      transcript: "Monday",
      attributes: {
        ...closed.body.data.lexResponse.sessionAttributes,
        currentTurnTranscript: "Monday",
        requestedDate: undefined,
        lastAskedSlot: "requestedDate"
      }
    })
  );

  assert.equal(monday.response.status, 200);
  assert.equal(monday.body.data.outcome, "MISSING_INFO");
  assert.equal(monday.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(DateTime.fromISO(monday.body.data.lexResponse.sessionAttributes.requestedDate).weekday, 1);
  assert.equal(monday.body.data.lexResponse.sessionAttributes.requestedTime, "2 PM");
  assert.equal(monday.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.notEqual(monday.body.data.lexResponse.sessionAttributes.requestedDate, friday);
});

test("change the person before final confirmation confirms next eligible staff without goodbye", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const result = await postInternalAppointment(
    bookingPayload({
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: undefined,
      confirmationState: "None",
      amazonConnectContactId: "connect-final-change-person",
      currentTurnTranscript: "change the person",
      transcript: "change the person",
      attributes: {
        lastAskedSlot: "bookingConfirmation",
        awaitingFinalBookingConfirmation: "true",
        bookingConfirmationAsked: "true",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Amy",
        staffId: ids.amy,
        customerName: "Kiet Nguyen",
        customerPhone: "+17325956266"
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(state.appointments.length, 0);
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(result.body.data.lexResponse.sessionAttributes.conversationComplete, "false");
  assert.notEqual(result.body.data.lexResponse.sessionAttributes.staffId, ids.amy);
  assert.match(result.body.data.lexResponse.sessionAttributes.excludedStaffIds, new RegExp(ids.amy));
  assert.match(result.body.data.lexResponse.sessionAttributes.excludedStaffNames, /amy/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /Thank you for calling/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /with Amy/i);
});

test("reschedule confirmation updates the existing appointment without creating a duplicate", async () => {
  const originalStart = DateTime.now()
    .setZone("America/New_York")
    .plus({ days: 1 })
    .set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
  state.appointments.push({
    id: "upcoming-reschedule-one",
    salonId: ids.salonA,
    customerId: ids.kietCustomer,
    staffId: ids.trang,
    serviceId: ids.pedicure,
    startTime: originalStart.toUTC().toJSDate(),
    endTime: originalStart.plus({ minutes: 45 }).toUTC().toJSDate(),
    durationMinutes: 45,
    status: AppointmentStatus.SCHEDULED,
    source: AppointmentSource.AI
  });

  const first = await postInternalAppointment(
    bookingPayload({
      intentName: "RescheduleAppointmentIntent",
      amazonConnectContactId: "connect-reschedule-update",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      confirmationState: undefined,
      transcript: "I want to reschedule my appointment",
      currentTurnTranscript: "I want to reschedule my appointment"
    })
  );
  assert.equal(first.body.data.lexResponse.dialogAction.type, "ElicitIntent");
  assert.equal(first.body.data.lexResponse.sessionAttributes.rescheduleFlowActive, "true");

  const newDate = originalStart.plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const confirm = await postInternalAppointment(
    bookingPayload({
      intentName: "RescheduleAppointmentIntent",
      amazonConnectContactId: "connect-reschedule-update",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: "4 PM",
      confirmationState: undefined,
      transcript: "move it to 4 PM",
      currentTurnTranscript: "move it to 4 PM",
      attributes: {
        ...first.body.data.lexResponse.sessionAttributes,
        rescheduleRequestedDate: newDate
      }
    })
  );
  assert.equal(confirm.body.data.outcome, "MISSING_INFO");
  assert.equal(confirm.body.data.lexResponse.dialogAction.type, "ConfirmIntent");
  assert.equal(state.appointments.length, 1);

  const done = await postInternalAppointment(
    bookingPayload({
      intentName: "RescheduleAppointmentIntent",
      amazonConnectContactId: "connect-reschedule-update",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      confirmationState: "Confirmed",
      transcript: "yes, that's correct",
      currentTurnTranscript: "yes, that's correct",
      attributes: confirm.body.data.lexResponse.sessionAttributes
    })
  );

  assert.equal(done.response.status, 200);
  assert.equal(done.body.data.outcome, "RESCHEDULED");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.appointments[0].id, "upcoming-reschedule-one");
  const localStart = DateTime.fromJSDate(state.appointments[0].startTime, { zone: "utc" }).setZone(
    "America/New_York"
  );
  assert.equal(localStart.toFormat("yyyy-MM-dd"), newDate);
  assert.equal(localStart.hour, 16);
  assert.equal(done.body.data.lexResponse.sessionAttributes.conversationComplete, "true");
});

test("successful booking creates appointment, booking attempt, call session, transcript, and AI log", async () => {
  const result = await postInternalAppointment(
    bookingPayload({
      staffPreference: "Trang",
      amazonConnectContactId: "connect-contact-success",
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      transcript: "Kiet Nguyen wants a Pedicure with Trang tomorrow at five PM."
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
  assert.equal(state.callSessions[0].bookingResult.status, BookingAttemptStatus.SUCCESS);
  assert.equal(state.callSessions[0].failureReason, null);
});

test("Amazon Connect booking fulfillment upserts one AI log row with turnHistory", async () => {
  const contactId = "connect-ai-log-upsert";
  const first = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+84798171999",
      serviceName: undefined,
      requestedDate: undefined,
      requestedTime: undefined,
      staffPreference: undefined,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "I want to book a full set tomorrow at 2 PM with Trang.",
      transcript: "I want to book a full set tomorrow at 2 PM with Trang.",
      attributes: {
        AmazonConnectContactId: contactId,
        currentTurnTranscript: "I want to book a full set tomorrow at 2 PM with Trang."
      }
    })
  );
  const second = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+84798171999",
      serviceName: first.body.data.lexResponse.sessionAttributes.serviceName,
      requestedDate: first.body.data.lexResponse.sessionAttributes.requestedDate,
      requestedTime: first.body.data.lexResponse.sessionAttributes.requestedTime,
      staffPreference: first.body.data.lexResponse.sessionAttributes.staffPreference,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "full set",
      transcript: "full set",
      attributes: {
        ...first.body.data.lexResponse.sessionAttributes,
        AmazonConnectContactId: contactId,
        currentTurnTranscript: "full set"
      }
    })
  );
  await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+84798171999",
      serviceName: second.body.data.lexResponse.sessionAttributes.serviceName,
      requestedDate: second.body.data.lexResponse.sessionAttributes.requestedDate,
      requestedTime: second.body.data.lexResponse.sessionAttributes.requestedTime,
      staffPreference: second.body.data.lexResponse.sessionAttributes.staffPreference,
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "Lee",
      transcript: "Lee",
      attributes: {
        ...second.body.data.lexResponse.sessionAttributes,
        AmazonConnectContactId: contactId,
        currentTurnTranscript: "Lee"
      }
    })
  );

  assert.equal(state.callSessions.length, 1);
  assert.equal(state.aiInteractionLogs.length, 1);
  assert.equal(state.aiInteractionLogs[0].taskType, "amazon_connect_booking_fulfillment");
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnHistory.length, 3);
  assert.equal(
    state.aiInteractionLogs[0].responsePayload.turnHistory[0].currentTurnTranscript,
    "I want to book a full set tomorrow at 2 PM with Trang."
  );
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnHistory[1].currentTurnTranscript, "full set");
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnHistory[1].lastAskedSlotAfter, "customerName");
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnHistory[2].currentTurnTranscript, "Lee");
});

test("Amazon Connect booking fulfillment dedupes concurrent retries for the same ContactId", async () => {
  const contactId = "connect-ai-log-concurrent";
  const payload = bookingPayload({
    customerName: undefined,
    customerPhone: "+84798171999",
    serviceName: undefined,
    requestedDate: undefined,
    requestedTime: undefined,
    staffPreference: undefined,
    confirmationState: undefined,
    amazonConnectContactId: contactId,
    amazonConnectPhoneNumber: "+18483487681",
    calledNumber: "+18483487681",
    currentTurnTranscript: "full set",
    transcript: "full set",
    attributes: {
      AmazonConnectContactId: contactId,
      currentTurnTranscript: "full set",
      lastAskedSlot: "serviceName",
      activeDtmfMenu: "service"
    }
  });

  await Promise.all([postInternalAppointment(payload), postInternalAppointment(payload), postInternalAppointment(payload)]);

  assert.equal(state.callSessions.length, 1);
  assert.equal(state.aiInteractionLogs.length, 1);
  assert.match(state.aiInteractionLogs[0].interactionKey, /^AMAZON_CONNECT:amazon_connect_booking_fulfillment:/);
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnHistory.length, 1);
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnCount, 1);
  assert.equal(state.aiInteractionLogs[0].responsePayload.turnHistory[0].currentTurnTranscript, "full set");
  assert.equal(typeof state.aiInteractionLogs[0].responsePayload.turnHistory[0].idempotencyKey, "string");
});

test("Amazon Connect booking fulfillment creates separate AI log rows for different real ContactIds", async () => {
  await Promise.all([
    postInternalAppointment(
      bookingPayload({
        amazonConnectContactId: "connect-real-a",
        currentTurnTranscript: "pedicure",
        transcript: "pedicure",
        attributes: { AmazonConnectContactId: "connect-real-a", currentTurnTranscript: "pedicure" }
      })
    ),
    postInternalAppointment(
      bookingPayload({
        amazonConnectContactId: "connect-real-b",
        currentTurnTranscript: "manicure",
        transcript: "manicure",
        serviceName: "Manicure",
        attributes: { AmazonConnectContactId: "connect-real-b", currentTurnTranscript: "manicure" }
      })
    )
  ]);

  assert.equal(state.aiInteractionLogs.length, 2);
  assert.notEqual(state.aiInteractionLogs[0].interactionKey, state.aiInteractionLogs[1].interactionKey);
});

test("Admin AI logs exclude synthetic ContactIds by default and include them when requested", async () => {
  const realContactId = "7a82c651-5091-4f32-84f0-bf37d004317c";
  const syntheticContactId = "codex-name-smoke-test";
  await postInternalAppointment(
    bookingPayload({
      amazonConnectContactId: realContactId,
      currentTurnTranscript: "pedicure",
      transcript: "pedicure",
      attributes: {
        AmazonConnectContactId: realContactId,
        currentTurnTranscript: "pedicure"
      }
    })
  );
  await postInternalAppointment(
    bookingPayload({
      amazonConnectContactId: syntheticContactId,
      currentTurnTranscript: "pedicure",
      transcript: "pedicure",
      attributes: {
        AmazonConnectContactId: syntheticContactId,
        currentTurnTranscript: "pedicure"
      }
    })
  );

  const defaultList = await listAIInteractionsForAdmin({ page: 1, limit: 50 });
  const includedList = await listAIInteractionsForAdmin({
    page: 1,
    limit: 50,
    includeSynthetic: true
  });

  assert.equal(state.aiInteractionLogs.length, 2);
  assert.equal(state.aiInteractionLogs.filter((item) => item.isSynthetic).length, 1);
  assert.equal(
    state.aiInteractionLogs.find((item) => item.requestPayload.amazonConnectContactId === realContactId)
      ?.isSynthetic,
    false
  );
  assert.equal(defaultList.items.length, 1);
  assert.equal(defaultList.items[0].callSession?.providerCallId, realContactId);
  assert.equal(includedList.items.length, 2);
  assert.ok(includedList.items.some((item) => item.callSession?.providerCallId === syntheticContactId));
});

test("confirmed booking retry for the same Amazon Connect contact does not create a duplicate appointment", async () => {
  const payload = bookingPayload({
    staffPreference: "Trang",
    amazonConnectContactId: "connect-contact-idempotent",
    amazonConnectPhoneNumber: "+18483487681",
    calledNumber: "+18483487681",
    transcript: "Kiet Nguyen wants a Pedicure with Trang tomorrow at five PM."
  });

  const first = await postInternalAppointment(payload);
  const second = await postInternalAppointment(payload);

  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  assert.equal(first.body.data.outcome, "BOOKED");
  assert.equal(second.body.data.outcome, "BOOKED");
  assert.equal(state.appointments.length, 1);
  assert.equal(state.bookingAttempts.length, 1);
  assert.equal(state.bookingAttempts[0].status, BookingAttemptStatus.SUCCESS);
  assert.equal(second.body.data.appointment.id, first.body.data.appointment.id);
  assert.equal(second.body.data.bookingAttemptId, first.body.data.bookingAttemptId);
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
  assert.equal(result.body.data.lexResponse.message, "Let me check for an available operator.");
  assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "true");
  assert.equal(result.body.data.lexResponse.sessionAttributes.queueId, "queue-default");
  assert.equal(state.escalations[0].status, CallEscalationStatus.QUEUED);
  assert.equal(state.escalations[0].routingOutcome, CallRoutingOutcome.QUEUED);
  assert.equal(state.escalations[0].queueId, "queue-default");
  assert.equal(state.escalations[0].messageToCaller, "Let me check for an available operator.");
});

test("operator queue timeout callback closes the existing escalation once", async () => {
  const contactId = "connect-queue-timeout";
  const queued = await postInternalAppointment(
    bookingPayload({
      intentName: "HumanEscalationIntent",
      amazonConnectContactId: contactId,
      transcript: "I want to speak to a real person."
    })
  );

  assert.equal(queued.response.status, 200);
  assert.equal(state.escalations.length, 1);
  assert.equal(state.escalations[0].status, CallEscalationStatus.QUEUED);

  const callback = await postOperatorQueueOutcome({
    salonId: ids.salonA,
    contactId,
    outcome: "QUEUE_WAIT_TIMEOUT"
  });

  assert.equal(callback.response.status, 200);
  assert.equal(state.escalations.length, 1);
  assert.equal(callback.body.data.status, CallEscalationStatus.CLOSED);
  assert.equal(state.escalations[0].status, CallEscalationStatus.CLOSED);
  assert.equal(state.escalations[0].routingOutcome, CallRoutingOutcome.CALL_CENTER_ESCALATION);
  assert.equal(state.escalations[0].messageToCaller, "All of our operators are currently busy. Please call back later.");
  assert.equal(state.escalations[0].metadata.operatorQueueOutcome, "QUEUE_WAIT_TIMEOUT");
  assert.equal(state.callSessions[0].finalResolution, "All of our operators are currently busy. Please call back later.");
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
    assert.match(result.body.data.lexResponse.message, /upcoming Pedicure with Trang/i);
    assert.equal(result.body.data.lexResponse.sessionAttributes.customerId, ids.kietCustomer);
    assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Kiet");
    assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "false");
    assert.equal(result.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "false");
    if (intentName === "CancelAppointmentIntent") {
      assert.equal(
        result.body.data.lexResponse.sessionAttributes.awaitingExistingAppointmentHumanConfirmation,
        "true"
      );
    } else {
      assert.equal(result.body.data.lexResponse.sessionAttributes.rescheduleFlowActive, "true");
      assert.equal(result.body.data.lexResponse.sessionAttributes.existingAppointmentId, `upcoming-${intentName}`);
      assert.equal(
        result.body.data.lexResponse.sessionAttributes.awaitingExistingAppointmentHumanConfirmation,
        undefined
      );
      assert.match(result.body.data.lexResponse.message, /What day, time, or technician would you like to change it to/i);
    }
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
  assert.equal(result.body.data.lexResponse.message, "All of our operators are currently busy. Please call back later.");
  assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "false");
  assert.equal(result.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(result.body.data.lexResponse.sessionAttributes.queueId, undefined);
  assert.equal(result.body.data.lexResponse.sessionAttributes.conversationComplete, "true");
  assert.equal(state.escalations[0].status, CallEscalationStatus.CLOSED);
  assert.equal(state.escalations[0].routingOutcome, CallRoutingOutcome.CALL_CENTER_ESCALATION);
  assert.equal(state.escalations[0].messageToCaller, "All of our operators are currently busy. Please call back later.");
  assert.equal(state.escalations[0].metadata.operatorQueueOutcome, "NO_ASSIGNED_AGENTS");
});

test("press 0 and voice human request do not transfer with no staffed Connect agents", async () => {
  process.env.AMAZON_CONNECT_STAFFED_AGENTS_OVERRIDE = "0";
  process.env.AMAZON_CONNECT_AVAILABLE_AGENTS_OVERRIDE = "0";

  for (const [transcript, intentName] of [
    ["0", "BookAppointmentIntent"],
    ["I want to speak with a real person.", "HumanEscalationIntent"]
  ] as const) {
    resetMockState();
    process.env.AMAZON_CONNECT_STAFFED_AGENTS_OVERRIDE = "0";
    process.env.AMAZON_CONNECT_AVAILABLE_AGENTS_OVERRIDE = "0";
    const result = await postInternalAppointment(
      bookingPayload({
        intentName,
        amazonConnectContactId: `connect-no-staffed-${intentName}`,
        transcript,
        currentTurnTranscript: transcript
      })
    );

    assert.equal(result.response.status, 200, transcript);
    assert.equal(result.body.data.outcome, "HUMAN_ESCALATION", transcript);
    assert.equal(result.body.data.lexResponse.message, "All of our operators are currently busy. Please call back later.", transcript);
    assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "false", transcript);
    assert.equal(result.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "false", transcript);
    assert.equal(result.body.data.lexResponse.sessionAttributes.conversationComplete, "true", transcript);
    assert.equal(state.escalations.length, 1, transcript);
    assert.equal(state.escalations[0].status, CallEscalationStatus.CLOSED, transcript);
    assert.equal(state.escalations[0].routingOutcome, CallRoutingOutcome.CALL_CENTER_ESCALATION, transcript);
    assert.equal(state.escalations[0].metadata.operatorQueueOutcome, "AGENTS_UNAVAILABLE", transcript);
  }
});

test("backend errors and timeouts return safe Lex reprompts without auto transfer", async () => {
  state.throwOnSalonFind = new Error("database query timed out");
  let result = await postInternalAppointment(bookingPayload());
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "false");
  assert.equal(result.body.data.lexResponse.sessionAttributes.recoverableErrorReason, "backend_timeout");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.equal(result.body.data.lexResponse.sessionAttributes.serviceName, "Pedicure");
  assert.equal(result.body.data.lexResponse.sessionAttributes.customerName, "Kiet Nguyen");
  assert.match(result.body.data.lexResponse.message, /couldn't save the appointment/i);
  assert.doesNotMatch(result.body.data.lexResponse.message, /database|query|timed out/i);

  resetMockState();
  state.throwOnSalonFind = new Error("database host detail");
  result = await postInternalAppointment(bookingPayload());
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.outcome, "MISSING_INFO");
  assert.equal(result.body.data.lexResponse.sessionAttributes.transferToQueue, "false");
  assert.equal(result.body.data.lexResponse.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(result.body.data.lexResponse.sessionAttributes.recoverableErrorReason, "backend_error");
  assert.equal(result.body.data.lexResponse.dialogAction.type, "ElicitSlot");
  assert.equal(result.body.data.lexResponse.dialogAction.slotToElicit, "staffPreference");
  assert.doesNotMatch(result.body.data.lexResponse.message, /database|host detail/i);
});

test("recoverable backend error preserves slots and appends invalid turn to existing AI log", async () => {
  const requestedDate = DateTime.now().setZone("America/New_York").plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const contactId = "connect-recoverable-customer-create";
  const first = await postInternalAppointment(
    bookingPayload({
      customerName: undefined,
      customerPhone: "+84978634886",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: undefined,
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "full set",
      transcript: "full set",
      attributes: {
        AmazonConnectContactId: contactId,
        currentTurnTranscript: "full set",
        serviceName: "Full Set",
        requestedDate,
        requestedTime: "3 PM",
        staffPreference: "Trang",
        customerPhone: "+84978634886"
      }
    })
  );
  assert.equal(first.body.data.lexResponse.dialogAction.slotToElicit, "customerName");
  assert.equal(state.aiInteractionLogs.length, 1);

  state.throwOnCustomerCreate = Object.assign(new Error("Customer phone must be a valid US phone number."), {
    name: "INVALID_US_PHONE"
  });
  const second = await postInternalAppointment(
    bookingPayload({
      customerName: "Jane",
      customerPhone: "+84978634886",
      serviceName: "Full Set",
      requestedDate,
      requestedTime: "3 PM",
      staffPreference: "Trang",
      confirmationState: "Confirmed",
      amazonConnectContactId: contactId,
      amazonConnectPhoneNumber: "+18483487681",
      calledNumber: "+18483487681",
      currentTurnTranscript: "Jane",
      transcript: "Jane",
      attributes: {
        ...first.body.data.lexResponse.sessionAttributes,
        AmazonConnectContactId: contactId,
        lastAskedSlot: "customerName",
        currentTurnTranscript: "Jane",
        customerName: "Jane"
      }
    })
  );

  assert.equal(second.response.status, 200);
  assert.equal(second.body.data.outcome, "MISSING_INFO");
  assert.notEqual(second.body.data.lexResponse.dialogAction.type, "ElicitIntent");
  assert.equal(second.body.data.lexResponse.sessionAttributes.serviceName, "Full Set");
  assert.equal(second.body.data.lexResponse.sessionAttributes.requestedDate, requestedDate);
  assert.equal(second.body.data.lexResponse.sessionAttributes.requestedTime, "3 PM");
  assert.equal(second.body.data.lexResponse.sessionAttributes.staffPreference, "Trang");
  assert.equal(second.body.data.lexResponse.sessionAttributes.customerName, "Jane");
  assert.equal(second.body.data.lexResponse.sessionAttributes.customerPhone, "+84978634886");
  assert.match(second.body.data.lexResponse.message, /couldn't save the appointment/i);
  assert.equal(state.aiInteractionLogs.length, 1);
  const turnHistory = state.aiInteractionLogs[0].responsePayload.turnHistory;
  assert.equal(turnHistory.length, 2);
  assert.equal(turnHistory[1].currentTurnTranscript, "Jane");
  assert.equal(turnHistory[1].errorCode, "INVALID_US_PHONE");
  assert.equal(turnHistory[1].lastAskedSlotBefore, "customerName");
  assert.equal(state.aiInteractionLogs[0].isValid, false);
});
