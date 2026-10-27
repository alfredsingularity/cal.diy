"use server";

import { requireUserId } from "@calcom/web/app/cache/requireUserId";
import { revalidatePath } from "next/cache";

export async function revalidateSettingsGeneral() {
  await requireUserId();
  revalidatePath("/settings/my-account/general");
}
