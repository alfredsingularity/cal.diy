// @vitest-environment node

import { GET as cleanupTasks } from "@calcom/features/tasker/api/cleanup";
import { POST as postTasks, GET as processTasks } from "@calcom/features/tasker/api/cron";
import { HttpError } from "@calcom/lib/http-error";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as bookingReminder } from "../bookingReminder/route";
import { GET as subscriptions } from "../calendar-subscriptions/route";
import { GET as cleanupSubscriptions } from "../calendar-subscriptions-cleanup/route";
import { POST as changeTimeZone } from "../changeTimeZone/route";
import { GET as selectedCalendars } from "../selected-calendars/route";
import { POST as syncAppMeta } from "../syncAppMeta/route";
import { POST as webhookTriggers } from "../webhookTriggers/route";

const effects = vi.hoisted(() => ({
  processQueue: vi.fn(),
  cleanupTasks: vi.fn(),
  findCredentials: vi.fn(),
  checkSubscriptions: vi.fn(),
  cleanupCache: vi.fn(),
  taskProcessor: vi.fn(),
  bookingRepository: vi.fn(),
  calendarSyncService: vi.fn(),
  cacheRepository: vi.fn(),
  cacheService: vi.fn(),
  subscriptionService: vi.fn(),
  adapterFactory: vi.fn(),
  selectedCalendarRepository: vi.fn(),
  featureRepository: vi.fn(),
  teamFeatureRepository: vi.fn(),
  userFeatureRepository: vi.fn(),
  findDelegationCredential: vi.fn(),
  googleCalendarService: vi.fn(),
  findBookings: vi.fn(),
  findReminders: vi.fn(),
  createReminder: vi.fn(),
  sendReminderEmail: vi.fn(),
  getEventResponses: vi.fn(),
  getTranslation: vi.fn(),
  findTravelSchedules: vi.fn(),
  deleteTravelSchedule: vi.fn(),
  deleteTravelSchedules: vi.fn(),
  updateTravelSchedule: vi.fn(),
  updateUser: vi.fn(),
  updateSchedules: vi.fn(),
  scheduleRepository: vi.fn(),
  triggerWebhooks: vi.fn(),
  findApps: vi.fn(),
  updateApp: vi.fn(),
  getAppMetadata: vi.fn(),
  shouldEnableApp: vi.fn(),
}));

