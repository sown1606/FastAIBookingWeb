import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  AppointmentSource,
  AppointmentStatus,
  Role
} from "@prisma/client";
import { DateTime } from "luxon";
import { BLOCKING_APPOINTMENT_STATUSES } from "../src/config/constants";
import { prisma } from "../src/db/prisma";
import { validateAppointmentSlot } from "../src/modules/availability/availability.service";
import { buildListAppointmentsInput } from "../src/modules/appointments/appointments.routes";
import {
  formatAppointmentAlertDateTime,
  listAppointments,
  permanentlyDeleteAppointment,
  removeTechnicalAppointmentNoteLines,
  summarizeAppointments,
  toOwnerAppointmentResponse
} from "../src/modules/appointments/appointments.service";
import {
  createCustomer,
  deleteCustomer,
  getCustomerDeletePreview,
  getCustomerAppointmentHistory,
  searchCustomers,
  updateCustomer
} from "../src/modules/customers/customers.service";

type Patch = {
  target: Record<string, unknown>;
  key: string;
  original: unknown;
};

const patches: Patch[] = [];
const salonId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorUserId = "11111111-1111-4111-8111-111111111111";
const staffId = "22222222-2222-4222-8222-222222222222";
const serviceId = "33333333-3333-4333-8333-333333333333";
const customerId = "44444444-4444-4444-8444-444444444444";
const appointmentId = "55555555-5555-4555-8555-555555555555";

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

beforeEach(() => {
  restorePatches();
});

after(async () => {
  restorePatches();
  await prisma.$disconnect();
});

const setupAvailabilityMocks = (overlapStatus: AppointmentStatus | null) => {
  patch(prisma.salon as any, "findUnique", async () => ({
    id: salonId,
    timezone: "America/New_York"
  }));
  patch(prisma.service as any, "findMany", async () => [
    {
      id: serviceId,
      durationMinutes: 100
    }
  ]);
  patch(prisma.staff as any, "findFirst", async () => ({
    id: staffId
  }));
  patch(prisma.staffService as any, "count", async () => 1);
  patch(prisma.staffService as any, "findFirst", async () => ({
    id: "mapping-1",
    salonId,
    staffId,
    serviceId
  }));
  patch(prisma.businessHour as any, "findUnique", async () => ({
    salonId,
    dayOfWeek: 6,
    isOpen: true,
    openTime: "09:00",
    closeTime: "18:00"
  }));
  patch(prisma.appointment as any, "findFirst", async (args: any) => {
    if (!overlapStatus) {
      return null;
    }
    const statuses = args.where?.status?.in as AppointmentStatus[] | undefined;
    return statuses?.includes(overlapStatus) ? { id: "overlap-1" } : null;
  });
};

test("canonical blocking statuses are exactly active appointment states", () => {
  assert.deepEqual(BLOCKING_APPOINTMENT_STATUSES, [
    AppointmentStatus.SCHEDULED,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.IN_PROGRESS
  ]);
});

test("terminal appointments do not block availability while active statuses do", async () => {
  const startTime = new Date("2026-07-11T19:00:00.000Z");

  for (const status of [
    AppointmentStatus.CANCELED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW
  ]) {
    restorePatches();
    setupAvailabilityMocks(status);
    const result = await validateAppointmentSlot({
      salonId,
      staffId,
      serviceId,
      startTime
    });
    assert.equal(result.valid, true, `${status} should not block`);
  }

  for (const status of [
    AppointmentStatus.SCHEDULED,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.IN_PROGRESS
  ]) {
    restorePatches();
    setupAvailabilityMocks(status);
    const result = await validateAppointmentSlot({
      salonId,
      staffId,
      serviceId,
      startTime
    });
    assert.equal(result.valid, false, `${status} should block`);
  }
});

test("owner appointment DTO strips provider source and exact technical note lines", () => {
  const cleaned = removeTechnicalAppointmentNoteLines(
    [
      "Customer prefers quiet table.",
      "Created by Amazon Connect AI Booking.",
      "Source: amazon_connect_ai",
      "Amazon Connect contact: abc-123"
    ].join("\n")
  );
  assert.equal(cleaned, "Customer prefers quiet table.");

  const publicAppointment = toOwnerAppointmentResponse({
    id: appointmentId,
    notes: cleaned,
    source: AppointmentSource.AI
  });
  assert.equal("source" in publicAppointment, false);
  assert.equal(publicAppointment.bookingChannel, "assistant");
});

