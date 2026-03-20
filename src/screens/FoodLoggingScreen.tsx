import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  fetchMeals,
  getMealCalories,
  getMealLabel,
  parseMealBreakdown,
  subscribeToMeals,
  updateMeal,
  upsertMealInState,
} from "../lib/meals";
import { isSupabaseConfigured, supabaseConfigError } from "../lib/supabase";
import type { MealBreakdownItem, MealRow } from "../types/database";

const SAMPLE_MEALS: MealRow[] = [
  {
    id: "a5498fc5-fa0f-41de-b767-36953d7186df",
    user_id: "2134910518",
    meal_text: "one banana",
    created_at: "2026-03-20 09:03:03.329057",
    calories: 105,
    breakdown: [
      {
        name: "Banana",
        quantity: "1 medium",
        calories: 105,
      },
    ],
  },
];

const AUTO_SYNC_INTERVAL_MS = 15000;

type TimelineSection = {
  key: string;
  label: string;
  caption: string;
  meals: MealRow[];
  calories: number;
  foods: number;
};

type EditFormState = {
  mealText: string;
  calories: string;
  userId: string;
  breakdownText: string;
};

function getResolvedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  } catch {
    return "Local time";
  }
}

function parseMealDateTime(value: string | null) {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim().replace(" ", "T");
  const match = normalizedValue.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/,
  );

  if (match) {
    const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = "0"] =
      match;

    const milliseconds = Number(fraction.slice(0, 3).padEnd(3, "0"));

    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      milliseconds,
    );
  }

  const fallbackDate = new Date(normalizedValue);
  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
}

function getDayKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatDayLabel(date: Date) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, now)) {
    return "Today";
  }

  if (isSameDay(date, yesterday)) {
    return "Yesterday";
  }

  return date.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatDayCaption(date: Date) {
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimelineTime(value: string | null) {
  const parsedDate = parseMealDateTime(value);

  if (!parsedDate) {
    return "--:--";
  }

  return parsedDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSyncTimestamp(value: string | null) {
  const parsedDate = parseMealDateTime(value);

  if (!parsedDate) {
    return "Waiting for first sync";
  }

  return parsedDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while loading meal data.";
}

function countLoggedFoods(meal: MealRow) {
  const breakdownItems = parseMealBreakdown(meal.breakdown);

  if (breakdownItems.length > 0) {
    return breakdownItems.length;
  }

  return meal.meal_text ? 1 : 0;
}

function formatBreakdownForEditor(meal: MealRow) {
  const breakdownItems = parseMealBreakdown(meal.breakdown);

  return breakdownItems
    .map((item) => {
      return [item.name, item.quantity ?? "", item.calories?.toString() ?? ""].join(" | ");
    })
    .join("\n");
}

function parseBreakdownEditor(input: string) {
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  return lines.map((line) => {
    const [namePart = "", quantityPart = "", caloriesPart = ""] = line
      .split("|")
      .map((part) => part.trim());

    if (!namePart) {
      throw new Error("Each food line needs a name before the first |");
    }

    let calories: number | null = null;

    if (caloriesPart.length > 0) {
      const parsedCalories = Number.parseInt(caloriesPart, 10);

      if (Number.isNaN(parsedCalories)) {
        throw new Error("Use whole numbers for calories in the breakdown editor.");
      }

      calories = parsedCalories;
    }

    return {
      name: namePart,
      quantity: quantityPart || null,
      calories,
    } satisfies MealBreakdownItem;
  });
}

function buildTimelineSections(meals: MealRow[]) {
  const sections: TimelineSection[] = [];

  for (const meal of meals) {
    const parsedDate = parseMealDateTime(meal.created_at);
    const key = parsedDate ? getDayKey(parsedDate) : "unknown-day";
    const existingSection = sections.find((section) => section.key === key);

    if (existingSection) {
      existingSection.meals.push(meal);
      existingSection.calories += getMealCalories(meal);
      existingSection.foods += countLoggedFoods(meal);
      continue;
    }

    sections.push({
      key,
      label: parsedDate ? formatDayLabel(parsedDate) : "Unknown day",
      caption: parsedDate ? formatDayCaption(parsedDate) : "Timestamp unavailable",
      meals: [meal],
      calories: getMealCalories(meal),
      foods: countLoggedFoods(meal),
    });
  }

  return sections;
}

export default function FoodLoggingScreen() {
  const [meals, setMeals] = useState<MealRow[]>([]);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [editingMeal, setEditingMeal] = useState<MealRow | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    mealText: "",
    calories: "",
    userId: "",
    breakdownText: "",
  });
  const isFetchingRef = useRef(false);

  async function loadMeals(mode: "initial" | "refresh" | "sync" = "initial") {
    if (!isSupabaseConfigured || isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;

    if (mode === "initial") {
      setIsLoading(true);
    } else if (mode === "refresh") {
      setIsRefreshing(true);
    }

    try {
      const nextMeals = await fetchMeals();
      setMeals(nextMeals);
      setErrorMessage(null);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      if (mode === "initial") {
        setIsLoading(false);
      } else if (mode === "refresh") {
        setIsRefreshing(false);
      }

      isFetchingRef.current = false;
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    void loadMeals();

    const unsubscribe = subscribeToMeals(() => {
      void loadMeals("sync");
    });

    const intervalId = setInterval(() => {
      void loadMeals("sync");
    }, AUTO_SYNC_INTERVAL_MS);

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void loadMeals("sync");
      }
    });

    return () => {
      unsubscribe();
      clearInterval(intervalId);
      appStateSubscription.remove();
    };
  }, []);

  const isPreviewMode = !isSupabaseConfigured;
  const displayedMeals = isPreviewMode ? SAMPLE_MEALS : meals;
  const totalCalories = displayedMeals.reduce((sum, meal) => sum + getMealCalories(meal), 0);
  const totalFoods = displayedMeals.reduce((sum, meal) => sum + countLoggedFoods(meal), 0);
  const timelineSections = buildTimelineSections(displayedMeals);
  const timeZoneLabel = getResolvedTimeZone();
  const syncStatusLabel = isPreviewMode
    ? "🧪 Preview"
    : errorMessage
      ? "🟠 Needs attention"
      : "🟢 Live";

  function openEditor(meal: MealRow) {
    setEditingMeal(meal);
    setEditForm({
      mealText: meal.meal_text ?? "",
      calories: meal.calories?.toString() ?? "",
      userId: meal.user_id ?? "",
      breakdownText: formatBreakdownForEditor(meal),
    });
  }

  function closeEditor() {
    if (isSaving) {
      return;
    }

    setEditingMeal(null);
  }

  function updateEditField<Key extends keyof EditFormState>(
    key: Key,
    value: EditFormState[Key],
  ) {
    setEditForm((currentForm) => ({
      ...currentForm,
      [key]: value,
    }));
  }

  async function handleSaveEdit() {
    if (!editingMeal) {
      return;
    }

    const mealText = editForm.mealText.trim();
    const userId = editForm.userId.trim();
    const caloriesInput = editForm.calories.trim();
    const parsedCalories =
      caloriesInput.length > 0 ? Number.parseInt(caloriesInput, 10) : null;

    if (caloriesInput.length > 0 && Number.isNaN(parsedCalories)) {
      Alert.alert("Calories must be a number", "Use whole numbers like 420.");
      return;
    }

    let parsedBreakdown: MealBreakdownItem[] | null = null;

    try {
      parsedBreakdown = parseBreakdownEditor(editForm.breakdownText);
    } catch (error) {
      Alert.alert("Breakdown format issue", getErrorMessage(error));
      return;
    }

    if (!mealText && !parsedBreakdown?.length) {
      Alert.alert(
        "Add meal details",
        "Enter a meal description or at least one breakdown line before saving.",
      );
      return;
    }

    setIsSaving(true);

    try {
      const savedMeal = await updateMeal(editingMeal.id, {
        mealText: mealText || null,
        calories: parsedCalories,
        userId: userId || null,
        breakdown: parsedBreakdown,
      });

      setMeals((currentMeals) => upsertMealInState(currentMeals, savedMeal));
      setLastSyncedAt(new Date().toISOString());
      setErrorMessage(null);
      setEditingMeal(null);
    } catch (error) {
      Alert.alert("Could not update meal", getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          isSupabaseConfigured ? (
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                void loadMeals("refresh");
              }}
              tintColor="#fafafa"
            />
          ) : undefined
        }
      >
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>🍽️ Food log</Text>
              <Text style={styles.title}>Minimal daily timeline</Text>
              <Text style={styles.subtitle}>
                Local time in {timeZoneLabel}. New chatbot meals should appear here automatically.
              </Text>
            </View>
            {isSupabaseConfigured ? (
              <Pressable
                onPress={() => {
                  void loadMeals("refresh");
                }}
                style={({ pressed }) => [
                  styles.refreshButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.refreshButtonText}>
                  {isRefreshing ? "🔄" : "↻"}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.metaRow}>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{syncStatusLabel}</Text>
            </View>
            <Text style={styles.metaText}>⏱️ Last sync {formatSyncTimestamp(lastSyncedAt)}</Text>
          </View>

          <View style={styles.statRow}>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>🔥 Calories</Text>
              <Text style={styles.statValue}>{totalCalories}</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>🥗 Foods</Text>
              <Text style={styles.statValue}>{totalFoods}</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>🧾 Entries</Text>
              <Text style={styles.statValue}>{displayedMeals.length}</Text>
            </View>
          </View>
        </View>

        {isPreviewMode ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>🧪 Preview mode</Text>
            <Text style={styles.noticeText}>
              Showing the sample banana meal until Supabase is connected. {supabaseConfigError}
            </Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>⚠️ Sync issue</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.timelineIntro}>
          <Text style={styles.timelineTitle}>🕒 Daily timeline</Text>
          <Text style={styles.timelineSubtitle}>
            Meals are grouped by day and shown in your current timezone for faster scanning.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.placeholderCard}>
            <ActivityIndicator size="large" color="#f59e0b" />
            <Text style={styles.placeholderText}>Loading your food timeline...</Text>
          </View>
        ) : timelineSections.length === 0 ? (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderTitle}>🍽️ Nothing logged yet</Text>
            <Text style={styles.placeholderText}>
              Add meals to `public.meals` and they will appear here in a clean timeline.
            </Text>
          </View>
        ) : (
          timelineSections.map((section) => (
            <View key={section.key} style={styles.daySection}>
              <View style={styles.dayHeader}>
                <View style={styles.dayCopy}>
                  <Text style={styles.dayLabel}>{section.label}</Text>
                  <Text style={styles.dayCaption}>{section.caption}</Text>
                </View>
                <View style={styles.daySummary}>
                  <Text style={styles.daySummaryText}>🔥 {section.calories}</Text>
                  <Text style={styles.daySummaryText}>🥗 {section.foods}</Text>
                </View>
              </View>

              <View style={styles.timelineList}>
                {section.meals.map((meal, index) => {
                  const breakdownItems = parseMealBreakdown(meal.breakdown);
                  const mealCalories = getMealCalories(meal);

                  return (
                    <View key={meal.id} style={styles.timelineRow}>
                      <View style={styles.timeColumn}>
                        <Text style={styles.timeText}>
                          {formatTimelineTime(meal.created_at)}
                        </Text>
                        <Text style={styles.timeSubtext}>local</Text>
                      </View>

                      <View style={styles.railColumn}>
                        <View style={styles.railDot} />
                        {index !== section.meals.length - 1 ? (
                          <View style={styles.railLine} />
                        ) : (
                          <View style={styles.railSpacer} />
                        )}
                      </View>

                      <View style={styles.entryCard}>
                        <View style={styles.entryHeader}>
                          <Text style={styles.entryTitle}>{getMealLabel(meal)}</Text>
                          <View style={styles.entryCaloriePill}>
                            <Text style={styles.entryCalorieText}>🔥 {mealCalories}</Text>
                          </View>
                        </View>

                        {meal.user_id ? (
                          <Text style={styles.entryMeta}>👤 User {meal.user_id}</Text>
                        ) : null}

                        <View style={styles.entryActionRow}>
                          <Pressable
                            onPress={() => openEditor(meal)}
                            style={({ pressed }) => [
                              styles.editButton,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={styles.editButtonText}>✏️ Edit meal</Text>
                          </Pressable>
                        </View>

                        {breakdownItems.length > 0 ? (
                          <View style={styles.foodChipWrap}>
                            {breakdownItems.map((item, chipIndex) => (
                              <View
                                key={`${meal.id}-${item.name}-${chipIndex}`}
                                style={styles.foodChip}
                              >
                                <Text style={styles.foodChipTitle}>{item.name}</Text>
                                <Text style={styles.foodChipMeta}>
                                  {item.quantity ?? "portion"} • {item.calories ?? 0} cal
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.entryFallback}>
                            📝 {meal.meal_text ?? "No detailed breakdown provided."}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal
        animationType="slide"
        transparent
        visible={editingMeal !== null}
        onRequestClose={closeEditor}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalKeyboardWrap}
          >
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderCopy}>
                  <Text style={styles.modalEyebrow}>✏️ Update meal</Text>
                  <Text style={styles.modalTitle}>Edit meal data from the app</Text>
                  <Text style={styles.modalSubtitle}>
                    One food per line: `name | quantity | calories`
                  </Text>
                </View>
                <Pressable
                  onPress={closeEditor}
                  style={({ pressed }) => [
                    styles.modalCloseButton,
                    pressed && styles.buttonPressed,
                  ]}
                  disabled={isSaving}
                >
                  <Text style={styles.modalCloseButtonText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={styles.modalContent}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Meal text</Text>
                  <TextInput
                    value={editForm.mealText}
                    onChangeText={(value) => updateEditField("mealText", value)}
                    placeholder="one banana"
                    placeholderTextColor="#6b7280"
                    style={styles.input}
                  />
                </View>

                <View style={styles.fieldRow}>
                  <View style={styles.fieldHalf}>
                    <Text style={styles.fieldLabel}>Calories</Text>
                    <TextInput
                      value={editForm.calories}
                      onChangeText={(value) => updateEditField("calories", value)}
                      placeholder="105"
                      placeholderTextColor="#6b7280"
                      keyboardType="number-pad"
                      style={styles.input}
                    />
                  </View>

                  <View style={styles.fieldHalf}>
                    <Text style={styles.fieldLabel}>User ID</Text>
                    <TextInput
                      value={editForm.userId}
                      onChangeText={(value) => updateEditField("userId", value)}
                      placeholder="2134910518"
                      placeholderTextColor="#6b7280"
                      autoCapitalize="none"
                      style={styles.input}
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Breakdown</Text>
                  <TextInput
                    value={editForm.breakdownText}
                    onChangeText={(value) => updateEditField("breakdownText", value)}
                    placeholder={"Banana | 1 medium | 105"}
                    placeholderTextColor="#6b7280"
                    multiline
                    textAlignVertical="top"
                    style={styles.textarea}
                  />
                  <Text style={styles.fieldHelp}>
                    Example: `Banana | 1 medium | 105`
                  </Text>
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <Pressable
                  onPress={closeEditor}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    pressed && styles.buttonPressed,
                  ]}
                  disabled={isSaving}
                >
                  <Text style={styles.secondaryActionText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void handleSaveEdit();
                  }}
                  style={({ pressed }) => [
                    styles.primaryAction,
                    (pressed || isSaving) && styles.buttonPressed,
                  ]}
                  disabled={isSaving}
                >
                  <Text style={styles.primaryActionText}>
                    {isSaving ? "Saving..." : "Save changes"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 36,
    gap: 16,
  },
  headerCard: {
    backgroundColor: "#111111",
    borderRadius: 28,
    padding: 18,
    gap: 16,
    borderWidth: 1,
    borderColor: "#202024",
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 6,
  },
  eyebrow: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    color: "#fafafa",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
  },
  subtitle: {
    color: "#a1a1aa",
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 280,
  },
  refreshButton: {
    minWidth: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c20",
    borderWidth: 1,
    borderColor: "#2f2f35",
  },
  refreshButtonText: {
    color: "#fafafa",
    fontSize: 18,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.75,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  statusPill: {
    backgroundColor: "#18181b",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#2f2f35",
  },
  statusPillText: {
    color: "#e4e4e7",
    fontSize: 12,
    fontWeight: "700",
  },
  metaText: {
    color: "#71717a",
    fontSize: 12,
  },
  statRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statChip: {
    flexGrow: 1,
    minWidth: 95,
    backgroundColor: "#17171a",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#242428",
  },
  statLabel: {
    color: "#8f8f99",
    fontSize: 12,
    fontWeight: "600",
  },
  statValue: {
    marginTop: 6,
    color: "#fafafa",
    fontSize: 22,
    fontWeight: "800",
  },
  noticeCard: {
    backgroundColor: "#10213c",
    borderRadius: 22,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: "#1d4ed8",
  },
  noticeTitle: {
    color: "#dbeafe",
    fontSize: 15,
    fontWeight: "800",
  },
  noticeText: {
    color: "#bfdbfe",
    fontSize: 13,
    lineHeight: 20,
  },
  errorCard: {
    backgroundColor: "#3a1010",
    borderRadius: 22,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: "#991b1b",
  },
  errorTitle: {
    color: "#fecaca",
    fontSize: 15,
    fontWeight: "800",
  },
  errorText: {
    color: "#fee2e2",
    fontSize: 13,
    lineHeight: 20,
  },
  timelineIntro: {
    gap: 4,
    paddingHorizontal: 2,
  },
  timelineTitle: {
    color: "#fafafa",
    fontSize: 22,
    fontWeight: "800",
  },
  timelineSubtitle: {
    color: "#8f8f99",
    fontSize: 13,
    lineHeight: 19,
  },
  placeholderCard: {
    backgroundColor: "#111111",
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#202024",
  },
  placeholderTitle: {
    color: "#fafafa",
    fontSize: 18,
    fontWeight: "800",
  },
  placeholderText: {
    color: "#a1a1aa",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  daySection: {
    backgroundColor: "#101012",
    borderRadius: 26,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: "#1f1f24",
  },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  dayCopy: {
    flex: 1,
    gap: 2,
  },
  dayLabel: {
    color: "#fafafa",
    fontSize: 18,
    fontWeight: "800",
  },
  dayCaption: {
    color: "#71717a",
    fontSize: 12,
  },
  daySummary: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  daySummaryText: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "700",
  },
  timelineList: {
    gap: 2,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  timeColumn: {
    width: 62,
    paddingTop: 8,
    alignItems: "flex-end",
  },
  timeText: {
    color: "#f5f5f5",
    fontSize: 13,
    fontWeight: "700",
  },
  timeSubtext: {
    marginTop: 4,
    color: "#5f5f67",
    fontSize: 11,
    textTransform: "uppercase",
  },
  railColumn: {
    width: 16,
    alignItems: "center",
    paddingTop: 10,
  },
  railDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#f59e0b",
  },
  railLine: {
    flex: 1,
    width: 1,
    marginTop: 6,
    backgroundColor: "#27272a",
  },
  railSpacer: {
    flex: 1,
  },
  entryCard: {
    flex: 1,
    backgroundColor: "#16161a",
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: "#222228",
  },
  entryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  entryTitle: {
    flex: 1,
    color: "#fafafa",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  entryCaloriePill: {
    backgroundColor: "#26160a",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#6b3e14",
  },
  entryCalorieText: {
    color: "#fdba74",
    fontSize: 12,
    fontWeight: "800",
  },
  entryMeta: {
    color: "#71717a",
    fontSize: 12,
  },
  entryActionRow: {
    flexDirection: "row",
  },
  editButton: {
    backgroundColor: "#111114",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#2d2d35",
  },
  editButtonText: {
    color: "#e4e4e7",
    fontSize: 12,
    fontWeight: "700",
  },
  foodChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  foodChip: {
    backgroundColor: "#111114",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "#232329",
  },
  foodChipTitle: {
    color: "#f4f4f5",
    fontSize: 13,
    fontWeight: "700",
  },
  foodChipMeta: {
    marginTop: 3,
    color: "#8f8f99",
    fontSize: 12,
  },
  entryFallback: {
    color: "#a1a1aa",
    fontSize: 13,
    lineHeight: 19,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.62)",
    justifyContent: "flex-end",
  },
  modalKeyboardWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalSheet: {
    maxHeight: "88%",
    backgroundColor: "#0f0f12",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 16,
    borderWidth: 1,
    borderColor: "#23232a",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  modalHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  modalEyebrow: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  modalTitle: {
    color: "#fafafa",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
  },
  modalSubtitle: {
    color: "#8f8f99",
    fontSize: 13,
    lineHeight: 19,
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#2d2d35",
  },
  modalCloseButtonText: {
    color: "#fafafa",
    fontSize: 16,
    fontWeight: "700",
  },
  modalContent: {
    gap: 14,
    paddingBottom: 10,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldRow: {
    flexDirection: "row",
    gap: 12,
  },
  fieldHalf: {
    flex: 1,
    gap: 8,
  },
  fieldLabel: {
    color: "#d4d4d8",
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#16161a",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#25252c",
    color: "#fafafa",
    fontSize: 15,
  },
  textarea: {
    minHeight: 140,
    backgroundColor: "#16161a",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#25252c",
    color: "#fafafa",
    fontSize: 15,
  },
  fieldHelp: {
    color: "#71717a",
    fontSize: 12,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  secondaryAction: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#2d2d35",
  },
  secondaryActionText: {
    color: "#e4e4e7",
    fontSize: 15,
    fontWeight: "700",
  },
  primaryAction: {
    flex: 1.2,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#d97706",
  },
  primaryActionText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "800",
  },
});
