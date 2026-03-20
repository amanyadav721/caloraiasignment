import type { EventRow, MealRow, UserRow } from "../types/database";
import { parseUtcTimestamp } from "./datetime";

export type ExperimentGroup = "Control" | "Test" | "Unassigned";
export type OnboardingStageKey = "step_1" | "step_2" | "step_3" | "completed";

export type DailyActivityPoint = {
  key: string;
  label: string;
  count: number;
};

export type GroupDistributionPoint = {
  label: ExperimentGroup;
  count: number;
};

export type FunnelStagePoint = {
  key: OnboardingStageKey;
  label: string;
  count: number;
  dropOff: number;
};

export type VariantCompletionPoint = {
  label: ExperimentGroup;
  totalUsers: number;
  completedUsers: number;
  completionRate: number;
};

export type AnalyticsSnapshot = {
  totalUsers: number;
  completedUsers: number;
  completionRate: number;
  dailyActivity: DailyActivityPoint[];
  groupDistribution: GroupDistributionPoint[];
  funnel: FunnelStagePoint[];
  variantCompletion: VariantCompletionPoint[];
  activeUsers: number;
  avgMealsPerActiveUser: number;
  dataSourceNote: string;
};

const FUNNEL_STAGES: Array<{ key: OnboardingStageKey; label: string; rank: number }> = [
  { key: "step_1", label: "Step 1", rank: 1 },
  { key: "step_2", label: "Step 2", rank: 2 },
  { key: "step_3", label: "Step 3", rank: 3 },
  { key: "completed", label: "Completed", rank: 4 },
];

export function buildAnalyticsSnapshot(users: UserRow[], meals: MealRow[], events: EventRow[]) {
  const dailyActivity = buildDailyActivity(meals);
  const latestEventsByUser = buildLatestEventsByUser(events);
  const totalUsers = users.length;
  const completedUsers = users.filter((user) => getUserOnboardingRank(user, latestEventsByUser) >= 4)
    .length;
  const completionRate = totalUsers === 0 ? 0 : Math.round((completedUsers / totalUsers) * 100);
  const groupDistribution = buildGroupDistribution(users, latestEventsByUser);
  const funnel = buildFunnel(users, latestEventsByUser);
  const variantCompletion = buildVariantCompletion(users, latestEventsByUser);
  const activeUsers = countActiveUsers(meals);
  const avgMealsPerActiveUser =
    activeUsers === 0 ? 0 : roundToSingleDecimal(meals.length / activeUsers);

  return {
    totalUsers,
    completedUsers,
    completionRate,
    dailyActivity,
    groupDistribution,
    funnel,
    variantCompletion,
    activeUsers,
    avgMealsPerActiveUser,
    dataSourceNote: "Analytics is powered by real backend onboarding state, not inferred from events.",
  } satisfies AnalyticsSnapshot;
}

export function countMealsForDate(meals: MealRow[], targetDate: Date) {
  const targetKey = getLocalDayKey(targetDate);

  return meals.filter((meal) => {
    const mealDate = parseUtcTimestamp(meal.created_at);
    return mealDate ? getLocalDayKey(mealDate) === targetKey : false;
  }).length;
}

function buildDailyActivity(meals: MealRow[]) {
  const today = new Date();
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(today.getDate() - (6 - index));
    return date;
  });

  return lastSevenDays.map((date) => {
    return {
      key: getLocalDayKey(date),
      label: date.toLocaleDateString([], { weekday: "short" }),
      count: countMealsForDate(meals, date),
    } satisfies DailyActivityPoint;
  });
}

function buildFunnel(users: UserRow[], latestEventsByUser: LatestEventsByUserMap) {
  return FUNNEL_STAGES.map((stage, index) => {
    const count = users.filter((user) => getUserOnboardingRank(user, latestEventsByUser) >= stage.rank)
      .length;
    const previousCount = index === 0 ? count : users.filter((user) => {
      return getUserOnboardingRank(user, latestEventsByUser) >= FUNNEL_STAGES[index - 1].rank;
    }).length;

    return {
      key: stage.key,
      label: stage.label,
      count,
      dropOff: index === 0 ? 0 : Math.max(previousCount - count, 0),
    } satisfies FunnelStagePoint;
  });
}

function buildGroupDistribution(users: UserRow[], latestEventsByUser: LatestEventsByUserMap) {
  const counts = createEmptyGroupCounts();

  for (const user of users) {
    counts[resolveExperimentGroup(user, latestEventsByUser)] += 1;
  }

  return [
    { label: "Control", count: counts.Control },
    { label: "Test", count: counts.Test },
    { label: "Unassigned", count: counts.Unassigned },
  ] satisfies GroupDistributionPoint[];
}

