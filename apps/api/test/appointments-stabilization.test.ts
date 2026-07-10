import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  AppointmentSource,
  AppointmentStatus
} from "@prisma/client";
import { BLOCKING_APPOINTMENT_STATUSES } from "../src/config/constants";
import { prisma } from "../src/db/prisma";
import { validateAppointmentSlot } from "../src/modules/availability/availability.service";
import {
  permanentlyDeleteAppointment,
  removeTechnicalAppointmentNoteLines,
  toOwnerAppointmentResponse
} from "../src/modules/appointments/appointments.service";
import { updateCustomer } from "../src/modules/customers/customers.service";

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
