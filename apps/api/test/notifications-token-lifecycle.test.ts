import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { Role } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import {
  registerPushToken,
  sendPushToUserIds,
  unregisterPushToken
} from "../src/modules/notifications/notifications.service";

type Patch = {
  target: Record<string, unknown>;
  key: string;
  original: unknown;
};

type StoredPushToken = {
  id: string;
  token: string;
  userId: string;
  role: Role;
  salonId: string | null;
  staffId: string | null;
  platform: string;
  lastSeenAt: Date;
};

const patches: Patch[] = [];
let pushTokens: StoredPushToken[] = [];
let pushTokenId = 0;
let pushFindManyResultCounts: number[] = [];

const patch = (target: Record<string, unknown>, key: string, value: unknown) => {
  patches.push({ target, key, original: target[key] });
  target[key] = value;
};

const tokenMatchesWhere = (row: StoredPushToken, where: any): boolean => {
  if (!where) {
    return true;
  }

  if (Array.isArray(where.OR)) {
    return where.OR.some((condition: any) => tokenMatchesWhere(row, condition));
  }

  if (where.token !== undefined && row.token !== where.token) {
    return false;
  }

  if (where.userId !== undefined) {
    if (typeof where.userId === "string" && row.userId !== where.userId) {
      return false;
    }
    if (Array.isArray(where.userId.in) && !where.userId.in.includes(row.userId)) {
      return false;
    }
  }

  return true;
};

beforeEach(() => {
  pushTokens = [];
  pushTokenId = 0;
  pushFindManyResultCounts = [];

  patch(prisma.pushToken as any, "upsert", async (args: any) => {
    const existing = pushTokens.find((row) => row.token === args.where.token);
    if (existing) {
      Object.assign(existing, args.update, {
        lastSeenAt: args.update.lastSeenAt ?? existing.lastSeenAt
      });
      return existing;
    }

    const created = {
      id: `push-token-${++pushTokenId}`,
      ...args.create
    } as StoredPushToken;
    pushTokens.push(created);
    return created;
  });

  patch(prisma.pushToken as any, "deleteMany", async (args: any) => {
    const before = pushTokens.length;
    pushTokens = pushTokens.filter((row) => !tokenMatchesWhere(row, args.where));
    return { count: before - pushTokens.length };
  });

  patch(prisma.pushToken as any, "findMany", async (args: any) => {
    const rows = pushTokens
      .filter((row) => tokenMatchesWhere(row, args.where))
      .map((row) => ({
        userId: row.userId,
        token: row.token
      }));
    pushFindManyResultCounts.push(rows.length);
    return rows;
  });

  patch(prisma.userNotification as any, "create", async (args: any) => ({
    id: args.data.id,
    userId: args.data.userId
  }));

  patch(prisma as any, "$transaction", async (operations: Array<Promise<unknown>>) => {
    return Promise.all(operations);
  });
});

afterEach(() => {
  while (patches.length) {
    const patchItem = patches.pop()!;
    patchItem.target[patchItem.key] = patchItem.original;
  }
});

test("registering the same device token moves it from owner to staff", async () => {
  await registerPushToken({
    token: "same-device-token",
    platform: "ios",
    userId: "owner-user",
    role: Role.SALON_OWNER,
    salonId: "salon-1",
    staffId: null
  });

  await registerPushToken({
    token: "same-device-token",
    platform: "ios",
    userId: "staff-user",
    role: Role.STAFF,
    salonId: "salon-1",
    staffId: "trang-staff"
  });

  assert.equal(pushTokens.length, 1);
  assert.equal(pushTokens[0]?.token, "same-device-token");
  assert.equal(pushTokens[0]?.userId, "staff-user");
  assert.equal(pushTokens[0]?.role, Role.STAFF);
  assert.equal(pushTokens[0]?.salonId, "salon-1");
  assert.equal(pushTokens[0]?.staffId, "trang-staff");
});

test("logout unregister removes the matching token even when it is stale under another user", async () => {
  await registerPushToken({
    token: "stale-demo-token",
    platform: "android",
    userId: "owner-user",
    role: Role.SALON_OWNER,
    salonId: "salon-1",
    staffId: null
  });

  const result = await unregisterPushToken("staff-user", "stale-demo-token");
  assert.equal(result.count, 1);
  assert.equal(pushTokens.length, 0);
});

test("unregistering an expired or unknown token does not throw", async () => {
  const result = await unregisterPushToken("staff-user", "missing-token");
  assert.equal(result.count, 0);
  assert.equal(pushTokens.length, 0);
});

test("after logout, appointment push lookup does not return the unregistered token", async () => {
  await registerPushToken({
    token: "staff-device-token",
    platform: "ios",
    userId: "staff-user",
    role: Role.STAFF,
    salonId: "salon-1",
    staffId: "trang-staff"
  });
  await unregisterPushToken("staff-user", "staff-device-token");

  const result = await sendPushToUserIds(["staff-user"], {
    title: "Appointment rescheduled",
    body: "Your appointment was rescheduled.",
    type: "appointment_rescheduled",
    salonId: "salon-1",
    data: {
      staffId: "trang-staff"
    }
  });

  assert.deepEqual(pushFindManyResultCounts, [0]);
  assert.equal(result.attempted, 0);
});
