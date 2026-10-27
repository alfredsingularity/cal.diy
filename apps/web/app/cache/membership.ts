import "server-only";

import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { NEXTJS_CACHE_TTL } from "@calcom/lib/constants";
import { unstable_cache } from "next/cache";
import { requireUserId } from "./requireUserId";

export const getHasTeamPlanCacheTag = (userId: number) =>
  `MembershipRepository.hasAnyAcceptedMembershipByUserId:${userId}`;

export const getCachedHasTeamPlan = async (requestedUserId: number) => {
  // Authorization must run on cache hits as well as misses.
  const userId = await requireUserId(requestedUserId);

  return unstable_cache(
    async (id: number) => {
      const hasTeamPlan = await MembershipRepository.hasAnyAcceptedMembershipByUserId(id);

      return { hasTeamPlan: !!hasTeamPlan };
    },
    ["getCachedHasTeamPlan", getHasTeamPlanCacheTag(userId)],
    {
      revalidate: NEXTJS_CACHE_TTL,
      tags: [getHasTeamPlanCacheTag(userId)],
    }
  )(userId);
};