test("booking alert date formatter uses salon timezone and locale", () => {
  const utcStart = new Date("2026-07-15T18:00:00.000Z");

  assert.equal(
    formatAppointmentAlertDateTime(utcStart, "America/New_York", "vi-VN"),
    "14:00, 15/07/2026"
  );
  assert.equal(
    formatAppointmentAlertDateTime(utcStart, "America/New_York", "en-US"),
    "Jul 15, 2026 at 2:00 PM"
  );
  assert.equal(
    formatAppointmentAlertDateTime(new Date("2026-03-08T07:30:00.000Z"), "America/New_York", "en-US"),
    "Mar 8, 2026 at 3:30 AM"
  );
});

test("appointment summary counts operational statuses without pagination", async () => {
  let capturedArgs: any = null;
  patch(prisma.appointment as any, "groupBy", async (args: any) => {
    capturedArgs = args;
    return [
      { status: AppointmentStatus.SCHEDULED, _count: { _all: 2 } },
      { status: AppointmentStatus.CONFIRMED, _count: { _all: 1 } },
      { status: AppointmentStatus.IN_PROGRESS, _count: { _all: 1 } },
      { status: AppointmentStatus.COMPLETED, _count: { _all: 1 } },
      { status: AppointmentStatus.CANCELED, _count: { _all: 3 } },
      { status: AppointmentStatus.NO_SHOW, _count: { _all: 2 } }
    ];
  });

  const summary = await summarizeAppointments(salonId, {});

  assert.equal(summary.operationalCount, 4);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.canceledCount, 3);
  assert.equal(summary.noShowCount, 2);
  assert.equal(summary.historyCount, 6);
  assert.equal(summary.total, 10);
  assert.equal(capturedArgs.take, undefined);
  assert.equal(capturedArgs.skip, undefined);
});

test("appointment summary returns zero operational count for canceled-only day", async () => {
  patch(prisma.appointment as any, "groupBy", async () => [
    { status: AppointmentStatus.CANCELED, _count: { _all: 14 } }
  ]);

  const summary = await summarizeAppointments(salonId, {});

  assert.equal(summary.operationalCount, 0);
  assert.equal(summary.canceledCount, 14);
  assert.equal(summary.completedCount, 0);
});

test("list appointments without filters returns all visible appointments without Prisma pagination", async () => {
  const mockedAppointments = [
    { id: "appointment-1", salonId, startTime: new Date("2026-07-11T14:00:00.000Z") },
    { id: "appointment-2", salonId, startTime: new Date("2026-07-11T15:00:00.000Z") },
    { id: "appointment-3", salonId, startTime: new Date("2026-07-11T16:00:00.000Z") }
  ];
  let capturedFindManyArgs: any = null;

  patch(prisma.appointment as any, "findMany", async (args: any) => {
    capturedFindManyArgs = args;
    return mockedAppointments;
  });
  patch(prisma.appointment as any, "count", async () => mockedAppointments.length);

  const result = await listAppointments(salonId, {});

  assert.equal(Object.prototype.hasOwnProperty.call(capturedFindManyArgs, "skip"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedFindManyArgs, "take"), false);
  assert.equal(capturedFindManyArgs.where.salonId, salonId);
  assert.deepEqual(result.items, mockedAppointments);
  assert.equal(result.pagination.total, result.items.length);
  assert.equal(result.pagination.page, 1);
  assert.equal(result.pagination.limit, result.items.length);
});

test("list appointments explicit pagination remains supported", async () => {
  let capturedFindManyArgs: any = null;

  patch(prisma.appointment as any, "findMany", async (args: any) => {
    capturedFindManyArgs = args;
    return [];
  });
  patch(prisma.appointment as any, "count", async () => 42);

  const result = await listAppointments(salonId, {
    page: 2,
    limit: 20
  });

  assert.equal(capturedFindManyArgs.skip, 20);
  assert.equal(capturedFindManyArgs.take, 20);
  assert.equal(result.pagination.page, 2);
  assert.equal(result.pagination.limit, 20);
  assert.equal(result.pagination.total, 42);
});

test("list appointments keeps staff customer status and date filters intact", async () => {
  const dateFrom = new Date("2026-07-11T04:00:00.000Z");
  const dateTo = new Date("2026-07-12T03:59:00.000Z");
  let capturedFindManyArgs: any = null;

  patch(prisma.appointment as any, "findMany", async (args: any) => {
    capturedFindManyArgs = args;
    return [];
  });
  patch(prisma.appointment as any, "count", async () => 0);

  await listAppointments(salonId, {
    staffId,
    customerId,
    status: AppointmentStatus.CONFIRMED,
    dateFrom,
    dateTo
  });

  assert.equal(capturedFindManyArgs.where.salonId, salonId);
  assert.equal(capturedFindManyArgs.where.staffId, staffId);
  assert.equal(capturedFindManyArgs.where.customerId, customerId);
  assert.equal(capturedFindManyArgs.where.status, AppointmentStatus.CONFIRMED);
  assert.equal(capturedFindManyArgs.where.startTime.gte, dateFrom);
  assert.equal(capturedFindManyArgs.where.startTime.lte, dateTo);
});

