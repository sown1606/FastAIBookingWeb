import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { Role, StaffStatus } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import { createService } from "../src/modules/services/services.service";
import { createStaff, updateStaff } from "../src/modules/staff/staff.service";
import { repairStaffServiceDefaultsForSalon } from "../src/modules/staff/staff-defaults";

type Patch = {
  target: Record<string, unknown>;
  key: string;
  original: unknown;
};

const patches: Patch[] = [];

const salonId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorUserId = "11111111-1111-4111-8111-111111111111";
const serviceA = "20000000-0000-4000-8000-000000000001";
const serviceB = "20000000-0000-4000-8000-000000000002";
const inactiveService = "20000000-0000-4000-8000-000000000003";
const deletedService = "20000000-0000-4000-8000-000000000004";
const staffActive = "30000000-0000-4000-8000-000000000001";
const staffNonBookable = "30000000-0000-4000-8000-000000000002";
const staffInactive = "30000000-0000-4000-8000-000000000003";
const staffDeleted = "30000000-0000-4000-8000-000000000004";

const patch = (target: Record<string, unknown>, key: string, value: unknown) => {
  patches.push({ target, key, original: target[key] });
  target[key] = value;
};

const createState = () => ({
  staff: [
    {
      id: staffActive,
      salonId,
      fullName: "Trang",
      email: "trang@example.com",
      phone: "+12125550100",
      title: "Senior Technician",
      status: StaffStatus.ACTIVE,
      isBookable: true,
      deletedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    },
    {
      id: staffNonBookable,
      salonId,
      fullName: "Amy",
      email: "amy@example.com",
      phone: "+12125550101",
      title: "Pedicure Specialist",
      status: StaffStatus.ACTIVE,
      isBookable: false,
      deletedAt: null,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z")
    },
    {
      id: staffInactive,
      salonId,
      fullName: "Kelly",
      email: "kelly@example.com",
      phone: "+12125550102",
      title: "Nail Technician",
      status: StaffStatus.INACTIVE,
      isBookable: true,
      deletedAt: null,
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:00:00.000Z")
    },
    {
      id: staffDeleted,
      salonId,
      fullName: "Linh",
      email: "linh@example.com",
      phone: "+12125550103",
      title: "Manager",
      status: StaffStatus.ACTIVE,
      isBookable: true,
      deletedAt: new Date("2026-01-04T00:00:00.000Z"),
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
      updatedAt: new Date("2026-01-04T00:00:00.000Z")
    }
  ] as any[],
  users: [
    {
      id: "user-existing-staff",
      email: "trang@example.com",
      fullName: "Trang",
      phone: "+12125550100",
      role: Role.STAFF,
      salonId,
      staffId: staffActive,
      isActive: true
    }
  ] as any[],
  staffServices: [] as any[],
  auditLogs: [] as any[],
  billingUsage: [] as any[],
  services: [
    {
      id: serviceA,
      salonId,
      name: "Pedicure",
      isActive: true,
      deletedAt: null,
      durationMinutes: 45,
      priceCents: 4500,
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    },
    {
      id: serviceB,
      salonId,
      name: "Manicure",
      isActive: true,
      deletedAt: null,
      durationMinutes: 40,
      priceCents: 3500,
      createdAt: new Date("2026-01-02T00:00:00.000Z")
    },
    {
      id: inactiveService,
      salonId,
      name: "Archived Service",
      isActive: false,
      deletedAt: null,
      durationMinutes: 30,
      priceCents: 3000,
      createdAt: new Date("2026-01-03T00:00:00.000Z")
    },
    {
      id: deletedService,
      salonId,
      name: "Deleted Service",
      isActive: true,
      deletedAt: new Date("2026-01-04T00:00:00.000Z"),
      durationMinutes: 30,
      priceCents: 3000,
      createdAt: new Date("2026-01-04T00:00:00.000Z")
    }
  ],
  throwOnStaffServiceCreateMany: false,
  throwOnUserCreate: false
});

let state = createState();

const cloneState = () => ({
  ...state,
  staff: state.staff.map((item) => ({ ...item })),
  users: state.users.map((item) => ({ ...item })),
  staffServices: state.staffServices.map((item) => ({ ...item })),
  auditLogs: state.auditLogs.map((item) => ({ ...item })),
  billingUsage: state.billingUsage.map((item) => ({ ...item })),
  services: state.services.map((item) => ({ ...item }))
});

const matchesDeletedAt = (value: unknown, expected: unknown) =>
  expected === undefined || value === expected;

