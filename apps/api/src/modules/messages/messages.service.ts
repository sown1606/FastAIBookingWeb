import { Role } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AppError } from "../../lib/errors";

const ensureStaffInSalon = async (salonId: string, staffId: string) => {
  const staff = await prisma.staff.findFirst({
    where: {
      id: staffId,
      salonId
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      }
    }
  });
  if (!staff) {
    throw new AppError("Staff not found.", 404, "STAFF_NOT_FOUND");
  }
  return staff;
};

export const listOwnerStaffThreads = async (salonId: string) => {
  const staff = await prisma.staff.findMany({
    where: {
      salonId
    },
    orderBy: {
      fullName: "asc"
    },
    include: {
      chatMessages: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1,
        include: {
          sender: {
            select: {
              id: true,
              fullName: true,
              role: true
            }
          }
        }
      }
    }
  });

  return staff.map((member) => ({
    staff: member,
    lastMessage: member.chatMessages[0] ?? null
  }));
};

export const listMessagesForStaff = async (salonId: string, staffId: string) => {
  await ensureStaffInSalon(salonId, staffId);
  return prisma.chatMessage.findMany({
    where: {
      salonId,
      staffId
    },
    orderBy: {
      createdAt: "asc"
    },
    include: {
      sender: {
        select: {
          id: true,
          fullName: true,
          role: true
        }
      }
    }
  });
};

export const createMessage = async (input: {
  salonId: string;
  senderUserId: string;
  senderRole: Role;
  staffId: string;
  body: string;
}) => {
  const staff = await ensureStaffInSalon(input.salonId, input.staffId);
  if (input.senderRole === Role.STAFF && staff.user?.id !== input.senderUserId) {
    throw new AppError("Staff can only message from their own thread.", 403, "FORBIDDEN");
  }

  return prisma.chatMessage.create({
    data: {
      salonId: input.salonId,
      staffId: staff.id,
      senderUserId: input.senderUserId,
      body: input.body.trim()
    },
    include: {
      sender: {
        select: {
          id: true,
          fullName: true,
          role: true
        }
      }
    }
  });
};
