import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { getFeedbackPageData, submitFeedback } from "./feedback.service";

const feedbackTokenSchema = z.object({
  token: z.string().min(20).max(160)
});

const submitFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  reason: z.string().trim().max(2000).optional()
});

export const feedbackRouter = Router();

feedbackRouter.get(
  "/:token",
  validate(feedbackTokenSchema, "params"),
  asyncHandler(async (req, res) => {
    const { token } = req.params as z.infer<typeof feedbackTokenSchema>;
    const data = await getFeedbackPageData(token);
    return sendSuccess(res, {
      data
    });
  })
);

feedbackRouter.post(
  "/:token",
  validate(feedbackTokenSchema, "params"),
  validate(submitFeedbackSchema),
  asyncHandler(async (req, res) => {
    const { token } = req.params as z.infer<typeof feedbackTokenSchema>;
    const payload = req.body as z.infer<typeof submitFeedbackSchema>;
    const feedback = await submitFeedback({
      token,
      rating: payload.rating,
      reason: payload.reason
    });
    return sendSuccess(res, {
      message: "Feedback submitted.",
      data: feedback
    });
  })
);
