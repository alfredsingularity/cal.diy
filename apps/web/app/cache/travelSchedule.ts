import "server-only";

import { TravelScheduleRepository } from "@calcom/features/travelSchedule/repositories/TravelScheduleRepository";
import { NEXTJS_CACHE_TTL } from "@calcom/lib/constants";
import { unstable_cache } from "@calcom/lib/unstable_cache";
import { requireUserId } from "./requireUserId";

export const getTravelScheduleCacheTag = (userId: number) =>
  `TravelRepository.findTravelSchedulesByUserId:${userId}`;

export const getTravelSchedule = async (requestedUserId: number) => {
  // Authorization must run on cache hits as well as misses.
  const userId = await requireUserId(requestedUserId);

  return unstable_cache(
    async (id: number) => TravelScheduleRepository.findTravelSchedulesByUserId(id),
    ["getTravelSchedule", getTravelScheduleCacheTag(userId)],
    {
      revalidate: NEXTJS_CACHE_TTL,
      tags: [getTravelScheduleCacheTag(userId)],
    }
  )(userId);
};
