"use server";

import { requireUserId } from "@calcom/web/app/cache/requireUserId";
import { revalidatePath } from "next/cache";

export async function revalidateEventTypesList() {
  await requireUserId();
  revalidatePath("/event-types");
}
