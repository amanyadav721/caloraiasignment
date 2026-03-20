export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      events: {
        Row: {
          id: string;
          telegram_id: string | null;
          event_name: string | null;
          event_value: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          telegram_id?: string | null;
          event_name?: string | null;
          event_value?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          telegram_id?: string | null;
          event_name?: string | null;
          event_value?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      meals: {
        Row: {
          id: string;
          user_id: string | null;
          meal_text: string | null;
          created_at: string | null;
          calories: number | null;
          breakdown: Json | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          meal_text?: string | null;
          created_at?: string | null;
          calories?: number | null;
          breakdown?: Json | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          meal_text?: string | null;
          created_at?: string | null;
          calories?: number | null;
          breakdown?: Json | null;
        };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          telegram_id: string | null;
          experiment_group: string | null;
          created_at: string | null;
          onboarding_step: string | null;
          onboarding_completed: boolean | null;
        };
        Insert: {
          id?: string;
          telegram_id?: string | null;
          experiment_group?: string | null;
          created_at?: string | null;
          onboarding_step?: string | null;
          onboarding_completed?: boolean | null;
        };
        Update: {
          id?: string;
          telegram_id?: string | null;
          experiment_group?: string | null;
          created_at?: string | null;
          onboarding_step?: string | null;
          onboarding_completed?: boolean | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type EventRow = Database["public"]["Tables"]["events"]["Row"];
export type MealRow = Database["public"]["Tables"]["meals"]["Row"];
export type MealInsert = Database["public"]["Tables"]["meals"]["Insert"];
export type MealUpdate = Database["public"]["Tables"]["meals"]["Update"];
export type UserRow = Database["public"]["Tables"]["users"]["Row"];

export type MealBreakdownItem = {
  name: string;
  quantity: string | null;
  calories: number | null;
};
