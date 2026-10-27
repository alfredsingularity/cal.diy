"use server";

import { requireUserId } from "@calcom/web/app/cache/requireUserId";
import { revalidatePath } from "next/cache";

export async function revalidateWebhooksList() {
  await requireUserId();
  revalidatePath("/settings/developer/webhooks");
}
