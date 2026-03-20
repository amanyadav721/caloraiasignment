import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../types/database";

type ExpoPublicEnv = {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
};

const env = (
  globalThis as typeof globalThis & {
    process?: {
      env?: ExpoPublicEnv;
    };
  }
).process?.env ?? {};

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabaseConfigError =
  "Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in a local .env file, then restart Expo.";

export const supabase = createClient<Database>(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

export function assertSupabaseConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error(supabaseConfigError);
  }
}
