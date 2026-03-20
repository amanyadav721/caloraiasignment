import assert from "node:assert/strict";
import test from "node:test";

import { buildAnalyticsSnapshot } from "../src/lib/analytics";
import type { EventRow, MealRow, UserRow } from "../src/types/database";

test("builds analytics from the current backend user row without double-counting duplicate experiment events", () => {
  const users: UserRow[] = [
    {
      id: "a324fe05-0ded-4bd2-9ac7-c55ca766dde6",
      telegram_id: "2134910518",
      experiment_group: "control",
      created_at: "2026-03-20 12:49:24.218",
      onboarding_step: "step_2",
      onboarding_completed: false,
    },
  ];

  const events: EventRow[] = [
    eventRow("09a77550-9550-46e1-a339-86ada671d894", "2134910518", "experiment_assigned", "control", "2026-03-20 14:11:45.115"),
    eventRow("0a286e8b-3098-4ddf-a40b-916495a82270", "2134910518", "experiment_assigned", "control", "2026-03-20 14:13:39.085"),
    eventRow("47e9be0f-de9f-4898-90f8-83ce68da6a49", "2134910518", "experiment_assigned", "control", "2026-03-20 14:06:07.769"),
    eventRow("58a6d4f5-307d-4550-9bf0-ef1227c51d3f", "2134910518", "experiment_assigned", "control", "2026-03-20 13:38:18.787"),
    eventRow("68e78209-d8b2-4b0a-9bbb-06bc17c71674", "2134910518", "experiment_assigned", "control", "2026-03-20 13:52:43.666"),
    eventRow("6b182902-8d94-4394-bf4f-637adc180031", "2134910518", "experiment_assigned", "control", "2026-03-20 14:16:24.573"),
    eventRow("76f7f3c5-3977-40de-9639-5e646faa961f", "2134910518", "experiment_assigned", "control", "2026-03-20 14:08:03.545"),
    eventRow("a2b8c403-3916-49b6-a854-7e9c4360e181", "2134910518", "experiment_assigned", "control", "2026-03-20 14:21:11.680"),
    eventRow("a4d7252f-a9c0-4b2b-92c5-12b630567a5c", "2134910518", "experiment_assigned", "control", "2026-03-20 13:53:46.126"),
    eventRow("e13be8e6-fcb2-46b0-8b78-c2f90b4aab2e", "2134910518", "experiment_assigned", "control", "2026-03-20 13:42:18.497"),
    eventRow("e35d1377-c655-4df4-b2d0-551ff8d1c4e8", "2134910518", "experiment_assigned", "control", "2026-03-20 13:58:41.338"),
    eventRow("e57819b2-0d68-4738-892a-df652868f102", "2134910518", "experiment_assigned", "control", "2026-03-20 14:11:01.368"),
    eventRow("f9e4fc77-4eb1-4331-9c35-54c4ff8a7f2c", "2134910518", "experiment_assigned", "control", "2026-03-20 13:47:59.135"),
  ];

  const meals: MealRow[] = [
    mealRow("meal-1", "2134910518", "one banana", 105, "2026-03-20 09:03:03.329057"),
    mealRow("meal-2", "2134910518", "protein oats", 320, "2026-03-20 12:30:00.000"),
  ];

  const snapshot = buildAnalyticsSnapshot(users, meals, events);

  assert.equal(snapshot.totalUsers, 1);
  assert.equal(snapshot.completedUsers, 0);
  assert.equal(snapshot.completionRate, 0);
  assert.equal(snapshot.activeUsers, 1);
  assert.equal(snapshot.avgMealsPerActiveUser, 2);
  assert.deepEqual(
    snapshot.funnel.map((stage) => [stage.key, stage.count]),
    [
      ["step_1", 1],
      ["step_2", 1],
      ["step_3", 0],
      ["completed", 0],
    ],
  );
  assert.equal(snapshot.groupDistribution.find((group) => group.label === "Control")?.count, 1);
  assert.equal(snapshot.variantCompletion.find((variant) => variant.label === "Control")?.completionRate, 0);
});

test("uses real backend event fallbacks for experiment assignment and onboarding state when user rows are incomplete", () => {
  const users: UserRow[] = [
    userRow("user-1", "111", "control", "step_1", false, "2026-03-19 10:00:00"),
    userRow("user-2", "222", "control", "completed", true, "2026-03-19 10:05:00"),
    userRow("user-3", "333", null, null, false, "2026-03-19 10:10:00"),
    userRow("user-4", "444", "test", null, false, "2026-03-19 10:15:00"),
  ];

  const events: EventRow[] = [
    eventRow("event-1", "333", "experiment_assigned", "test", "2026-03-19 10:20:00"),
    eventRow("event-2", "333", "onboarding_step", "step_3", "2026-03-19 10:25:00"),
    eventRow("event-3", "444", "onboarding_completed", "true", "2026-03-19 10:30:00"),
  ];

  const meals: MealRow[] = [
    mealRow("meal-a", "111", "toast", 180, "2026-03-20 08:00:00"),
    mealRow("meal-b", "222", "eggs", 200, "2026-03-20 09:00:00"),
    mealRow("meal-c", "222", "salad", 220, "2026-03-20 12:00:00"),
    mealRow("meal-d", "333", "rice", 330, "2026-03-20 13:00:00"),
    mealRow("meal-e", "333", "fruit", 110, "2026-03-20 16:00:00"),
    mealRow("meal-f", "444", "soup", 150, "2026-03-20 18:00:00"),
  ];

  const snapshot = buildAnalyticsSnapshot(users, meals, events);

  assert.equal(snapshot.totalUsers, 4);
  assert.equal(snapshot.completedUsers, 2);
  assert.equal(snapshot.completionRate, 50);
  assert.equal(snapshot.activeUsers, 4);
  assert.equal(snapshot.avgMealsPerActiveUser, 1.5);
  assert.deepEqual(
    snapshot.funnel.map((stage) => [stage.key, stage.count]),
    [
      ["step_1", 4],
      ["step_2", 3],
      ["step_3", 3],
      ["completed", 2],
    ],
  );
  assert.equal(snapshot.groupDistribution.find((group) => group.label === "Control")?.count, 2);
  assert.equal(snapshot.groupDistribution.find((group) => group.label === "Test")?.count, 2);
  assert.equal(snapshot.variantCompletion.find((variant) => variant.label === "Control")?.completionRate, 50);
  assert.equal(snapshot.variantCompletion.find((variant) => variant.label === "Test")?.completionRate, 50);
  assert.equal(
    snapshot.dataSourceNote,
    "Analytics is powered by real backend onboarding state, not inferred from events.",
  );
});

function userRow(
  id: string,
  telegramId: string,
  experimentGroup: string | null,
  onboardingStep: string | null,
  onboardingCompleted: boolean,
  createdAt: string,
) {
  return {
    id,
    telegram_id: telegramId,
    experiment_group: experimentGroup,
    created_at: createdAt,
    onboarding_step: onboardingStep,
    onboarding_completed: onboardingCompleted,
  } satisfies UserRow;
}

function eventRow(
  id: string,
  telegramId: string,
  eventName: string,
  eventValue: string,
  createdAt: string,
) {
  return {
    id,
    telegram_id: telegramId,
    event_name: eventName,
    event_value: eventValue,
    created_at: createdAt,
  } satisfies EventRow;
}

function mealRow(
  id: string,
  userId: string,
  mealText: string,
  calories: number,
  createdAt: string,
) {
  return {
    id,
    user_id: userId,
    meal_text: mealText,
    created_at: createdAt,
    calories,
    breakdown: null,
  } satisfies MealRow;
}
