"use server";

import { requireUserId } from "@calcom/web/app/cache/requireUserId";
import { revalidateTag } from "next/cache";

export async function revalidateApiKeysList() {
  await requireUserId();
  revalidateTag("viewer.apiKeys.list", "max");
}