test("appointment route pagination decision follows client filters and pagination only", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(
    buildListAppointmentsInput({}, { role: Role.SALON_OWNER }),
    "page"
  ), false);
  assert.deepEqual(buildListAppointmentsInput({ page: 1 }, { role: Role.SALON_OWNER }), {
    page: 1,
    limit: 20,
    staffId: undefined,
    customerId: undefined,
    status: undefined,
    dateFrom: undefined,
    dateTo: undefined
  });
  assert.deepEqual(buildListAppointmentsInput({ limit: 50 }, { role: Role.SALON_OWNER }), {
    page: 1,
    limit: 50,
    staffId: undefined,
    customerId: undefined,
    status: undefined,
    dateFrom: undefined,
    dateTo: undefined
  });
  assert.deepEqual(
    buildListAppointmentsInput(
      { status: AppointmentStatus.CONFIRMED },
      { role: Role.SALON_OWNER }
    ),
    {
      page: 1,
      limit: 20,
      staffId: undefined,
      customerId: undefined,
      status: AppointmentStatus.CONFIRMED,
      dateFrom: undefined,
      dateTo: undefined
    }
  );

  const staffInput = buildListAppointmentsInput({}, { role: Role.STAFF, staffId });
  assert.equal(Object.prototype.hasOwnProperty.call(staffInput, "page"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(staffInput, "limit"), false);
  assert.equal(staffInput.staffId, staffId);
});

