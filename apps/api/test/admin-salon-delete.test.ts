import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  AppointmentStatus,
  CallSessionStatus,
  ExternalProvider,
  Role,
  SalonStatus
} from "@prisma/client";
import { prisma } from "../src/db/prisma";
import {
  getSalonDeletePreviewForAdmin,
  permanentlyDeleteSalonForAdmin
} from "../src/modules/admin/admin.service";

type Patch = {
  target: Record<string, unknown>;
  key: string;
  original: unknown;
};

const patches: Patch[] = [];
const salonId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorUserId = "11111111-1111-4111-8111-111111111111";
const ownerUserId = "22222222-2222-4222-8222-222222222222";
const staffUserId = "33333333-3333-4333-8333-333333333333";

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

const setupSalonDeleteMocks = (input: {
  activeCallCount?: number;
  activeAppointmentCount?: number;
  inProgressAppointmentCount?: number;
  ownerRole?: Role;
  unexpectedUserRole?: Role;
} = {}) => {
  const activeAppointmentCount = input.activeAppointmentCount ?? input.inProgressAppointmentCount ?? 0;
  const state = {
    salonDeleted: false,
    salonSuspended: false,
    activeAppointmentsCanceled: 0,
    appointmentStatusHistoryCreated: 0,
    staffReleased: false,
    workSessionsDone: false,
    remindersDeleted: false,
    activeCallSessionsTerminalized: 0,
    openEscalationsClosed: 0,
    callSessionsDeleted: 0,
    auditLogsDeleted: 0,
    refreshTokensDeleted: 0,
    deletedUserIds: [] as string[],
    auditActions: [] as any[],
    counts: {
      owners: 1,
      staffUsers: 1,
      staff: 2,
      services: 3,
      customers: 4,
      appointments: 5,
      callSessions: 6,
      bookingAttempts: 7,
      aiInteractions: 8,
      alerts: 9,
      integrations: 2
    },
    staffUsers: [
      {
        id: staffUserId,
        role: Role.STAFF,
        salonId,
        staffProfile: {
          salonId
        }
      }
    ]
  };

  patch(prisma as any, "$transaction", async (callback: (tx: any) => Promise<unknown>) => callback(prisma));
  patch(prisma.salon as any, "findUnique", async () => {
    if (state.salonDeleted) {
      return null;
    }
    return {
      id: salonId,
      name: "Kiet Nails & Beauty",
      status: SalonStatus.ACTIVE,
      owner: {
        id: ownerUserId,
        role: input.ownerRole ?? Role.SALON_OWNER,
        salonId: null
      }
    };
  });
  patch(prisma.salon as any, "update", async (args: any) => {
    state.salonSuspended = args.data?.status === SalonStatus.SUSPENDED;
    return { id: salonId, status: args.data?.status };
  });
  patch(prisma.user as any, "count", async (args: any) => {
    if (args.where?.role === Role.SALON_OWNER) {
      return state.counts.owners;
    }
    if (args.where?.role === Role.STAFF) {
      return state.counts.staffUsers;
    }
    return 0;
  });
  patch(prisma.staff as any, "count", async () => state.counts.staff);
  patch(prisma.service as any, "count", async () => state.counts.services);
  patch(prisma.customer as any, "count", async () => state.counts.customers);
  patch(prisma.appointment as any, "count", async (args: any) => {
    if (args.where?.status === AppointmentStatus.IN_PROGRESS) {
      return input.inProgressAppointmentCount ?? 0;
    }
    if (args.where?.status?.in) {
      return activeAppointmentCount;
    }
    return state.counts.appointments;
  });
  patch(prisma.callSession as any, "count", async (args: any) => {
    if (args.where?.status === CallSessionStatus.IN_PROGRESS || args.where?.status?.in) {
      return input.activeCallCount ?? 0;
    }
    return state.counts.callSessions;
  });
  patch(prisma.bookingAttempt as any, "count", async () => state.counts.bookingAttempts);
  patch(prisma.aiInteractionLog as any, "count", async () => state.counts.aiInteractions);
  patch(prisma.alert as any, "count", async () => state.counts.alerts);
  patch(prisma.integrationConfig as any, "count", async () => state.counts.integrations);
  patch(prisma.integrationConfig as any, "findMany", async () => [
    { provider: ExternalProvider.AMAZON_CONNECT },
    { provider: ExternalProvider.CALLRAIL }
  ]);
  patch(prisma.salonAiReceptionSetup as any, "findUnique", async () => ({
    provider: ExternalProvider.AMAZON_CONNECT
  }));
  patch(prisma.user as any, "findMany", async (args: any) => {
    if (args.where?.role === Role.STAFF) {
      return state.staffUsers;
    }
    if (args.where?.role?.notIn) {
      return input.unexpectedUserRole ? [{ id: "unexpected-user", role: input.unexpectedUserRole }] : [];
    }
    return [];
  });
  patch(prisma.appointment as any, "findMany", async () =>
    Array.from({ length: activeAppointmentCount }, (_value, index) => ({
      id: `appointment-${index}`,
      staffId: `staff-${index}`,
      status: index === 0 ? AppointmentStatus.IN_PROGRESS : AppointmentStatus.SCHEDULED
    }))
  );
  patch(prisma.appointment as any, "updateMany", async (args: any) => {
    state.activeAppointmentsCanceled = args.where?.id?.in?.length ?? 0;
    return { count: state.activeAppointmentsCanceled };
  });
  patch(prisma.appointmentStatusHistory as any, "createMany", async (args: any) => {
    state.appointmentStatusHistoryCreated = args.data?.length ?? 0;
    return { count: state.appointmentStatusHistoryCreated };
  });
  patch(prisma.staff as any, "updateMany", async () => {
    state.staffReleased = true;
    return { count: activeAppointmentCount };
  });
  patch(prisma.staffWorkSession as any, "updateMany", async () => {
    state.workSessionsDone = true;
    return { count: activeAppointmentCount };
  });
  patch(prisma.staffReminder as any, "deleteMany", async () => {
    state.remindersDeleted = true;
    return { count: activeAppointmentCount };
  });
  patch(prisma.callSession as any, "findMany", async () =>
    Array.from({ length: input.activeCallCount ?? 0 }, (_value, index) => ({
      id: `call-session-${index}`
    }))
  );
  patch(prisma.callEscalation as any, "updateMany", async (args: any) => {
    state.openEscalationsClosed = args.where?.callSessionId?.in?.length ?? 0;
    return { count: state.openEscalationsClosed };
  });
  patch(prisma.callSession as any, "updateMany", async (args: any) => {
    state.activeCallSessionsTerminalized = args.where?.id?.in?.length ?? 0;
    return { count: state.activeCallSessionsTerminalized };
  });
  patch(prisma.callSession as any, "deleteMany", async () => {
    state.callSessionsDeleted = state.counts.callSessions;
    return { count: state.callSessionsDeleted };
  });
  patch(prisma.auditLog as any, "deleteMany", async () => {
    state.auditLogsDeleted = 3;
    return { count: state.auditLogsDeleted };
  });
  patch(prisma.salon as any, "delete", async () => {
    state.salonDeleted = true;
    return { id: salonId };
  });
  patch(prisma.refreshToken as any, "deleteMany", async (args: any) => {
    state.refreshTokensDeleted = args.where?.userId?.in?.length ?? 0;
    return { count: state.refreshTokensDeleted };
  });
  patch(prisma.user as any, "deleteMany", async (args: any) => {
    state.deletedUserIds = args.where?.id?.in ?? [];
    return { count: state.deletedUserIds.length };
  });
  patch(prisma.auditLog as any, "create", async (args: any) => {
    state.auditActions.push(args.data);
    return { id: `audit-${state.auditActions.length}`, ...args.data };
  });

  return state;
};

