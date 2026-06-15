import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { Role, SalonStatus, SubscriptionStatus } from "@prisma/client";
import { app } from "../src/app";
import { prisma } from "../src/db/prisma";
import { hashPassword } from "../src/lib/password";

type Patch = {
  target: Record<string, unknown>;
  key: string;
  original: unknown;
};

const patches: Patch[] = [];
let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let passwordHash = "";
let loginUserLanguage: string | null = null;
let createdUser: Record<string, unknown> | null = null;

const ownerEmail = "owner-language@example.com";
const registerEmail = "register-language@example.com";
const password = "Password123!";

const patch = (target: Record<string, unknown>, key: string, value: unknown) => {
  patches.push({ target, key, original: target[key] });
  target[key] = value;
};

const loginUser = () => ({
  id: "11111111-1111-4111-8111-111111111111",
  email: ownerEmail,
  passwordHash,
  fullName: "Owner Language",
  phone: "+17325550100",
  language: loginUserLanguage,
  role: Role.SALON_OWNER,
  isEmailVerified: true,
  isActive: true,
  salonId: "22222222-2222-4222-8222-222222222222",
  staffId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z")
});

const setupPrismaMock = () => {
  patch(prisma as any, "$transaction", async (callback: (tx: any) => Promise<unknown>) => callback(prisma));
  patch(prisma.user as any, "findUnique", async (args: any) => {
    const email = args?.where?.email;
    if (email === ownerEmail) {
      return loginUser();
    }
    if (email === registerEmail) {
      return createdUser;
    }
    return null;
  });
  patch(prisma.user as any, "create", async (args: any) => {
    createdUser = {
      id: "33333333-3333-4333-8333-333333333333",
      ...args.data,
      isEmailVerified: false,
      isActive: true,
      salonId: null,
      staffId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    };
    return createdUser;
  });
  patch(prisma.user as any, "update", async (args: any) => {
    createdUser = {
      ...createdUser,
      ...args.data
    };
    return createdUser;
  });
  patch(prisma.salon as any, "create", async (args: any) => ({
    id: "44444444-4444-4444-8444-444444444444",
    ...args.data,
    status: args.data.status ?? SalonStatus.ACTIVE,
    subscriptionStatus: args.data.subscriptionStatus ?? SubscriptionStatus.TRIAL,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  }));
  patch(prisma.salonSetting as any, "create", async (args: any) => ({ id: "setting-1", ...args.data }));
  patch(prisma.subscription as any, "create", async (args: any) => ({ id: "subscription-1", ...args.data }));
  patch(prisma.businessHour as any, "createMany", async (args: any) => ({ count: args.data.length }));
  patch(prisma.auditLog as any, "create", async (args: any) => ({ id: "audit-1", ...args.data }));
  patch(prisma.refreshToken as any, "create", async (args: any) => ({ id: "refresh-1", ...args.data }));
};

const postJson = async (path: string, acceptLanguage: string, body: Record<string, unknown>) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "accept-language": acceptLanguage,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    body: (await response.json()) as any
  };
};

before(async () => {
  passwordHash = await hashPassword(password);
  setupPrismaMock();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

beforeEach(() => {
  loginUserLanguage = null;
  createdUser = null;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  for (const item of patches.reverse()) {
    item.target[item.key] = item.original;
  }
});

test("login owner with vi-VN returns Vietnamese message and language", async () => {
  const result = await postJson("/api/v1/auth/login-owner", "vi-VN", {
    email: ownerEmail,
    password
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.message, "Đăng nhập chủ salon thành công.");
  assert.equal(result.body.data.user.language, "vi-VN");
});

test("login owner with en-US returns English message and language when DB language is null", async () => {
  const result = await postJson("/api/v1/auth/login-owner", "en-US", {
    email: ownerEmail,
    password
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.message, "Owner login successful.");
  assert.equal(result.body.data.user.language, "en-US");
});

test("login owner uses DB user language before Accept-Language header", async () => {
  loginUserLanguage = "en-US";

  const result = await postJson("/api/v1/auth/login-owner", "vi-VN", {
    email: ownerEmail,
    password
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.message, "Owner login successful.");
  assert.equal(result.body.data.user.language, "en-US");
});

test("register owner stores and returns language from Accept-Language header", async () => {
  const result = await postJson("/api/v1/auth/register-owner", "en-US", {
    fullName: "Register Language",
    email: registerEmail,
    phone: "+17325550123",
    password,
    salon: {
      name: "Language Nails",
      contactEmail: registerEmail,
      contactPhone: "+17325550123",
      timezone: "America/New_York",
      addressLine1: "123 Main St",
      city: "Edison",
      state: "NJ",
      postalCode: "08817",
      country: "US"
    }
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.message, "Salon owner registered successfully.");
  assert.equal(result.body.data.user.language, "en-US");
  assert.equal(createdUser?.language, "en-US");
});
