import { prisma } from "../../db/prisma";
import { AppError } from "../../lib/errors";
import { createSalonAlert } from "../alerts/alerts.service";

const getAppointmentByToken = async (token: string) => {
  const appointment = await prisma.appointment.findFirst({
    where: {
      feedbackToken: token
    },
    include: {
      salon: {
        select: {
          id: true,
          name: true
        }
      },
      customer: true,
      service: true,
      staff: true,
      feedback: true
    }
  });
  if (!appointment) {
    throw new AppError("Feedback link is invalid.", 404, "FEEDBACK_LINK_NOT_FOUND");
  }
  return appointment;
};

export const getFeedbackPageData = async (token: string) => {
  const appointment = await getAppointmentByToken(token);
  return {
    salon: appointment.salon,
    appointment: {
      id: appointment.id,
      startTime: appointment.startTime,
      serviceName: appointment.service.name,
      staffName: appointment.staff.fullName
    },
    customer: {
      firstName: appointment.customer.firstName,
      phone: appointment.customer.phone
    },
    submitted: appointment.feedback !== null
  };
};

export const submitFeedback = async (input: {
  token: string;
  rating: number;
  reason?: string;
}) => {
  const appointment = await getAppointmentByToken(input.token);

  const feedback = await prisma.customerFeedback.upsert({
    where: {
      appointmentId: appointment.id
    },
    update: {
      rating: input.rating,
      reason: input.reason,
      customerPhone: appointment.customer.phone
    },
    create: {
      salonId: appointment.salonId,
      appointmentId: appointment.id,
      customerPhone: appointment.customer.phone,
      rating: input.rating,
      reason: input.reason
    }
  });

  if (input.rating <= 3) {
    await createSalonAlert({
      salonId: appointment.salonId,
      alertType: "POOR_FEEDBACK",
      priority: "URGENT",
      title: "Khach hang danh gia thap",
      message: `Can xu ly gap: khach ${appointment.customer.phone} vua danh gia ${input.rating}/5 sao.`,
      metadata: {
        appointmentId: appointment.id,
        customerPhone: appointment.customer.phone,
        rating: input.rating,
        reason: input.reason
      },
      sendSms: true
    });
  }

  return feedback;
};