test("platform admin salon delete preview returns counts and external cleanup warnings", async () => {
  const state = setupSalonDeleteMocks({ activeCallCount: 1 });

  const preview = await getSalonDeletePreviewForAdmin(salonId);

  assert.equal(preview.salonId, salonId);
  assert.equal(preview.salonName, "Kiet Nails & Beauty");
  assert.deepEqual(preview.counts, state.counts);
  assert.equal(preview.activeCallCount, 1);
  assert.equal(preview.inProgressAppointmentCount, 0);
  assert.deepEqual(preview.configuredProviders.sort(), [
    ExternalProvider.AMAZON_CONNECT,
    ExternalProvider.CALLRAIL
  ].sort());
  assert.match(preview.warnings.join(" "), /manual external cleanup/i);
});

test("platform admin salon delete rejects a wrong confirmation name without side effects", async () => {
  const state = setupSalonDeleteMocks();

  await assert.rejects(
    () =>
      permanentlyDeleteSalonForAdmin(salonId, actorUserId, {
        confirmPermanentDelete: true,
        confirmationName: "Wrong Salon"
      }),
    /Salon name confirmation does not match/
  );

  assert.equal(state.salonDeleted, false);
  assert.equal(state.auditActions.length, 0);
});

test("platform admin salon delete terminalizes stale active calls and cancels active appointments", async () => {
  const state = setupSalonDeleteMocks({
    activeCallCount: 2,
    activeAppointmentCount: 3,
    inProgressAppointmentCount: 1
  });

  const result = await permanentlyDeleteSalonForAdmin(salonId, actorUserId, {
    confirmPermanentDelete: true,
    confirmationName: "Kiet Nails & Beauty"
  });

  assert.equal(result.deleted, true);
  assert.equal(state.salonSuspended, true);
  assert.equal(state.activeAppointmentsCanceled, 3);
  assert.equal(state.appointmentStatusHistoryCreated, 3);
  assert.equal(state.staffReleased, true);
  assert.equal(state.workSessionsDone, true);
  assert.equal(state.remindersDeleted, true);
  assert.equal(state.openEscalationsClosed, 2);
  assert.equal(state.activeCallSessionsTerminalized, 2);
  assert.equal(state.salonDeleted, true);
});

