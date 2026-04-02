import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { isValidUsPhone } from "../../utils/phone";
import {
  createCustomer,
  getCustomerAppointmentHistory,
  getCustomerDetail,
  searchCustomers
} from "./customers.service";

const usPhoneSchema = z
  .string()
  .min(10)
  .max(25)
  .refine((value) => isValidUsPhone(value), "Phone must be a valid US phone number.");

const createCustomerSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional(),
  phone: usPhoneSchema,
  notes: z.string().max(1000).optional()
});

const listCustomerQuerySchema = z.object({
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

const customerIdSchema = z.object({
  id: z.string().uuid()
});

export const customersRouter = Router();

customersRouter.use(requireRoles(Role.SALON_OWNER));

customersRouter.post(
  "/",
  validate(createCustomerSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createCustomerSchema>;
    const customer = await createCustomer(req.auth!.salonId!, req.auth!.userId, payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Customer created.",
      data: customer
    });
  })
);

customersRouter.get(
  "/",
  validate(listCustomerQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const payload = req.query as unknown as z.infer<typeof listCustomerQuerySchema>;
    const result = await searchCustomers(req.auth!.salonId!, payload);
    return sendSuccess(res, {
      data: result
    });
  })
);

customersRouter.get(
  "/:id",
  validate(customerIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof customerIdSchema>;
    const customer = await getCustomerDetail(req.auth!.salonId!, id);
    return sendSuccess(res, {
      data: customer
    });
  })
);

customersRouter.get(
  "/:id/appointments",
  validate(customerIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof customerIdSchema>;
    const history = await getCustomerAppointmentHistory(req.auth!.salonId!, id);
    return sendSuccess(res, {
      data: history
    });
  })
);