const setupPrismaMock = () => {
  patch(prisma as any, "$transaction", async (callback: (tx: any) => Promise<unknown>) => {
    const snapshot = cloneState();
    try {
      return await callback(prisma);
    } catch (error) {
      state = snapshot;
      throw error;
    }
  });
  patch(prisma.staff as any, "create", async (args: any) => {
    const staff = {
      id: `staff-${state.staff.length + 1}`,
      ...args.data,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    state.staff.push(staff);
    return staff;
  });
  patch(prisma.staff as any, "update", async (args: any) => {
    const staff = state.staff.find((item) => item.id === args.where.id);
    assert.ok(staff);
    Object.assign(staff, args.data, { updatedAt: new Date() });
    return staff;
  });
  patch(prisma.staff as any, "updateMany", async (args: any) => {
    const ids = args.where?.id?.in as string[] | undefined;
    let count = 0;
    for (const staff of state.staff) {
      if (
        (!args.where?.salonId || staff.salonId === args.where.salonId) &&
        (!ids || ids.includes(staff.id)) &&
        matchesDeletedAt(staff.deletedAt, args.where?.deletedAt)
      ) {
        Object.assign(staff, args.data);
        count += 1;
      }
    }
    return { count };
  });
  patch(prisma.staff as any, "findFirst", async (args: any) => {
    const staff = state.staff.find(
      (item) =>
        (!args.where?.id || item.id === args.where.id) &&
        (!args.where?.salonId || item.salonId === args.where.salonId) &&
        matchesDeletedAt(item.deletedAt, args.where?.deletedAt)
    );
    if (!staff) {
      return null;
    }
    return {
      ...staff,
      user: state.users.find((item) => item.staffId === staff.id) ?? null
    };
  });
  patch(prisma.staff as any, "findUniqueOrThrow", async (args: any) => {
    const staff = state.staff.find((item) => item.id === args.where.id);
    assert.ok(staff);
    return {
      ...staff,
      user: state.users.find((item) => item.staffId === staff.id) ?? null,
      staffServices: state.staffServices
        .filter((item) => item.staffId === staff.id)
        .map((item) => ({
          ...item,
          service: state.services.find((service) => service.id === item.serviceId)
        }))
    };
  });
  patch(prisma.staff as any, "count", async (args: any) => {
    const ids = args.where?.id?.in as string[] | undefined;
    return state.staff.filter(
      (item) =>
        (!args.where?.salonId || item.salonId === args.where.salonId) &&
        (!args.where?.status || item.status === args.where.status) &&
        (args.where?.isBookable === undefined || item.isBookable === args.where.isBookable) &&
        matchesDeletedAt(item.deletedAt, args.where?.deletedAt) &&
        (!ids || ids.includes(item.id))
    ).length;
  });
  patch(prisma.staff as any, "findMany", async (args: any) => {
    const ids = args.where?.id?.in as string[] | undefined;
    const staff = state.staff.filter(
      (item) =>
        (!args.where?.salonId || item.salonId === args.where.salonId) &&
        (!args.where?.status || item.status === args.where.status) &&
        (args.where?.isBookable === undefined || item.isBookable === args.where.isBookable) &&
        matchesDeletedAt(item.deletedAt, args.where?.deletedAt) &&
        (!ids || ids.includes(item.id)) &&
        (!args.where?.OR ||
          args.where.OR.some((condition: any) =>
            condition.title === null
              ? item.title === null
              : condition.title?.not !== undefined
                ? item.title !== condition.title.not
                : false
          ))
    );
    return staff.map((item) => ({ id: item.id, fullName: item.fullName, title: item.title }));
  });
  patch(prisma.user as any, "findUnique", async (args: any) => {
    return state.users.find((item) => item.email === args.where.email) ?? null;
  });
  patch(prisma.user as any, "create", async (args: any) => {
    if (state.throwOnUserCreate) {
      throw new Error("user create failed");
    }
    const user = {
      id: `user-${state.users.length + 1}`,
      ...args.data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    state.users.push(user);
    return user;
  });
  patch(prisma.user as any, "update", async (args: any) => {
    const user = state.users.find((item) => item.id === args.where.id);
    assert.ok(user);
    Object.assign(user, args.data);
    return user;
  });
  patch(prisma.service as any, "create", async (args: any) => {
    const service = {
      id: `service-${state.services.length + 1}`,
      ...args.data,
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    state.services.push(service);
    return service;
  });
  patch(prisma.service as any, "count", async (args: any) => {
    const ids = args.where.id?.in as string[] | undefined;
    return state.services.filter(
      (item) =>
        item.salonId === args.where.salonId &&
        matchesDeletedAt(item.deletedAt, args.where.deletedAt) &&
        (!ids || ids.includes(item.id))
    ).length;
  });
  patch(prisma.service as any, "findMany", async (args: any) => {
    const ids = args.where?.id?.in as string[] | undefined;
    return state.services
      .filter(
        (item) =>
          (!args.where?.salonId || item.salonId === args.where.salonId) &&
          (args.where?.isActive === undefined || item.isActive === args.where.isActive) &&
          matchesDeletedAt(item.deletedAt, args.where?.deletedAt) &&
          (!ids || ids.includes(item.id))
      )
      .map((item) => ({ id: item.id, name: item.name, isActive: item.isActive }));
  });
  patch(prisma.service as any, "findUniqueOrThrow", async (args: any) => {
    const service = state.services.find((item) => item.id === args.where.id);
    assert.ok(service);
    return {
      ...service,
      staffServices: state.staffServices
        .filter((item) => item.serviceId === service.id)
        .map((item) => ({
          ...item,
          staff: state.staff.find((staff) => staff.id === item.staffId)
        }))
    };
  });
  patch(prisma.staffService as any, "findMany", async (args: any) => {
    return state.staffServices.filter(
      (item) =>
        (!args.where?.salonId || item.salonId === args.where.salonId) &&
        (!args.where?.staffId || item.staffId === args.where.staffId) &&
        (!args.where?.serviceId || item.serviceId === args.where.serviceId)
    );
  });
  patch(prisma.staffService as any, "count", async (args: any) => {
    return state.staffServices.filter(
      (item) =>
        (!args.where?.salonId || item.salonId === args.where.salonId) &&
        (!args.where?.staffId || item.staffId === args.where.staffId) &&
        (!args.where?.serviceId || item.serviceId === args.where.serviceId)
    ).length;
  });
  patch(prisma.staffService as any, "deleteMany", async (args: any) => {
    const before = state.staffServices.length;
    state.staffServices = state.staffServices.filter(
      (item) => item.salonId !== args.where.salonId || item.staffId !== args.where.staffId
    );
    return { count: before - state.staffServices.length };
  });
  patch(prisma.staffService as any, "createMany", async (args: any) => {
    if (state.throwOnStaffServiceCreateMany) {
      throw new Error("staff service createMany failed");
    }
    let count = 0;
    for (const row of args.data) {
      const exists = state.staffServices.some(
        (item) => item.staffId === row.staffId && item.serviceId === row.serviceId
      );
      if (!exists) {
        state.staffServices.push(row);
        count += 1;
      }
    }
    return { count };
  });
  patch(prisma.billingUsage as any, "upsert", async (args: any) => {
    state.billingUsage.push(args.create);
    return args.create;
  });
  patch(prisma.auditLog as any, "create", async (args: any) => {
    state.auditLogs.push(args.data);
    return args.data;
  });
  patch(prisma.salon as any, "findUnique", async () => ({ name: "Unit Test Salon" }));
};

setupPrismaMock();

beforeEach(() => {
  state = createState();
});

after(() => {
  for (const item of patches.reverse()) {
    item.target[item.key] = item.original;
  }
});

test("createStaff maps missing serviceIds to all active non-deleted services", async () => {
  const result = await createStaff(salonId, actorUserId, {
    fullName: "Lina Tran",
    email: "lina@example.com",
    phone: "(212) 555-0101",
    password: "StrongPass123!"
  });

  assert.equal(result.staff.title, "Nail Technician");
  assert.equal(result.staff.status, StaffStatus.ACTIVE);
  assert.equal(result.staff.isBookable, true);
  assert.equal(result.staff.user?.role, Role.STAFF);
  assert.deepEqual(new Set(result.staff.serviceIds), new Set([serviceA, serviceB]));
});

test("createStaff maps empty serviceIds to all active services and skips inactive/deleted services", async () => {
  const result = await createStaff(salonId, actorUserId, {
    fullName: "Maya Nguyen",
    email: "maya@example.com",
    phone: "(212) 555-0102",
    title: "Manager",
    createLogin: false,
    serviceIds: []
  });

  assert.equal(result.staff.title, "Nail Technician");
  assert.deepEqual(new Set(result.staff.serviceIds), new Set([serviceA, serviceB]));
  assert.equal(result.staff.serviceIds.includes(inactiveService), false);
  assert.equal(result.staff.serviceIds.includes(deletedService), false);
  assert.equal(state.users.length, 1);
});

test("createStaff keeps non-empty explicit serviceIds for API compatibility", async () => {
  const result = await createStaff(salonId, actorUserId, {
    fullName: "Nora Pham",
    email: "nora@example.com",
    phone: "(212) 555-0103",
    createLogin: false,
    serviceIds: [serviceA]
  });

  assert.deepEqual(result.staff.serviceIds, [serviceA]);
});

test("createStaff rolls back staff, login, and mapping when mapping fails", async () => {
  state.throwOnStaffServiceCreateMany = true;
  await assert.rejects(
    () =>
      createStaff(salonId, actorUserId, {
        fullName: "Rollback Staff",
        email: "rollback@example.com",
        phone: "(212) 555-0104"
      }),
    /staff service createMany failed/
  );
  assert.equal(state.staff.some((item) => item.email === "rollback@example.com"), false);
  assert.equal(state.users.some((item) => item.email === "rollback@example.com"), false);
  assert.equal(state.staffServices.some((item) => String(item.staffId).startsWith("staff-")), false);
});

test("createStaff rolls back staff and mapping when login creation fails", async () => {
  state.throwOnUserCreate = true;
  await assert.rejects(
    () =>
      createStaff(salonId, actorUserId, {
        fullName: "Login Rollback",
        email: "login-rollback@example.com",
        phone: "(212) 555-0105"
      }),
    /user create failed/
  );
  assert.equal(state.staff.some((item) => item.email === "login-rollback@example.com"), false);
  assert.equal(state.staffServices.some((item) => String(item.staffId).startsWith("staff-")), false);
});

test("createService maps missing staffIds to active bookable non-deleted staff", async () => {
  const service = await createService(salonId, actorUserId, {
    name: "Full Set",
    durationMinutes: 100,
    priceCents: 8500
  });

  assert.deepEqual(
    new Set(service.staffServices.map((row: any) => row.staffId)),
    new Set([staffActive])
  );
});

test("createService maps empty staffIds to eligible staff and skips inactive, non-bookable, deleted staff", async () => {
  const service = await createService(salonId, actorUserId, {
    name: "Dip Powder",
    durationMinutes: 70,
    priceCents: 5800,
    staffIds: []
  });

  const mappedStaffIds = service.staffServices.map((row: any) => row.staffId);
  assert.deepEqual(new Set(mappedStaffIds), new Set([staffActive]));
  assert.equal(mappedStaffIds.includes(staffNonBookable), false);
  assert.equal(mappedStaffIds.includes(staffInactive), false);
  assert.equal(mappedStaffIds.includes(staffDeleted), false);
});

test("createService keeps non-empty explicit staffIds and does not duplicate rows", async () => {
  const service = await createService(salonId, actorUserId, {
    name: "Builder Gel",
    durationMinutes: 60,
    priceCents: 6000,
    staffIds: [staffActive, staffActive]
  });

  assert.deepEqual(service.staffServices.map((row: any) => row.staffId), [staffActive]);
});

test("updateStaff cannot persist arbitrary titles", async () => {
  const updated = await updateStaff(salonId, staffActive, actorUserId, {
    title: "Manager",
    fullName: "Trang Updated",
    email: "trang@example.com",
    phone: "(212) 555-0100"
  });

  assert.equal(updated.title, "Nail Technician");
  assert.equal(state.users.find((item) => item.staffId === staffActive)?.role, Role.STAFF);
});

test("salon-scoped repair is idempotent and normalizes Staff.title without changing User.role", async () => {
  state.staffServices = [{ salonId, staffId: staffActive, serviceId: serviceA }];

  const dryRun = await repairStaffServiceDefaultsForSalon(salonId);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.beforeCount, 1);
  assert.deepEqual(
    dryRun.missingPairs.map((pair) => `${pair.staffId}:${pair.serviceId}`),
    [`${staffActive}:${serviceB}`]
  );
  assert.deepEqual(new Set(dryRun.normalizedTitleStaffIds), new Set([staffActive, staffNonBookable]));

  const applied = await repairStaffServiceDefaultsForSalon(salonId, { dryRun: false });
  assert.equal(applied.insertedCount, 1);
  assert.equal(applied.afterCount, 2);
  assert.equal(applied.normalizedTitleCount, 2);
  assert.equal(state.staff.find((item) => item.id === staffActive)?.title, "Nail Technician");
  assert.equal(state.staff.find((item) => item.id === staffNonBookable)?.title, "Nail Technician");
  assert.equal(state.users.find((item) => item.staffId === staffActive)?.role, Role.STAFF);

  const second = await repairStaffServiceDefaultsForSalon(salonId, { dryRun: false });
  assert.equal(second.insertedCount, 0);
  assert.equal(second.normalizedTitleCount, 0);
  assert.equal(second.afterCount, 2);
});