test("platform admin salon delete removes salon data, owner/staff logins, and writes global audit", async () => {
  const state = setupSalonDeleteMocks();

  const result = await permanentlyDeleteSalonForAdmin(salonId, actorUserId, {
    confirmPermanentDelete: true,
    confirmationName: "Kiet Nails & Beauty"
  });

  assert.equal(result.deleted, true);
  assert.equal(result.salonId, salonId);
  assert.equal(result.deletedUserCount, 2);
  assert.equal(state.salonDeleted, true);
  assert.equal(state.callSessionsDeleted, state.counts.callSessions);
  assert.equal(state.auditLogsDeleted, 3);
  assert.equal(state.refreshTokensDeleted, 2);
  assert.deepEqual(state.deletedUserIds.sort(), [ownerUserId, staffUserId].sort());
  assert.equal(state.auditActions.at(-1).salonId, null);
  assert.equal(state.auditActions.at(-1).action, "SALON_PERMANENTLY_DELETED");
  assert.equal(state.auditActions.at(-1).entityId, salonId);
  assert.deepEqual(state.auditActions.at(-1).metadata.counts, state.counts);
  assert.match(result.externalCleanupRequired.join(" "), /AMAZON_CONNECT/);
});

test("platform admin salon delete second call returns not found without new side effects", async () => {
  const state = setupSalonDeleteMocks();

  await permanentlyDeleteSalonForAdmin(salonId, actorUserId, {
    confirmPermanentDelete: true,
    confirmationName: "Kiet Nails & Beauty"
  });
  const auditCount = state.auditActions.length;

  await assert.rejects(
    () =>
      permanentlyDeleteSalonForAdmin(salonId, actorUserId, {
        confirmPermanentDelete: true,
        confirmationName: "Kiet Nails & Beauty"
      }),
    /Salon not found/
  );
  assert.equal(state.auditActions.length, auditCount);
});
