"use server";

import { requireUserId } from "@calcom/web/app/cache/requireUserId";
import { revalidatePath } from "next/cache";

export async function revalidateSettingsProfile() {
  await requireUserId();
  revalidatePath("/settings/my-account/profile");
}

export async function revalidateSettingsCalendars() {
  await requireUserId();
  revalidatePath("/settings/my-account/calendars");
}