test("appointment summary accepts salon-timezone day ranges across midnight and DST", async () => {
  let capturedWhere: any = null;
  patch(prisma.appointment as any, "groupBy", async (args: any) => {
    capturedWhere = args.where;
    return [{ status: AppointmentStatus.SCHEDULED, _count: { _all: 1 } }];
  });

  const summerFrom = DateTime.fromISO("2026-07-11T00:00", {
    zone: "America/New_York"
  }).toUTC().toJSDate();
  const summerTo = DateTime.fromISO("2026-07-11T23:59", {
    zone: "America/New_York"
  }).toUTC().toJSDate();
  await summarizeAppointments(salonId, {
    dateFrom: summerFrom,
    dateTo: summerTo
  });

  assert.equal(capturedWhere.startTime.gte.toISOString(), "2026-07-11T04:00:00.000Z");
  assert.equal(capturedWhere.startTime.lte.toISOString(), "2026-07-12T03:59:00.000Z");
  assert.equal(
    new Date("2026-07-12T03:30:00.000Z").getTime() <= capturedWhere.startTime.lte.getTime(),
    true
  );

  const dstFrom = DateTime.fromISO("2026-03-08T00:00", {
    zone: "America/New_York"
  }).toUTC().toJSDate();
  const dstTo = DateTime.fromISO("2026-03-08T23:59", {
    zone: "America/New_York"
  }).toUTC().toJSDate();
  await summarizeAppointments(salonId, {
    dateFrom: dstFrom,
    dateTo: dstTo
  });

  assert.equal(capturedWhere.startTime.gte.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(capturedWhere.startTime.lte.toISOString(), "2026-03-09T03:59:00.000Z");
});

test("customer update accepts international E.164 and rejects duplicate canonical phones", async () => {
  const customers = [
    {
      id: customerId,
      salonId,
      firstName: "Jane",
      lastName: "",
      email: null,
      phone: "+12125550100",
      notes: null
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      salonId,
      firstName: "Amy",
      lastName: "",
      email: null,
      phone: "+84978634886",
      notes: null
    }
  ];

  patch(prisma.customer as any, "findFirst", async (args: any) => {
    return (
      customers.find(
        (customer) =>
          customer.salonId === args.where?.salonId &&
          (!args.where?.id || customer.id === args.where.id || customer.id !== args.where.id?.not) &&
          (!args.where?.phone || customer.phone === args.where.phone)
      ) ?? null
    );
  });
  patch(prisma.customer as any, "update", async (args: any) => {
    const customer = customers.find((item) => item.id === args.where.id);
    assert.ok(customer);
    Object.assign(customer, args.data);
    return customer;
  });
  patch(prisma.auditLog as any, "create", async (args: any) => ({ id: "audit-1", ...args.data }));

  const updated = await updateCustomer(salonId, customerId, actorUserId, {
    phone: "+84 987 634 887",
    firstName: "Jane"
  });
  assert.equal(updated.phone, "+84987634887");

  await assert.rejects(
    () =>
      updateCustomer(salonId, customerId, actorUserId, {
        phone: "+84978634886"
      }),
    /A customer with this phone already exists/
  );
});

test("customer creation stores empty last name when it is omitted", async () => {
  let createdCustomer: any = null;

  patch(prisma.customer as any, "create", async (args: any) => {
    createdCustomer = {
      id: customerId,
      ...args.data
    };
    return createdCustomer;
  });
  patch(prisma.auditLog as any, "create", async (args: any) => ({ id: "audit-1", ...args.data }));

  const customer = await createCustomer(salonId, actorUserId, {
    firstName: "Kevin",
    phone: "+12125550100"
  });

  assert.equal(customer.firstName, "Kevin");
  assert.equal(customer.lastName, "");
  assert.equal(createdCustomer.lastName, "");
});

const setupCustomerDeleteMocks = (input: {
  existingSalonId?: string;
  existingDeletedAt?: Date | null;
  appointments?: Array<{ id: string; status: AppointmentStatus; startTime: Date }>;
  extraCustomers?: Array<{ id: string; salonId?: string; phone: string }>;
  callSessions?: Array<{ id: string; callerPhone: string }>;
  bookingAttempts?: Array<{ id: string; customerPhone?: string | null; appointmentId?: string | null; callSessionId?: string | null; transcriptId?: string | null }>;
  alertCount?: number;
  userNotificationCount?: number;
  failOnCustomerUpdate?: boolean;
}) => {
  const anonymousCustomerId = "99999999-9999-4999-8999-999999999999";
  const selectedCustomer = {
    id: customerId,
    salonId: input.existingSalonId ?? salonId,
    firstName: "Kevin",
    lastName: "Nguyen",
    email: "kevin@example.test",
    phone: "+12125550100",
    notes: "VIP",
    deletedAt: input.existingDeletedAt ?? null
  };
  const state = {
    customer: selectedCustomer,
    customers: [
      selectedCustomer,
      ...(input.extraCustomers ?? []).map((customer) => ({
        id: customer.id,
        salonId: customer.salonId ?? salonId,
        firstName: "Duplicate",
        lastName: "Profile",
        email: null,
        phone: customer.phone,
        notes: null,
        deletedAt: null
      }))
    ],
    anonymousCustomer: null as null | {
      id: string;
      salonId: string;
      firstName: string;
      lastName: string;
      email: null;
      phone: string;
      notes: null;
      deletedAt: Date;
    },
    deletedCustomerIds: [] as string[],
    appointments: (input.appointments ?? []).map((appointment) => ({
      ...appointment,
      salonId,
      customerId,
      staffId,
      serviceId,
      endTime: new Date(appointment.startTime.getTime() + 60 * 60 * 1000),
      durationMinutes: 60,
      source: AppointmentSource.DASHBOARD,
      canceledReason: null,
      staff: { id: staffId, fullName: "Trang" },
      service: { id: serviceId, name: "Full Set" },
      salon: { name: "Kiet Nails & Beauty", timezone: "America/New_York" },
      customer: {
        id: customerId,
        firstName: "Kevin",
        lastName: "Nguyen",
        phone: "+12125550100",
        email: "kevin@example.test"
      },
      appointmentServices: [],
      workSessions: [],
      reminders: [],
      feedback: null,
      statusHistory: []
    })),
    statusHistory: [] as any[],
    auditActions: [] as any[],
    remindersDeleted: 0,
    workSessionsClosed: 0,
    staffReleased: 0,
    customerFeedbackScrubbed: 0,
    callSessions: input.callSessions ?? [],
    bookingAttempts: input.bookingAttempts ?? [],
    aiInteractionsDeleted: 0,
    transcriptsDeleted: 0,
    alertsDeleted: 0,
    userNotificationsDeleted: 0
  };

  patch(prisma as any, "$transaction", async (callback: (tx: any) => Promise<unknown>) => {
    const snapshot = JSON.parse(JSON.stringify(state));
    try {
      return await callback(prisma);
    } catch (error) {
      Object.assign(state, {
        ...snapshot,
        appointments: snapshot.appointments.map((appointment: any) => ({
          ...appointment,
          startTime: new Date(appointment.startTime),
          endTime: new Date(appointment.endTime)
        })),
        customer: {
          ...snapshot.customer,
          deletedAt: snapshot.customer.deletedAt ? new Date(snapshot.customer.deletedAt) : null
        },
        customers: snapshot.customers.map((customer: any) => ({
          ...customer,
          deletedAt: customer.deletedAt ? new Date(customer.deletedAt) : null
        })),
        anonymousCustomer: snapshot.anonymousCustomer
          ? {
              ...snapshot.anonymousCustomer,
              deletedAt: new Date(snapshot.anonymousCustomer.deletedAt)
            }
          : null
      });
      throw error;
    }
  });

  patch(prisma.customer as any, "findFirst", async (args: any) => {
    if (args.where?.phone === "anonymous-customer") {
      if (args.where?.salonId !== salonId) {
        return null;
      }
      return state.anonymousCustomer;
    }

    const customer = state.customers.find(
      (item) =>
        item.id === args.where?.id &&
        item.salonId === args.where?.salonId &&
        !state.deletedCustomerIds.includes(item.id)
    );
    if (!customer) {
      return null;
    }
    if (args.where?.deletedAt === null && customer.deletedAt) {
      return null;
    }
    return customer;
  });
  patch(prisma.customer as any, "findMany", async (args: any) => {
    const phones = args.where?.phone?.in as string[] | undefined;
    return state.customers
      .filter(
        (customer) =>
          customer.salonId === args.where?.salonId &&
          !state.deletedCustomerIds.includes(customer.id) &&
          (!args.where?.deletedAt || customer.deletedAt === null) &&
          (!phones || phones.includes(customer.phone))
      )
      .map((customer) => ({
        id: customer.id,
        phone: customer.phone
      }));
  });
  patch(prisma.customer as any, "create", async (args: any) => {
    state.anonymousCustomer = {
      id: anonymousCustomerId,
      salonId: args.data.salonId,
      firstName: args.data.firstName,
      lastName: args.data.lastName,
      email: null,
      phone: args.data.phone,
      notes: null,
      deletedAt: args.data.deletedAt
    };
    return { id: anonymousCustomerId };
  });
  patch(prisma.appointment as any, "findMany", async (args: any) => {
    const customerWhere = args.where?.customerId;
    const customerIds = customerWhere?.in ?? (customerWhere ? [customerWhere] : []);
    return state.appointments
      .filter(
        (appointment) =>
          appointment.salonId === args.where?.salonId &&
          (!customerIds.length || customerIds.includes(appointment.customerId)) &&
          (!args.where?.status?.in || args.where.status.in.includes(appointment.status))
      )
      .map((appointment) => ({
        id: appointment.id,
        staffId: appointment.staffId,
        status: appointment.status
      }));
  });
  patch(prisma.appointment as any, "count", async (args: any) =>
    state.appointments.filter(
      (appointment) =>
        appointment.salonId === args.where?.salonId && appointment.customerId === args.where?.customerId
    ).length
  );
  patch(prisma.appointment as any, "update", async (args: any) => {
    const appointment = state.appointments.find((item) => item.id === args.where.id);
    assert.ok(appointment);
    Object.assign(appointment, args.data);
    return appointment;
  });
  patch(prisma.appointment as any, "updateMany", async (args: any) => {
    if (input.failOnCustomerUpdate) {
      throw new Error("customer update failed");
    }
    const customerIds = args.where?.customerId?.in as string[] | undefined;
    let count = 0;
    for (const appointment of state.appointments) {
      if (
        appointment.salonId === args.where?.salonId &&
        (!customerIds || customerIds.includes(appointment.customerId))
      ) {
        Object.assign(appointment, args.data);
        count += 1;
      }
    }
    return { count };
  });
  patch(prisma.appointment as any, "findUniqueOrThrow", async (args: any) => {
    const appointment = state.appointments.find((item) => item.id === args.where.id);
    assert.ok(appointment);
    return {
      ...appointment,
      customer: appointment.customer,
      staff: appointment.staff,
      service: appointment.service,
      salon: appointment.salon,
      appointmentServices: [],
      workSessions: [],
      reminders: [],
      feedback: null,
      statusHistory: state.statusHistory.filter((item) => item.appointmentId === appointment.id)
    };
  });
  patch(prisma.staff as any, "updateMany", async () => {
    state.staffReleased += 1;
    return { count: 1 };
  });
  patch(prisma.staffWorkSession as any, "updateMany", async () => {
    state.workSessionsClosed += 1;
    return { count: 1 };
  });
  patch(prisma.staffReminder as any, "deleteMany", async () => {
    state.remindersDeleted += 1;
    return { count: 1 };
  });
  patch(prisma.appointmentStatusHistory as any, "create", async (args: any) => {
    state.statusHistory.push(args.data);
    return args.data;
  });
  patch(prisma.customerFeedback as any, "updateMany", async () => {
    state.customerFeedbackScrubbed += 1;
    return { count: 1 };
  });
  patch(prisma.callSession as any, "findMany", async (args: any) => {
    const phones = args.where?.callerPhone?.in as string[] | undefined;
    return state.callSessions
      .filter((session) => args.where?.salonId === salonId && (!phones || phones.includes(session.callerPhone)))
      .map((session) => ({ id: session.id }));
  });
  patch(prisma.bookingAttempt as any, "count", async () => state.bookingAttempts.length);
  patch(prisma.bookingAttempt as any, "findMany", async () =>
    state.bookingAttempts.map((attempt) => ({
      id: attempt.id,
      callSessionId: attempt.callSessionId ?? null,
      transcriptId: attempt.transcriptId ?? null
    }))
  );
  patch(prisma.aiInteractionLog as any, "deleteMany", async () => {
    const count = state.bookingAttempts.length + state.callSessions.length;
    state.aiInteractionsDeleted += count;
    return { count };
  });
  patch(prisma.bookingAttempt as any, "deleteMany", async (args: any) => {
    const ids = args.where?.id?.in as string[] | undefined;
    const before = state.bookingAttempts.length;
    state.bookingAttempts = state.bookingAttempts.filter((attempt) => !ids?.includes(attempt.id));
    return { count: before - state.bookingAttempts.length };
  });
  patch(prisma.callTranscript as any, "deleteMany", async (args: any) => {
    const ids = args.where?.id?.in as string[] | undefined;
    state.transcriptsDeleted += ids?.length ?? 0;
    return { count: ids?.length ?? 0 };
  });
  patch(prisma.callSession as any, "deleteMany", async (args: any) => {
    const ids = args.where?.id?.in as string[] | undefined;
    const before = state.callSessions.length;
    state.callSessions = state.callSessions.filter((session) => !ids?.includes(session.id));
    return { count: before - state.callSessions.length };
  });
  patch(prisma.alert as any, "deleteMany", async () => {
    const count = input.alertCount ?? 0;
    state.alertsDeleted += count;
    return { count };
  });
  patch(prisma.userNotification as any, "deleteMany", async () => {
    const count = input.userNotificationCount ?? 0;
    state.userNotificationsDeleted += count;
    return { count };
  });
  patch(prisma.customer as any, "deleteMany", async (args: any) => {
    const ids = args.where?.id?.in as string[] | undefined;
    if (ids) {
      state.deletedCustomerIds.push(...ids);
    }
    return { count: ids?.length ?? 0 };
  });
  patch(prisma.auditLog as any, "create", async (args: any) => {
    state.auditActions.push(args.data);
    return { id: `audit-${state.auditActions.length}`, ...args.data };
  });

  return state;
};

test("customer delete hard-deletes customers with no appointment history", async () => {
  const state = setupCustomerDeleteMocks({});

  const result = await deleteCustomer(salonId, customerId, actorUserId);

  assert.equal(result.mode, "permanent_delete");
  assert.equal(result.appointmentCount, 0);
  assert.equal(result.canceledAppointmentCount, 0);
  assert.deepEqual(result.deletedCustomerIds, [customerId]);
  assert.deepEqual(state.deletedCustomerIds, [customerId]);
  assert.equal(state.auditActions[0].action, "CUSTOMER_PERMANENTLY_DELETED");
  assert.deepEqual(state.auditActions[0].metadata, {
    mode: "permanent_delete",
    selectedCustomerId: customerId,
    deletedCustomerIds: [customerId],
    matchedCustomerCount: 1,
    appointmentCount: 0,
    canceledAppointmentCount: 0,
    reassignedAppointmentCount: 0,
    deletedCallSessionCount: 0,
    deletedBookingAttemptCount: 0,
    deletedAiInteractionCount: 0,
    deletedAlertCount: 0
  });
});

test("customer delete permanently deletes customers with active appointments", async () => {
  const state = setupCustomerDeleteMocks({
    appointments: [
      {
        id: appointmentId,
        status: AppointmentStatus.SCHEDULED,
        startTime: new Date("2999-01-01T15:00:00.000Z")
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        status: AppointmentStatus.IN_PROGRESS,
        startTime: new Date("2999-01-02T15:00:00.000Z")
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        status: AppointmentStatus.COMPLETED,
        startTime: new Date("2026-01-01T15:00:00.000Z")
      }
    ]
  });

  const result = await deleteCustomer(salonId, customerId, actorUserId);

  assert.equal(result.mode, "permanent_delete");
  assert.equal(result.appointmentCount, 3);
  assert.equal(result.canceledAppointmentCount, 2);
  assert.equal(result.reassignedAppointmentCount, 3);
  assert.deepEqual(state.deletedCustomerIds, [customerId]);
  assert.equal(state.appointments[0].status, AppointmentStatus.CANCELED);
  assert.equal(state.appointments[1].status, AppointmentStatus.CANCELED);
  assert.equal(state.appointments[2].status, AppointmentStatus.COMPLETED);
  assert.equal(state.appointments[0].customerId, state.anonymousCustomer?.id);
  assert.equal(state.appointments[1].customerId, state.anonymousCustomer?.id);
  assert.equal(state.appointments[2].customerId, state.anonymousCustomer?.id);
  assert.equal(state.appointments[0].notes, null);
  assert.equal(state.statusHistory.length, 2);
  assert.equal(state.statusHistory[0].reason, "Customer data permanently deleted by salon owner");
  assert.equal(state.remindersDeleted, 2);
  assert.equal(state.workSessionsClosed, 2);
  assert.equal(state.staffReleased, 2);
  assert.equal(state.anonymousCustomer?.phone, "anonymous-customer");
  assert.ok(state.anonymousCustomer?.deletedAt);
  assert.equal(state.auditActions.at(-1).action, "CUSTOMER_PERMANENTLY_DELETED");
  assert.deepEqual(state.auditActions.at(-1).metadata, {
    mode: "permanent_delete",
    selectedCustomerId: customerId,
    deletedCustomerIds: [customerId],
    matchedCustomerCount: 1,
    appointmentCount: 3,
    canceledAppointmentCount: 2,
    reassignedAppointmentCount: 3,
    deletedCallSessionCount: 0,
    deletedBookingAttemptCount: 0,
    deletedAiInteractionCount: 0,
    deletedAlertCount: 0
  });
  assert.doesNotMatch(JSON.stringify(state.auditActions.at(-1).metadata), /12125550100|Kevin|kevin@example/i);
});

test("customer delete rolls back when reassignment fails", async () => {
  const state = setupCustomerDeleteMocks({
    failOnCustomerUpdate: true,
    appointments: [
      {
        id: appointmentId,
        status: AppointmentStatus.SCHEDULED,
        startTime: new Date("2999-01-01T15:00:00.000Z")
      }
    ]
  });

  await assert.rejects(() => deleteCustomer(salonId, customerId, actorUserId), /customer update failed/);
  assert.equal(state.appointments[0].status, AppointmentStatus.SCHEDULED);
  assert.equal(state.customer.phone, "+12125550100");
  assert.equal(state.customer.deletedAt, null);
  assert.equal(state.deletedCustomerIds.length, 0);
  assert.equal(state.anonymousCustomer, null);
  assert.equal(state.statusHistory.length, 0);
  assert.equal(state.auditActions.length, 0);
});

test("customer delete preview includes duplicate profiles in the same salon only", async () => {
  setupCustomerDeleteMocks({
    extraCustomers: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        phone: "2125550100"
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        salonId: "99999999-9999-4999-8999-999999999999",
        phone: "+12125550100"
      }
    ],
    appointments: [
      {
        id: appointmentId,
        status: AppointmentStatus.SCHEDULED,
        startTime: new Date("2999-01-01T15:00:00.000Z")
      }
    ],
    callSessions: [
      {
        id: "call-1",
        callerPhone: "+12125550100"
      }
    ],
    bookingAttempts: [
      {
        id: "attempt-1",
        customerPhone: "+12125550100",
        callSessionId: "call-1"
      }
    ]
  });

  const preview = await getCustomerDeletePreview(salonId, customerId);

  assert.equal(preview.matchedCustomerCount, 2);
  assert.deepEqual(preview.matchedCustomerIds.sort(), [
    "66666666-6666-4666-8666-666666666666",
    customerId
  ].sort());
  assert.equal(preview.appointmentCount, 1);
  assert.equal(preview.activeAppointmentCount, 1);
  assert.equal(preview.callSessionCount, 1);
  assert.equal(preview.bookingAttemptCount, 1);
});