function buildVariantCompletion(users: UserRow[], latestEventsByUser: LatestEventsByUserMap) {
  const groups: ExperimentGroup[] = ["Control", "Test", "Unassigned"];

  return groups.map((group) => {
    const groupedUsers = users.filter((user) => resolveExperimentGroup(user, latestEventsByUser) === group);
    const completedUsers = groupedUsers.filter((user) => {
      return getUserOnboardingRank(user, latestEventsByUser) >= 4;
    }).length;

    return {
      label: group,
      totalUsers: groupedUsers.length,
      completedUsers,
      completionRate:
        groupedUsers.length === 0 ? 0 : Math.round((completedUsers / groupedUsers.length) * 100),
    } satisfies VariantCompletionPoint;
  });
}

function countActiveUsers(meals: MealRow[]) {
  return new Set(
    meals
      .map((meal) => meal.user_id?.trim())
      .filter((value): value is string => Boolean(value)),
  ).size;
}

type LatestEventsByUserMap = Map<string, Map<string, EventRow>>;

function buildLatestEventsByUser(events: EventRow[]) {
  const latestEvents = new Map<string, Map<string, EventRow>>();

  for (const event of events) {
    const telegramId = event.telegram_id?.trim();
    const eventName = event.event_name?.trim();

    if (!telegramId || !eventName) {
      continue;
    }

    const currentEventMap = latestEvents.get(telegramId) ?? new Map<string, EventRow>();
    const previousEvent = currentEventMap.get(eventName);

    if (!previousEvent || getTimeValue(event.created_at) >= getTimeValue(previousEvent.created_at)) {
      currentEventMap.set(eventName, event);
    }

    latestEvents.set(telegramId, currentEventMap);
  }

  return latestEvents satisfies LatestEventsByUserMap;
}

function resolveExperimentGroup(user: UserRow, latestEventsByUser: LatestEventsByUserMap) {
  const directGroup = normalizeExperimentGroup(user.experiment_group);

  if (directGroup !== "Unassigned") {
    return directGroup;
  }

  const latestExperimentAssignment = getLatestEventValue(
    latestEventsByUser,
    user.telegram_id,
    "experiment_assigned",
  );

  return normalizeExperimentGroup(latestExperimentAssignment);
}

function getUserOnboardingRank(user: UserRow, latestEventsByUser: LatestEventsByUserMap) {
  if (user.onboarding_completed || normalizeOnboardingStep(user.onboarding_step) === "completed") {
    return 4;
  }

  const latestCompletedFlag = getLatestEventValue(
    latestEventsByUser,
    user.telegram_id,
    "onboarding_completed",
  );

  if (latestCompletedFlag?.toLowerCase() === "true") {
    return 4;
  }

  const latestStep =
    normalizeOnboardingStep(user.onboarding_step) ??
    normalizeOnboardingStep(getLatestEventValue(latestEventsByUser, user.telegram_id, "onboarding_step"));

  switch (latestStep) {
    case "completed":
      return 4;
    case "step_3":
      return 3;
    case "step_2":
      return 2;
    case "step_1":
      return 1;
    default:
      return 0;
  }
}

function getLatestEventValue(
  latestEventsByUser: LatestEventsByUserMap,
  telegramId: string | null,
  eventName: string,
) {
  const trimmedTelegramId = telegramId?.trim();

  if (!trimmedTelegramId) {
    return null;
  }

  return latestEventsByUser.get(trimmedTelegramId)?.get(eventName)?.event_value ?? null;
}

function normalizeExperimentGroup(value: string | null | undefined): ExperimentGroup {
  const normalizedValue = value?.trim().toLowerCase();

  if (normalizedValue === "control") {
    return "Control";
  }

  if (normalizedValue === "test") {
    return "Test";
  }

  return "Unassigned";
}

function normalizeOnboardingStep(value: string | null | undefined) {
  const normalizedValue = value?.trim().toLowerCase();

  switch (normalizedValue) {
    case "step_1":
    case "step_2":
    case "step_3":
    case "completed":
      return normalizedValue;
    default:
      return null;
  }
}

function getLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTimeValue(value: string | null) {
  return parseUtcTimestamp(value)?.getTime() ?? 0;
}

function createEmptyGroupCounts() {
  return {
    Control: 0,
    Test: 0,
    Unassigned: 0,
  } satisfies Record<ExperimentGroup, number>;
}

function roundToSingleDecimal(value: number) {
  return Math.round(value * 10) / 10;
}
