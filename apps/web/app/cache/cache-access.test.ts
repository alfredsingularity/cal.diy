// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateAvailabilityList } from "../(use-page-wrapper)/(main-nav)/availability/actions";
import { revalidateEventTypesList } from "../(use-page-wrapper)/(main-nav)/event-types/actions";
import { revalidateAttributesList } from "../(use-page-wrapper)/(main-nav)/members/actions";
import { revalidateSchedulePage } from "../(use-page-wrapper)/availability/[schedule]/actions";
import { revalidateEventTypeEditPage } from "../(use-page-wrapper)/event-types/[type]/actions";
import { revalidateApiKeysList } from "../(use-page-wrapper)/settings/(settings-layout)/developer/api-keys/actions";
import { revalidateWebhooksList } from "../(use-page-wrapper)/settings/(settings-layout)/developer/webhooks/(with-loader)/actions";
import { revalidateSettingsAppearance } from "../(use-page-wrapper)/settings/(settings-layout)/my-account/appearance/actions";
import { revalidateSettingsGeneral } from "../(use-page-wrapper)/settings/(settings-layout)/my-account/general/actions";
import * as cacheActions from "./actions";
import { getCachedHasTeamPlan, getHasTeamPlanCacheTag } from "./membership";
import { revalidateSettingsCalendars, revalidateSettingsProfile } from "./path/settings/my-account";
import { getTravelSchedule, getTravelScheduleCacheTag } from "./travelSchedule";

const effects = vi.hoisted(() => ({
  session: vi.fn(),
  membership: vi.fn(),
  travel: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cache: new Map<string, { result: Promise<unknown>; tags: string[] }>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: effects.session }));
vi.mock("@calcom/features/membership/repositories/MembershipRepository", () => ({
  MembershipRepository: { hasAnyAcceptedMembershipByUserId: effects.membership },
}));
vi.mock("@calcom/features/travelSchedule/repositories/TravelScheduleRepository", () => ({
  TravelScheduleRepository: { findTravelSchedulesByUserId: effects.travel },
}));
vi.mock("@calcom/lib/constants", () => ({ NEXTJS_CACHE_TTL: 60 }));
vi.mock("next/cache", () => ({
  revalidatePath: effects.revalidatePath,
  revalidateTag: effects.revalidateTag,
  // Model cache hits by key and arguments; request/session work must remain outside it.
  unstable_cache:
    (callback: (...args: unknown[]) => Promise<unknown>, keys: string[], options: { tags: string[] }) =>
    (...args: unknown[]) => {
      const key = JSON.stringify([keys, args]);
      let cached = effects.cache.get(key);
      if (!cached) {
        cached = { result: callback(...args), tags: options.tags };
        effects.cache.set(key, cached);
      }
      return cached.result;
    },
}));

const travelFor = (id: number) => [
  {
    id,
    startDate: new Date("2030-01-01T00:00:00Z"),
    endDate: new Date("2030-01-03T00:00:00Z"),
    timeZone: id === 101 ? "Europe/London" : "America/New_York",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  effects.cache.clear();
  effects.session.mockResolvedValue({ user: { id: 101 } });
  effects.membership.mockImplementation(async (id: number) => id === 101);
  effects.travel.mockImplementation(async (id: number) => travelFor(id));
});

const getters = [
  { name: "membership", get: getCachedHasTeamPlan, repository: effects.membership },
  { name: "travel", get: getTravelSchedule, repository: effects.travel },
];

describe.each(getters)("$name private cache access", ({ get, repository }) => {
  it("refuses anonymous access without querying the repository or cache", async () => {
    effects.session.mockResolvedValue(null);

    await expect(get(101)).rejects.toMatchObject({ code: "unauthorized_error" });
    expect(repository).not.toHaveBeenCalled();
    expect(effects.cache.size).toBe(0);
  });

  it("refuses another user's ID before looking up cached or uncached data", async () => {
    await get(101);
    effects.session.mockResolvedValue({ user: { id: 202 } });

    await expect(get(101)).rejects.toMatchObject({ code: "forbidden_error" });
    await expect(get(303)).rejects.toMatchObject({ code: "forbidden_error" });
    expect(repository).toHaveBeenCalledExactlyOnceWith(101);
  });

  it("rechecks the session when the result is already cached", async () => {
    await get(101);
    effects.session.mockResolvedValue(null);

    await expect(get(101)).rejects.toMatchObject({ code: "unauthorized_error" });
    expect(repository).toHaveBeenCalledExactlyOnceWith(101);
    expect(effects.session).toHaveBeenCalledTimes(2);
  });

  it("fails closed when session verification fails", async () => {
    effects.session.mockRejectedValueOnce(new Error("synthetic session failure"));

    await expect(get(101)).rejects.toThrow("synthetic session failure");
    expect(repository).not.toHaveBeenCalled();
    expect(effects.cache.size).toBe(0);
  });
});

