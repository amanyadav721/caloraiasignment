import type {
  Json,
  MealBreakdownItem,
  MealInsert,
  MealRow,
  MealUpdate,
} from "../types/database";
import { assertSupabaseConfigured, isSupabaseConfigured, supabase } from "./supabase";

const MEAL_COLUMNS = "id, user_id, meal_text, created_at, calories, breakdown";

type MealPayload = {
  userId?: string | null;
  mealText?: string | null;
  createdAt?: string | null;
  calories?: number | null;
  breakdown?: MealBreakdownItem[] | null;
};

function normalizeMealPayload(payload: MealPayload): MealInsert {
  return {
    user_id: payload.userId?.trim() ? payload.userId.trim() : null,
    meal_text: payload.mealText?.trim() ? payload.mealText.trim() : null,
    created_at: payload.createdAt ?? null,
    calories: payload.calories ?? null,
    breakdown: payload.breakdown ?? null,
  };
}

function normalizeMealUpdate(payload: MealPayload): MealUpdate {
  return {
    user_id: payload.userId?.trim() ? payload.userId.trim() : null,
    meal_text: payload.mealText?.trim() ? payload.mealText.trim() : null,
    created_at: payload.createdAt ?? null,
    calories: payload.calories ?? null,
    breakdown: payload.breakdown ?? null,
  };
}

export async function fetchMeals(userId?: string) {
  assertSupabaseConfigured();

  let query = supabase
    .from("meals")
    .select(MEAL_COLUMNS)
    .order("created_at", { ascending: false, nullsFirst: false });

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function createMeal(payload: MealPayload) {
  assertSupabaseConfigured();

  const { data, error } = await supabase
    .from("meals")
    .insert(normalizeMealPayload(payload))
    .select(MEAL_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateMeal(id: string, payload: MealPayload) {
  assertSupabaseConfigured();

  const { data, error } = await supabase
    .from("meals")
    .update(normalizeMealUpdate(payload))
    .eq("id", id)
    .select(MEAL_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function deleteMeal(id: string) {
  assertSupabaseConfigured();

  const { error } = await supabase.from("meals").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

export function subscribeToMeals(onChange: () => void) {
  if (!isSupabaseConfigured) {
    return () => undefined;
  }

  const channel = supabase
    .channel("public:meals")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "meals" },
      () => {
        onChange();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function upsertMealInState(meals: MealRow[], nextMeal: MealRow) {
  const existingIndex = meals.findIndex((meal) => meal.id === nextMeal.id);

  if (existingIndex === -1) {
    return [nextMeal, ...meals].sort(compareMealsByCreatedAt);
  }

  const nextMeals = [...meals];
  nextMeals[existingIndex] = nextMeal;
  return nextMeals.sort(compareMealsByCreatedAt);
}

export function parseMealBreakdown(breakdown: Json | null) {
  if (!Array.isArray(breakdown)) {
    return [] as MealBreakdownItem[];
  }

  return breakdown
    .map((item) => {
      if (!isBreakdownRecord(item)) {
        return null;
      }

      const name = toTrimmedString(item.name);

      if (!name) {
        return null;
      }

      return {
        name,
        quantity: toTrimmedString(item.quantity),
        calories: toNumberOrNull(item.calories),
      } satisfies MealBreakdownItem;
    })
    .filter((item): item is MealBreakdownItem => item !== null);
}

export function getMealCalories(meal: MealRow) {
  if (typeof meal.calories === "number") {
    return meal.calories;
  }

  return parseMealBreakdown(meal.breakdown).reduce((total, item) => {
    return total + (item.calories ?? 0);
  }, 0);
}

export function getMealLabel(meal: MealRow) {
  const mealText = meal.meal_text?.trim();

  if (mealText) {
    return mealText;
  }

  const foods = parseMealBreakdown(meal.breakdown).map((item) => item.name);

  if (foods.length > 0) {
    return foods.join(", ");
  }

  return "Logged meal";
}

function compareMealsByCreatedAt(a: MealRow, b: MealRow) {
  const createdAtDifference = getTimeValue(b.created_at) - getTimeValue(a.created_at);

  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return b.id.localeCompare(a.id);
}

function getTimeValue(value: string | null) {
  if (!value) {
    return 0;
  }

  const parsedValue = new Date(value).getTime();

  return Number.isNaN(parsedValue) ? 0 : parsedValue;
}

function isBreakdownRecord(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTrimmedString(value: Json | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}

function toNumberOrNull(value: Json | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
}
