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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type MealRow = Database["public"]["Tables"]["meals"]["Row"];
export type MealInsert = Database["public"]["Tables"]["meals"]["Insert"];
export type MealUpdate = Database["public"]["Tables"]["meals"]["Update"];

export type MealBreakdownItem = {
  name: string;
  quantity: string | null;
  calories: number | null;
};