it("preserves authorized settings data and isolates both caches by user", async () => {
  expect(await getCachedHasTeamPlan(101)).toEqual({ hasTeamPlan: true });
  expect(await getTravelSchedule(101)).toEqual(travelFor(101));
  effects.session.mockResolvedValue({ user: { id: 202 } });
  expect(await getCachedHasTeamPlan(202)).toEqual({ hasTeamPlan: false });
  expect(await getTravelSchedule(202)).toEqual(travelFor(202));
  effects.session.mockResolvedValue({ user: { id: 101 } });
  expect(await getCachedHasTeamPlan(101)).toEqual({ hasTeamPlan: true });
  expect(await getTravelSchedule(101)).toEqual(travelFor(101));

  expect(effects.membership.mock.calls).toEqual([[101], [202]]);
  expect(effects.travel.mock.calls).toEqual([[101], [202]]);
  expect(effects.session).toHaveBeenCalledTimes(6);
  expect(Array.from(effects.cache.values(), ({ tags }) => tags)).toEqual([
    [getHasTeamPlanCacheTag(101)],
    [getTravelScheduleCacheTag(101)],
    [getHasTeamPlanCacheTag(202)],
    [getTravelScheduleCacheTag(202)],
  ]);
});

const revalidations = [
  { name: "membership", call: cacheActions.revalidateHasTeamPlan, tag: getHasTeamPlanCacheTag(101) },
  { name: "travel", call: cacheActions.revalidateTravelSchedules, tag: getTravelScheduleCacheTag(101) },
  { name: "availability", call: revalidateAvailabilityList, path: "/availability" },
  { name: "event types", call: revalidateEventTypesList, path: "/event-types" },
  { name: "attributes", call: revalidateAttributesList, tag: "viewer.attributes.list" },
  { name: "schedule", call: () => revalidateSchedulePage(303), path: "/availability/303" },
  { name: "event type", call: () => revalidateEventTypeEditPage(404), path: "/event-types/404" },
  { name: "API keys", call: revalidateApiKeysList, tag: "viewer.apiKeys.list" },
  { name: "webhooks", call: revalidateWebhooksList, path: "/settings/developer/webhooks" },
  { name: "appearance", call: revalidateSettingsAppearance, path: "/settings/my-account/appearance" },
  { name: "general", call: revalidateSettingsGeneral, path: "/settings/my-account/general" },
  { name: "profile", call: revalidateSettingsProfile, path: "/settings/my-account/profile" },
  { name: "calendars", call: revalidateSettingsCalendars, path: "/settings/my-account/calendars" },
];

describe.each(revalidations)("$name revalidation", ({ call, path, tag }) => {
  it.each([
    null,
    {},
    { user: {} },
    { user: { id: 0 } },
    { user: { id: -1 } },
    { user: { id: "101" } },
  ])("refuses invalid session %j without invalidating anything", async (session) => {
    effects.session.mockResolvedValue(session);

    await expect(call()).rejects.toMatchObject({ code: "unauthorized_error" });
    expect(effects.revalidateTag).not.toHaveBeenCalled();
    expect(effects.revalidatePath).not.toHaveBeenCalled();
    expect(effects.membership).not.toHaveBeenCalled();
    expect(effects.travel).not.toHaveBeenCalled();
  });

  it("preserves the authorized settings refresh", async () => {
    await expect(call()).resolves.toBeUndefined();

    if (tag) {
      expect(effects.revalidateTag).toHaveBeenCalledExactlyOnceWith(tag, "max");
      expect(effects.revalidatePath).not.toHaveBeenCalled();
    } else {
      expect(effects.revalidatePath).toHaveBeenCalledExactlyOnceWith(path);
      expect(effects.revalidateTag).not.toHaveBeenCalled();
    }
    expect(effects.membership).not.toHaveBeenCalled();
    expect(effects.travel).not.toHaveBeenCalled();
  });
});

it("limits data cache invalidation to the session owner even with supplied arguments", async () => {
  await getCachedHasTeamPlan(101);
  await getTravelSchedule(101);
  effects.session.mockResolvedValue({ user: { id: 202 } });

  await Reflect.apply(cacheActions.revalidateHasTeamPlan, undefined, [101]);
  await Reflect.apply(cacheActions.revalidateTravelSchedules, undefined, [101]);

  expect(effects.revalidateTag.mock.calls).toEqual([
    [getHasTeamPlanCacheTag(202), "max"],
    [getTravelScheduleCacheTag(202), "max"],
  ]);
  const invalidatedTags = effects.revalidateTag.mock.calls.map(([tag]) => tag);
  for (const { tags } of Array.from(effects.cache.values())) {
    expect(tags.some((tag) => invalidatedTags.includes(tag))).toBe(false);
  }
});

it("exposes only revalidation functions from the client action module", () => {
  expect(Object.keys(cacheActions).sort()).toEqual(["revalidateHasTeamPlan", "revalidateTravelSchedules"]);
});