vi.mock("@calcom/features/tasker/task-processor", () => ({ TaskProcessor: effects.taskProcessor }));
vi.mock("@calcom/features/tasker", () => ({ default: { cleanup: effects.cleanupTasks } }));
vi.mock("@calcom/features/credentials/repositories/CredentialRepository", () => ({
  CredentialRepository: { findAllDelegationByTypeIncludeUserAndTake: effects.findCredentials },
}));
vi.mock("@calcom/features/bookings/repositories/BookingRepository", () => ({
  BookingRepository: effects.bookingRepository,
}));
vi.mock("@calcom/features/calendar-subscription/lib/sync/CalendarSyncService", () => ({
  CalendarSyncService: effects.calendarSyncService,
}));
vi.mock("@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventRepository", () => ({
  CalendarCacheEventRepository: effects.cacheRepository,
}));
vi.mock("@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventService", () => ({
  CalendarCacheEventService: effects.cacheService,
}));
vi.mock("@calcom/features/calendar-subscription/lib/CalendarSubscriptionService", () => ({
  CalendarSubscriptionService: effects.subscriptionService,
}));
vi.mock("@calcom/features/calendar-subscription/adapters/AdaptersFactory", () => ({
  DefaultAdapterFactory: effects.adapterFactory,
}));
vi.mock("@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository", () => ({
  SelectedCalendarRepository: effects.selectedCalendarRepository,
}));
vi.mock("@calcom/features/di/containers/FeatureRepository", () => ({
  getFeatureRepository: effects.featureRepository,
}));
vi.mock("@calcom/features/di/containers/TeamFeatureRepository", () => ({
  getTeamFeatureRepository: effects.teamFeatureRepository,
}));
vi.mock("@calcom/features/di/containers/UserFeatureRepository", () => ({
  getUserFeatureRepository: effects.userFeatureRepository,
}));
vi.mock("@calcom/app-store/delegationCredential", () => ({
  findUniqueDelegationCalendarCredential: effects.findDelegationCredential,
}));
vi.mock("@calcom/app-store/googlecalendar/lib/CalendarService", () => ({
  createGoogleCalendarServiceWithGoogleType: effects.googleCalendarService,
}));
vi.mock("@calcom/prisma", () => {
  const prisma = {
    booking: { findMany: effects.findBookings },
    reminderMail: { findMany: effects.findReminders, create: effects.createReminder },
    travelSchedule: {
      findMany: effects.findTravelSchedules,
      delete: effects.deleteTravelSchedule,
      deleteMany: effects.deleteTravelSchedules,
      update: effects.updateTravelSchedule,
    },
    user: { update: effects.updateUser },
    schedule: { updateMany: effects.updateSchedules },
    app: { findMany: effects.findApps, update: effects.updateApp },
  };
  return { prisma, default: prisma, bookingMinimalSelect: {} };
});
vi.mock("@calcom/emails/email-manager", () => ({
  sendOrganizerRequestReminderEmail: effects.sendReminderEmail,
}));
vi.mock("@calcom/features/bookings/lib/getCalEventResponses", () => ({
  getCalEventResponses: effects.getEventResponses,
}));
vi.mock("@calcom/i18n/server", () => ({ getTranslation: effects.getTranslation }));
vi.mock("@calcom/features/schedules/repositories/ScheduleRepository", () => ({
  ScheduleRepository: effects.scheduleRepository,
}));
vi.mock("@calcom/features/webhooks/lib/handleWebhookScheduledTriggers", () => ({
  handleWebhookScheduledTriggers: effects.triggerWebhooks,
}));
vi.mock("@calcom/app-store/_appRegistry", () => ({ getAppWithMetadata: effects.getAppMetadata }));
vi.mock("@calcom/app-store/_utils/validateAppKeys", () => ({ shouldEnableApp: effects.shouldEnableApp }));
vi.mock("@calcom/lib/logger", () => ({
  default: { getSubLogger: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("@calcom/lib/server/perfObserver", () => ({
  performance: { mark: vi.fn(), measure: vi.fn() },
}));
vi.mock("@calcom/lib/server/getServerErrorFromUnknown", () => ({
  getServerErrorFromUnknown: (error: unknown) => {
    if (error instanceof HttpError) return error;
    throw error;
  },
}));

const routes = [
  { name: "tasker GET", method: "GET", handler: processTasks, status: 401, effect: effects.processQueue },
  { name: "tasker POST", method: "POST", handler: postTasks, status: 401, effect: effects.processQueue },
  { name: "tasker cleanup", method: "GET", handler: cleanupTasks, status: 401, effect: effects.cleanupTasks },
  {
    name: "selected-calendars",
    method: "GET",
    handler: selectedCalendars,
    status: 401,
    effect: effects.findCredentials,
    acceptsApiKey: true,
  },
  {
    name: "calendar-subscriptions",
    method: "GET",
    handler: subscriptions,
    status: 403,
    effect: effects.checkSubscriptions,
    acceptsApiKey: true,
  },
  {
    name: "calendar-subscriptions-cleanup",
    method: "GET",
    handler: cleanupSubscriptions,
    status: 403,
    effect: effects.cleanupCache,
    acceptsApiKey: true,
  },
  {
    name: "bookingReminder",
    method: "POST",
    handler: bookingReminder,
    status: 401,
    effect: effects.findBookings,
    calls: 3,
    acceptsApiKey: true,
    acceptsBearer: false,
  },
  {
    name: "changeTimeZone",
    method: "POST",
    handler: changeTimeZone,
    status: 401,
    effect: effects.findTravelSchedules,
    calls: 2,
    acceptsApiKey: true,
    acceptsBearer: false,
  },
  {
    name: "webhookTriggers",
    method: "POST",
    handler: webhookTriggers,
    status: 401,
    effect: effects.triggerWebhooks,
    acceptsApiKey: true,
    acceptsBearer: false,
  },
  {
    name: "syncAppMeta",
    method: "POST",
    handler: syncAppMeta,
    status: 401,
    effect: effects.findApps,
    acceptsApiKey: true,
    acceptsBearer: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", undefined);
  vi.stubEnv("CRON_API_KEY", undefined);
  effects.findCredentials.mockResolvedValue([]);
  effects.findBookings.mockResolvedValue([]);
  effects.findReminders.mockResolvedValue([]);
  effects.findTravelSchedules.mockResolvedValue([]);
  effects.findApps.mockResolvedValue([]);
  effects.taskProcessor.mockImplementation(function () {
    return { processQueue: effects.processQueue };
  });
  effects.cacheService.mockImplementation(function () {
    return { cleanupStaleCache: effects.cleanupCache };
  });
  effects.subscriptionService.mockImplementation(function () {
    return {
      isCacheEnabled: async () => true,
      isSyncEnabled: async () => true,
      checkForNewSubscriptions: effects.checkSubscriptions,
    };
  });
});

afterEach(() => vi.unstubAllEnvs());

describe.each(routes)("$name authentication", ({
  handler,
  method,
  status,
  effect,
  calls = 1,
  acceptsApiKey,
  acceptsBearer = true,
}) => {
  const call = (authorization?: string, apiKey?: string) => {
    const url = new URL("http://localhost/api/cron/test");
    if (apiKey !== undefined) url.searchParams.set("apiKey", apiKey);
    const request = new NextRequest(url, { method });
    if (authorization !== undefined) request.headers.set("authorization", authorization);
    return handler(request, { params: Promise.resolve({}) });
  };

  it.each([
    { secret: undefined, key: undefined, auth: undefined },
    { secret: undefined, key: undefined, auth: "" },
    { secret: undefined, key: undefined, auth: "undefined" },
    { secret: undefined, key: undefined, auth: "null" },
    { secret: undefined, key: undefined, auth: "Bearer undefined" },
    { secret: undefined, key: undefined, auth: "Bearer null" },
    { secret: "", key: "", auth: undefined },
    { secret: "", key: "", auth: "" },
    { secret: "", key: "", auth: "Bearer " },
    { secret: " ", key: " ", auth: " " },
    { secret: " ", key: " ", auth: "Bearer  " },
    { secret: "\t", key: "\t", auth: "\t" },
    { secret: "\t", key: "\t", auth: "Bearer \t" },
    { secret: undefined, key: "synthetic-key", auth: "Bearer undefined" },
    { secret: "", key: "synthetic-key", auth: "Bearer " },
    { secret: "synthetic-secret", key: undefined, auth: "undefined" },
    { secret: "synthetic-secret", key: "synthetic-key", auth: undefined },
    { secret: "synthetic-secret", key: "synthetic-key", auth: "wrong-key" },
    { secret: "synthetic-secret", key: "synthetic-key", auth: "Bearer wrong-secret" },
  ])("rejects invalid auth without invoking work: %j", async ({ secret, key, auth }) => {
    vi.stubEnv("CRON_SECRET", secret);
    vi.stubEnv("CRON_API_KEY", key);

    expect((await call(auth)).status).toBe(status);
    for (const dependency of Object.values(effects)) expect(dependency).not.toHaveBeenCalled();
  });

  it("preserves bearer authentication support without an API key", async () => {
    vi.stubEnv("CRON_SECRET", "synthetic-secret");

    expect((await call("Bearer synthetic-secret")).status).toBe(acceptsBearer ? 200 : status);
    expect(effect).toHaveBeenCalledTimes(acceptsBearer ? calls : 0);
  });

  it.each(["header", "query"])("preserves API key support via %s", async (location) => {
    vi.stubEnv("CRON_API_KEY", "synthetic-key");
    const response = await call(
      location === "header" ? "synthetic-key" : undefined,
      location === "query" ? "synthetic-key" : undefined
    );

    expect(response.status).toBe(acceptsApiKey ? 200 : status);
    expect(effect).toHaveBeenCalledTimes(acceptsApiKey ? calls : 0);
  });

  if (acceptsApiKey) {
    it.each([
      "",
      " ",
      "\t",
      " \n\t",
    ])("rejects an empty/whitespace-only raw key in the query: %j", async (key) => {
      vi.stubEnv("CRON_API_KEY", key);

      expect((await call(undefined, key)).status).toBe(status);
      for (const dependency of Object.values(effects)) expect(dependency).not.toHaveBeenCalled();
    });

    it.each([
      "",
      " ",
      "\t",
      " \n\t",
    ])("rejects an empty/whitespace-only bearer secret in the query: %j", async (secret) => {
      vi.stubEnv("CRON_SECRET", secret);

      expect((await call(undefined, `Bearer ${secret}`)).status).toBe(status);
      for (const dependency of Object.values(effects)) expect(dependency).not.toHaveBeenCalled();
    });

    it("preserves exact comparison for a nonempty configured API key", async () => {
      vi.stubEnv("CRON_API_KEY", " synthetic-key ");

      expect((await call(undefined, "synthetic-key")).status).toBe(status);
      for (const dependency of Object.values(effects)) expect(dependency).not.toHaveBeenCalled();
      expect((await call(undefined, " synthetic-key ")).status).toBe(200);
      expect(effect).toHaveBeenCalledTimes(calls);
    });

    it.each([
      "Bearer undefined",
      "undefined",
      "null",
      "Bearer ",
      "",
    ])("rejects an unconfigured query credential: %j", async (apiKey) => {
      expect((await call(undefined, apiKey)).status).toBe(status);
      for (const dependency of Object.values(effects)) expect(dependency).not.toHaveBeenCalled();
    });

    it("preserves configured bearer support in the query", async () => {
      vi.stubEnv("CRON_SECRET", "synthetic-secret");

      expect((await call(undefined, "Bearer synthetic-secret")).status).toBe(acceptsBearer ? 200 : status);
      expect(effect).toHaveBeenCalledTimes(acceptsBearer ? calls : 0);
    });

    it("does not fall back from a wrong header to a valid query key", async () => {
      vi.stubEnv("CRON_API_KEY", "synthetic-key");

      expect((await call("wrong-header", "synthetic-key")).status).toBe(status);
      for (const dependency of Object.values(effects)) expect(dependency).not.toHaveBeenCalled();
    });
  }
});
