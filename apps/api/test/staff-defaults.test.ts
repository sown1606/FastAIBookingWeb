import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { Role, StaffStatus } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import { createStaff } from "../src/modules/staff/staff.service";

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

const patch = (target: Record<string, unknown>, key: string, value: unknown) => {
  patches.push({ target, key, original: target[key] });
  target[key] = value;
};

const createState = () => ({
  staff: [] as any[],
  users: [] as any[],
  staffServices: [] as any[],
  auditLogs: [] as any[],
  billingUsage: [] as any[],
  services: [
    { id: serviceA, salonId, name: "Pedicure", isActive: true },
    { id: serviceB, salonId, name: "Manicure", isActive: true },
    { id: inactiveService, salonId, name: "Archived Service", isActive: false }
  ]
});

let state = createState();

const setupPrismaMock = () => {
  patch(prisma as any, "$transaction", async (callback: (tx: any) => Promise<unknown>) => callback(prisma));
  patch(prisma.staff as any, "create", async (args: any) => {
    const staff = {
      id: `staff-${state.staff.length + 1}`,
      ...args.data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    state.staff.push(staff);
    return staff;
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
    return state.staff.filter(
      (item) => item.salonId === args.where.salonId && item.status === args.where.status
    ).length;
  });
  patch(prisma.user as any, "findUnique", async (args: any) => {
    return state.users.find((item) => item.email === args.where.email) ?? null;
  });
  patch(prisma.user as any, "create", async (args: any) => {
    const user = {
      id: `user-${state.users.length + 1}`,
      ...args.data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    state.users.push(user);
    return user;
  });
  patch(prisma.service as any, "count", async (args: any) => {
    const ids = args.where.id?.in as string[] | undefined;
    return state.services.filter(
      (item) => item.salonId === args.where.salonId && (!ids || ids.includes(item.id))
    ).length;
  });
  patch(prisma.service as any, "findMany", async (args: any) => {
    return state.services
      .filter(
        (item) =>
          item.salonId === args.where.salonId &&
          (args.where.isActive === undefined || item.isActive === args.where.isActive)
      )
      .map((item) => ({ id: item.id, name: item.name, isActive: item.isActive }));
  });
  patch(prisma.staffService as any, "deleteMany", async (args: any) => {
    state.staffServices = state.staffServices.filter(
      (item) => item.salonId !== args.where.salonId || item.staffId !== args.where.staffId
    );
    return { count: 1 };
  });
  patch(prisma.staffService as any, "createMany", async (args: any) => {
    state.staffServices.push(...args.data);
    return { count: args.data.length };
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

test("createStaff defaults to Nail Technician, active, bookable, staff login, and active services", async () => {
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
  assert.equal(state.users[0].role, Role.STAFF);
});

test("createStaff keeps provided service mapping and still creates active bookable record without login", async () => {
  const result = await createStaff(salonId, actorUserId, {
    fullName: "Maya Nguyen",
    email: "maya@example.com",
    phone: "(212) 555-0102",
    title: "",
    createLogin: false,
    serviceIds: [serviceA]
  });

  assert.equal(result.staff.title, "Nail Technician");
  assert.equal(result.staff.status, StaffStatus.ACTIVE);
  assert.equal(result.staff.isBookable, true);
  assert.equal(result.staff.user, null);
  assert.deepEqual(result.staff.serviceIds, [serviceA]);
  assert.equal(state.users.length, 0);
});
