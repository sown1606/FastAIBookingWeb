import { AppointmentSource, AppointmentStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AppError } from "../../lib/errors";
import {
  cancelAppointment,
  createAppointment,
  listAppointments,
  rescheduleAppointment,
  updateAppointment
} from "../appointments/appointments.service";
import { createCustomer, searchCustomers } from "../customers/customers.service";
import { listServices } from "../services/services.service";
import { listStaff } from "../staff/staff.service";

export const assertCallCenterSalonAccess = async (agentUserId: string, salonId: string) => {
  const assignment = await prisma.callCenterSalonAssignment.findUnique({
    where: {
      salonId_agentUserId: {
        salonId,
        agentUserId
      }
    },
    include: {
      salon: true
    }
  });
  if (!assignment) {
    throw new AppError("Salon is not assigned to this call center agent.", 403, "FORBIDDEN");
  }
  return assignment.salon;
};

export const listAssignedSalons = async (agentUserId: string) => {
  const assignments = await prisma.callCenterSalonAssignment.findMany({
    where: {
      agentUserId
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      salon: {
        include: {
          settings: true,
          staff: {
            orderBy: {
              fullName: "asc"
            }
          }
        }
      }
    }
  });

  return assignments.map((assignment) => assignment.salon);
};

export const getAssignedSalonDetail = async (agentUserId: string, salonId: string) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return prisma.salon.findUniqueOrThrow({
    where: {
      id: salonId
    },
    include: {
      settings: true,
      staff: {
        orderBy: {
          fullName: "asc"
        }
      }
    }
  });
};

export const listAssignedSalonStaff = async (agentUserId: string, salonId: string) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return listStaff(salonId, false);
};

export const listAssignedSalonServices = async (agentUserId: string, salonId: string) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return listServices(salonId, false);
};

export const listAssignedSalonCustomers = async (
  agentUserId: string,
  salonId: string,
  input: { q?: string; page: number; limit: number }
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return searchCustomers(salonId, input);
};

export const createAssignedSalonCustomer = async (
  agentUserId: string,
  salonId: string,
  input: {
    firstName: string;
    lastName: string;
    email?: string;
    phone: string;
    notes?: string;
  }
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return createCustomer(salonId, agentUserId, input);
};

export const listAssignedSalonAppointments = async (
  agentUserId: string,
  salonId: string,
  input: {
    page: number;
    limit: number;
    staffId?: string;
    customerId?: string;
    status?: AppointmentStatus;
    dateFrom?: Date;
    dateTo?: Date;
  }
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return listAppointments(salonId, input);
};

export const createAssignedSalonAppointment = async (
  agentUserId: string,
  salonId: string,
  input: {
    customerId: string;
    staffId: string;
    serviceId: string;
    serviceIds?: string[];
    startTime: Date;
    notes?: string;
    status?: AppointmentStatus;
  }
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return createAppointment(salonId, agentUserId, {
    ...input,
    source: AppointmentSource.CALL_CENTER
  });
};

export const updateAssignedSalonAppointment = async (
  agentUserId: string,
  salonId: string,
  appointmentId: string,
  input: {
    customerId?: string;
    staffId?: string;
    serviceId?: string;
    serviceIds?: string[];
    startTime?: Date;
    notes?: string | null;
    status?: AppointmentStatus;
  }
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return updateAppointment(salonId, appointmentId, agentUserId, {
    ...input,
    source: AppointmentSource.CALL_CENTER
  });
};

export const rescheduleAssignedSalonAppointment = async (
  agentUserId: string,
  salonId: string,
  appointmentId: string,
  input: {
    staffId?: string;
    startTime: Date;
  }
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return rescheduleAppointment(salonId, appointmentId, agentUserId, input);
};

export const cancelAssignedSalonAppointment = async (
  agentUserId: string,
  salonId: string,
  appointmentId: string,
  reason?: string
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return cancelAppointment(salonId, appointmentId, agentUserId, reason);
};
