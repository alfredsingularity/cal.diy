import logger from "@calcom/lib/logger";
import type { CredentialPayload } from "@calcom/types/Credential";
import { OAuth2TokenResponseInDbSchema } from "./universalSchema";

export function getTokenObjectFromCredential(credential: Pick<CredentialPayload, "key" | "id">) {
  const parsedTokenResponse = OAuth2TokenResponseInDbSchema.safeParse(credential.key);
  if (!parsedTokenResponse.success) {
    logger.error("GoogleCalendarService-getTokenObjectFromCredential", {
      issueCount: parsedTokenResponse.error.issues.length,
    });
    throw new Error("Could not parse credential.key");
  }

  const tokenResponse = parsedTokenResponse.data;
  if (!tokenResponse) {
    throw new Error(`credential.key is not set for credential ${credential.id}`);
  }

  return tokenResponse;
}