test("customer delete rejects cross-salon customers", async () => {
  setupCustomerDeleteMocks({
    existingSalonId: "99999999-9999-4999-8999-999999999999"
  });

  await assert.rejects(
    () => deleteCustomer(salonId, customerId, actorUserId),
    /Customer not found/
  );
});

test("customer delete is not side-effectful on the second call", async () => {
  const state = setupCustomerDeleteMocks({});

  await deleteCustomer(salonId, customerId, actorUserId);
  const auditCount = state.auditActions.length;

  await assert.rejects(
    () => deleteCustomer(salonId, customerId, actorUserId),
    /Customer not found/
  );
  assert.equal(state.auditActions.length, auditCount);
  assert.deepEqual(state.deletedCustomerIds, [customerId]);
});

test("normal customer search excludes archived customers", async () => {
  const active = {
    id: customerId,
    salonId,
    firstName: "Kevin",
    lastName: "",
    phone: "+12125550100",
    deletedAt: null
  };
  const archived = {
    id: "77777777-7777-4777-8777-777777777777",
    salonId,
    firstName: "Archived",
    lastName: "",
    phone: "+12125550101",
    deletedAt: new Date("2026-01-01T00:00:00.000Z")
  };

  patch(prisma.customer as any, "findMany", async (args: any) => {
    assert.equal(args.where.deletedAt, null);
    return [active, archived].filter((customer) => !customer.deletedAt);
  });
  patch(prisma.customer as any, "count", async (args: any) => {
    assert.equal(args.where.deletedAt, null);
    return 1;
  });

  const result = await searchCustomers(salonId, { page: 1, limit: 20 });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, active.id);
  assert.equal(result.pagination.total, 1);
});

