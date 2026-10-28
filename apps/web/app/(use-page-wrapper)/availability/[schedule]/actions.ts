"use server";

import { requireUserId } from "@calcom/web/app/cache/requireUserId";
import { revalidatePath } from "next/cache";

export async function revalidateSchedulePage(scheduleId: number) {
  await requireUserId();
  revalidatePath(`/availability/${scheduleId}`);
}
