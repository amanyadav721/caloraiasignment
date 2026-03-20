import type { EventRow, UserRow } from "../types/database";
import { assertSupabaseConfigured, supabase } from "./supabase";

const USERS_COLUMNS =
  "id, telegram_id, experiment_group, created_at, onboarding_step, onboarding_completed";
const EVENTS_COLUMNS = "id, telegram_id, event_name, event_value, created_at";

export type AnalyticsDataResult = {
  users: UserRow[];
  events: EventRow[];
};

export async function fetchAnalyticsData() {
  assertSupabaseConfigured();

  const [usersResponse, eventsResponse] = await Promise.all([
    supabase.from("users").select(USERS_COLUMNS).order("created_at", {
      ascending: false,
      nullsFirst: false,
    }),
    supabase
      .from("events")
      .select(EVENTS_COLUMNS)
      .in("event_name", ["experiment_assigned", "onboarding_step", "onboarding_completed"])
      .order("created_at", {
        ascending: false,
        nullsFirst: false,
      }),
  ]);

  if (usersResponse.error) {
    throw usersResponse.error;
  }

  if (eventsResponse.error) {
    throw eventsResponse.error;
  }

  return {
    users: usersResponse.data ?? [],
    events: eventsResponse.data ?? [],
  } satisfies AnalyticsDataResult;
}