test("archived customer appointment history remains readable", async () => {
  patch(prisma.customer as any, "findFirst", async (args: any) => {
    assert.equal(args.where.deletedAt, undefined);
    return {
      id: customerId,
      salonId,
      firstName: "Kevin",
      lastName: "",
      phone: "+12125550100",
      deletedAt: new Date("2026-01-01T00:00:00.000Z")
    };
  });
  patch(prisma.appointment as any, "findMany", async () => [
    {
      id: appointmentId,
      salonId,
      customerId,
      staffId,
      serviceId,
      startTime: new Date("2026-01-01T15:00:00.000Z"),
      endTime: new Date("2026-01-01T16:00:00.000Z"),
      durationMinutes: 60,
      status: AppointmentStatus.COMPLETED,
      source: AppointmentSource.DASHBOARD,
      notes: null,
      canceledReason: null,
      staff: { id: staffId, fullName: "Trang" },
      service: { id: serviceId, name: "Full Set" }
    }
  ]);

  const history = await getCustomerAppointmentHistory(salonId, customerId);

  assert.equal(history.customer.id, customerId);
  assert.equal(history.appointments.length, 1);
});

const appointmentForDelete = (status: AppointmentStatus) => ({
  id: appointmentId,
  salonId,
  customerId,
  staffId,
  serviceId,
  startTime: new Date("2026-07-11T19:00:00.000Z"),
  endTime: new Date("2026-07-11T20:40:00.000Z"),
  durationMinutes: 100,
  status,
  source: AppointmentSource.DASHBOARD,
  notes: "Synthetic cleanup proof.",
  canceledReason: status === AppointmentStatus.CANCELED ? "Test cleanup" : null,
  staff: {
    id: staffId,
    fullName: "Trang"
  },
  service: {
    id: serviceId,
    name: "Full Set"
  },
  customer: {
    id: customerId,
    firstName: "Proof",
    lastName: "Customer",
    phone: "+12125550111"
  },
  salon: {
    name: "Kiet Nails & Beauty",
    timezone: "America/New_York"
  },
  appointmentServices: [],
  workSessions: [],
  reminders: [],
  feedback: null,
  statusHistory: [
    {
      previousStatus: AppointmentStatus.SCHEDULED,
      newStatus: status,
      reason: "Test",
      changedAt: new Date("2026-07-11T18:00:00.000Z")
    }
  ]
});

