"use server";

import { revalidateTag } from "next/cache";
import { getHasTeamPlanCacheTag } from "./membership";
import { requireUserId } from "./requireUserId";
import { getTravelScheduleCacheTag } from "./travelSchedule";

export async function revalidateHasTeamPlan() {
  const userId = await requireUserId();
  revalidateTag(getHasTeamPlanCacheTag(userId), "max");
}

export async function revalidateTravelSchedules() {
  const userId = await requireUserId();
  revalidateTag(getTravelScheduleCacheTag(userId), "max");
}
