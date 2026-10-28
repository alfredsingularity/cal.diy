import "server-only";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";

export async function requireUserId(expectedUserId?: number) {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  const userId = session?.user?.id;

  if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0) {
    throw new ErrorWithCode(ErrorCode.Unauthorized, "Unauthorized");
  }

  if (expectedUserId !== undefined && expectedUserId !== userId) {
    throw new ErrorWithCode(ErrorCode.Forbidden, "Forbidden");
  }

  return userId;
}