const setupDeleteMocks = (status: AppointmentStatus) => {
  const state = {
    appointment: appointmentForDelete(status),
    bookingAttemptsDetached: 0,
    deleted: false,
    auditSnapshot: null as unknown
  };
  patch(prisma as any, "$transaction", async (callback: (tx: any) => Promise<unknown>) => callback(prisma));
  patch(prisma.appointment as any, "findFirst", async () => state.appointment);
  patch(prisma.staff as any, "updateMany", async () => ({ count: 1 }));
  patch(prisma.staffWorkSession as any, "updateMany", async () => ({ count: 0 }));
  patch(prisma.bookingAttempt as any, "updateMany", async () => {
    state.bookingAttemptsDetached = 1;
    return { count: 1 };
  });
  patch(prisma.staffReminder as any, "deleteMany", async () => ({ count: 2 }));
  patch(prisma.auditLog as any, "create", async (args: any) => {
    state.auditSnapshot = args.data.metadata;
    return { id: "audit-1", ...args.data };
  });
  patch(prisma.appointment as any, "delete", async () => {
    state.deleted = true;
    return state.appointment;
  });
  return state;
};

test("permanent deletion rejects active appointments", async () => {
  setupDeleteMocks(AppointmentStatus.SCHEDULED);
  await assert.rejects(
    () => permanentlyDeleteAppointment(salonId, appointmentId, actorUserId),
    /Active appointments must be canceled or completed/
  );
});

test("permanent deletion detaches booking attempts and records a safe snapshot for terminal appointments", async () => {
  const state = setupDeleteMocks(AppointmentStatus.CANCELED);
  const result = await permanentlyDeleteAppointment(salonId, appointmentId, actorUserId);
  assert.equal(result.deleted, true);
  assert.equal(result.bookingAttemptsDetached, 1);
  assert.equal(state.deleted, true);
  assert.ok(state.auditSnapshot);
  assert.equal((state.auditSnapshot as any).appointmentSnapshot.serviceName, "Full Set");
  assert.equal((state.auditSnapshot as any).appointmentSnapshot.staffName, "Trang");
});
