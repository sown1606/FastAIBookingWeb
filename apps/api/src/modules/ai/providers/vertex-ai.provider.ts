import fs from "fs";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";
import { AppError } from "../../../lib/errors";
import { AIParseInput, AIParseOutput, AIProviderAdapter } from "./ai-provider";

interface ServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
}

const OAUTH_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

const asNonEmpty = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseServiceAccountFromEnv = (): ServiceAccountCredentials | undefined => {
  const clientEmail =
    asNonEmpty(env.VERTEX_CLIENT_EMAIL) ?? asNonEmpty(env.VERTEX_SERVICE_ACCOUNT_EMAIL);
  const privateKeyRaw = asNonEmpty(env.VERTEX_PRIVATE_KEY);
  if (!clientEmail || !privateKeyRaw) {
    return undefined;
  }

  return {
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    privateKeyId: asNonEmpty(env.VERTEX_PRIVATE_KEY_ID)
  };
};

const parseServiceAccountFromFile = (): ServiceAccountCredentials | undefined => {
  const path = asNonEmpty(env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!path || !fs.existsSync(path)) {
    return undefined;
  }

  const content = fs.readFileSync(path, { encoding: "utf-8" });
  const parsed = JSON.parse(content) as {
    client_email?: string;
    private_key?: string;
    private_key_id?: string;
  };

  const clientEmail = asNonEmpty(parsed.client_email);
  const privateKey = asNonEmpty(parsed.private_key);
  if (!clientEmail || !privateKey) {
    return undefined;
  }

  return {
    clientEmail,
    privateKey,
    privateKeyId: asNonEmpty(parsed.private_key_id)
  };
};

export class VertexAIProvider implements AIProviderAdapter {
  private accessTokenCache?: { token: string; expiresAtEpochMs: number };

  private readonly credentials = parseServiceAccountFromFile() ?? parseServiceAccountFromEnv();

  private readonly model = asNonEmpty(env.VERTEX_MODEL) ?? "gemini-1.5-flash-002";

  private readonly location = asNonEmpty(env.VERTEX_LOCATION) ?? "us-central1";

  private readonly projectId = asNonEmpty(env.VERTEX_PROJECT_ID);

  private readonly systemPromptVersion =
    asNonEmpty(env.VERTEX_SYSTEM_PROMPT_VERSION) ?? "v1";

  public isConfigured(): boolean {
    return Boolean(this.projectId && this.credentials?.clientEmail && this.credentials.privateKey);
  }

  public async parse(input: AIParseInput): Promise<AIParseOutput> {
    if (!this.isConfigured()) {
      throw new AppError(
        "Vertex AI is not configured. Set VERTEX_PROJECT_ID and service account credentials.",
        503,
        "VERTEX_AI_NOT_CONFIGURED"
      );
    }

    const accessToken = await this.getAccessToken();
    const endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.model}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: "application/json"
        },
        systemInstruction: {
          role: "system",
          parts: [
            {
              text: `You are the FastAIBooking structured parser (${this.systemPromptVersion}). Return only valid JSON.`
            }
          ]
        }
      })
    });

    const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new AppError("Vertex AI request failed.", 502, "VERTEX_AI_REQUEST_FAILED", raw);
    }

    const responseText = this.extractResponseText(raw);
    if (!responseText) {
      throw new AppError(
        "Vertex AI response did not include text output.",
        502,
        "VERTEX_AI_EMPTY_RESPONSE",
        raw
      );
    }

    return {
      model: this.model,
      responseText,
      rawResponse: raw
    };
  }

  private extractResponseText(raw: Record<string, unknown> | null): string | undefined {
    if (!raw) {
      return undefined;
    }
    const candidates = raw.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates?.length) {
      return undefined;
    }

    for (const candidate of candidates) {
      const content = candidate.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      if (!parts?.length) {
        continue;
      }

      for (const part of parts) {
        const text = typeof part.text === "string" ? part.text.trim() : "";
        if (text.length > 0) {
          return text;
        }
      }
    }

    return undefined;
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.accessTokenCache &&
      this.accessTokenCache.expiresAtEpochMs > Date.now() + 60_000
    ) {
      return this.accessTokenCache.token;
    }

    const credentials = this.credentials;
    if (!credentials) {
      throw new AppError(
        "Missing Vertex AI credentials.",
        503,
        "VERTEX_AI_CREDENTIALS_MISSING"
      );
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: credentials.clientEmail,
        sub: credentials.clientEmail,
        aud: OAUTH_TOKEN_URL,
        iat: nowInSeconds,
        exp: nowInSeconds + 3600,
        scope: OAUTH_SCOPE
      },
      credentials.privateKey,
      {
        algorithm: "RS256",
        keyid: credentials.privateKeyId
      }
    );

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    });

    const tokenResponse = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const tokenPayload = (await tokenResponse.json().catch(() => null)) as
      | {
          access_token?: string;
          expires_in?: number;
          error?: string;
          error_description?: string;
        }
      | null;

    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      throw new AppError("Failed to obtain Google access token.", 502, "VERTEX_AI_AUTH_FAILED", tokenPayload);
    }

    const expiresInSeconds = Number(tokenPayload.expires_in ?? 3600);
    this.accessTokenCache = {
      token: tokenPayload.access_token,
      expiresAtEpochMs: Date.now() + expiresInSeconds * 1000
    };

    return tokenPayload.access_token;
  }
}
