import type { MealRow } from "../types/database";
import { parseUtcTimestamp } from "./datetime";

export type ExperimentGroup = "Control" | "Test" | "Unassigned";

export type DailyActivityPoint = {
  key: string;
  label: string;
  count: number;
};

export type GroupDistributionPoint = {
  label: ExperimentGroup;
  count: number;
};

export type AnalyticsSnapshot = {
  dailyActivity: DailyActivityPoint[];
  groupDistribution: GroupDistributionPoint[];
  totalUniqueUsers: number;
  testUsers: number;
  completedTestUsers: number;
  completionRate: number;
};

type UserMealSummary = {
  mealCount: number;
  hasStructuredBreakdown: boolean;
};

export function buildAnalyticsSnapshot(meals: MealRow[]): AnalyticsSnapshot {
  const dailyActivity = buildDailyActivity(meals);
  const userSummaries = buildUserSummaries(meals);
  const groupedUsers = {
    Control: 0,
    Test: 0,
    Unassigned: 0,
  } satisfies Record<ExperimentGroup, number>;

  for (const userId of userSummaries.keys()) {
    groupedUsers[getExperimentGroup(userId)] += 1;
  }

  const testUserSummaries = Array.from(userSummaries.entries()).filter(([userId]) => {
    return getExperimentGroup(userId) === "Test";
  });

  const completedTestUsers = testUserSummaries.filter(([, summary]) => {
    return summary.mealCount >= 2 || summary.hasStructuredBreakdown;
  }).length;

  const testUsers = testUserSummaries.length;

  return {
    dailyActivity,
    groupDistribution: [
      { label: "Control", count: groupedUsers.Control },
      { label: "Test", count: groupedUsers.Test },
      { label: "Unassigned", count: groupedUsers.Unassigned },
    ],
    totalUniqueUsers: userSummaries.size,
    testUsers,
    completedTestUsers,
    completionRate: testUsers === 0 ? 0 : Math.round((completedTestUsers / testUsers) * 100),
  };
}

export function countMealsForDate(meals: MealRow[], targetDate: Date) {
  const targetKey = getLocalDayKey(targetDate);

  return meals.filter((meal) => {
    const mealDate = parseMealDateTime(meal.created_at);
    return mealDate ? getLocalDayKey(mealDate) === targetKey : false;
  }).length;
}

export function getExperimentGroup(userId: string | null | undefined): ExperimentGroup {
  if (!userId?.trim()) {
    return "Unassigned";
  }

  const hashValue = userId.trim().split("").reduce((total, character) => {
    return total + character.charCodeAt(0);
  }, 0);

  return hashValue % 2 === 0 ? "Control" : "Test";
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

function buildUserSummaries(meals: MealRow[]) {
  const summaries = new Map<string, UserMealSummary>();

  for (const meal of meals) {
    const userId = meal.user_id?.trim();

    if (!userId) {
      continue;
    }

    const currentSummary = summaries.get(userId) ?? {
      mealCount: 0,
      hasStructuredBreakdown: false,
    };

    currentSummary.mealCount += 1;
    currentSummary.hasStructuredBreakdown =
      currentSummary.hasStructuredBreakdown || hasStructuredBreakdown(meal.breakdown);

    summaries.set(userId, currentSummary);
  }

  return summaries;
}

function hasStructuredBreakdown(value: MealRow["breakdown"]) {
  return Array.isArray(value) && value.length > 0;
}

function parseMealDateTime(value: string | null) {
  return parseUtcTimestamp(value);
}

function getLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
