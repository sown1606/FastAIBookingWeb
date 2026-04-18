import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { bookingFromText } from "../ai/ai.service";

const isAiReceptionEnabled = (settings: {
  aiReceptionEnabled?: boolean | null;
  aiForwardingEnabled?: boolean | null;
} | null | undefined) => {
  return settings?.aiReceptionEnabled ?? settings?.aiForwardingEnabled ?? false;
};

export const runCallAutomationForSession = async (callSessionId: string) => {
  const callSession = await prisma.callSession.findUnique({
    where: {
      id: callSessionId
    },
    include: {
      salon: {
        include: {
          settings: true
        }
      },
      transcripts: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    }
  });

  if (!callSession?.salonId || !callSession.salon?.settings) {
    return null;
  }

  if (!isAiReceptionEnabled(callSession.salon.settings)) {
    return null;
  }

  const latestTranscript = callSession.transcripts[0];
  if (!latestTranscript?.transcriptText?.trim()) {
    return null;
  }

  const existingSummary = (callSession.aiSummary ?? null) as
    | {
        sourceTranscriptId?: string;
      }
    | null;

  if (existingSummary?.sourceTranscriptId === latestTranscript.id) {
    return null;
  }

  try {
    return await bookingFromText({
      salonId: callSession.salonId,
      text: latestTranscript.transcriptText,
      callSessionId: callSession.id,
      transcriptId: latestTranscript.id,
      createCustomerIfMissing: true
    });
  } catch (error) {
    logger.error(
      {
        callSessionId,
        error
      },
      "Automated AI reception processing failed."
    );
    return null;
  }
};
