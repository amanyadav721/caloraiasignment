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

import { buildAnalyticsSnapshot } from "../lib/analytics";
import { parseUtcTimestamp } from "../lib/datetime";
import {
  createMeal,
  deleteMeal,
  fetchMeals,
  getMealCalories,
  getMealLabel,
  parseMealBreakdown,
  subscribeToMeals,
  updateMeal,
  upsertMealInState,
} from "../lib/meals";
import {
  calculateOpenFoodFactsCalories,
  fetchOpenFoodFactsProduct,
  getCachedOpenFoodFactsMatches,
  getDefaultOpenFoodFactsQuantity,
  getOpenFoodFactsMeta,
  searchOpenFoodFactsProducts,
  supportsServingMode,
  type OpenFoodFactsProduct,
  type OpenFoodFactsQuantityMode,
} from "../lib/openFoodFacts";
import {
  syncDailyMealNotifications,
  type NotificationSyncResult,
} from "../lib/notifications";
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

type ViewMode = "timeline" | "analytics";
type EditorMode = "create" | "edit";

type OpenFoodFactsComposerState = {
  results: OpenFoodFactsProduct[];
  selectedProduct: OpenFoodFactsProduct | null;
  quantityValue: string;
  quantityMode: OpenFoodFactsQuantityMode;
  error: string | null;
  isSearching: boolean;
  isLoadingSelection: boolean;
};

const EMPTY_EDIT_FORM: EditFormState = {
  mealText: "",
  calories: "",
  userId: "",
  breakdownText: "",
};

const DEFAULT_NOTIFICATION_STATE: NotificationSyncResult = {
  enabled: false,
  supported: Platform.OS !== "web",
  message:
    Platform.OS === "web"
      ? "Notifications are only available on iOS and Android."
      : "Enable notifications to send the daily reminder and summary.",
};

const EMPTY_OPEN_FOOD_FACTS_STATE: OpenFoodFactsComposerState = {
  results: [],
  selectedProduct: null,
  quantityValue: "1",
  quantityMode: "grams",
  error: null,
  isSearching: false,
  isLoadingSelection: false,
};

function getResolvedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  } catch {
    return "Local time";
  }
}

function parseMealDateTime(value: string | null) {
  return parseUtcTimestamp(value);
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

function buildInitialForm(meal?: MealRow | null, recentMeals: MealRow[] = []) {
  if (!meal) {
    return {
      ...EMPTY_EDIT_FORM,
      userId: recentMeals.find((entry) => entry.user_id?.trim())?.user_id ?? "",
    };
  }

  return {
    mealText: meal.meal_text ?? "",
    calories: meal.calories?.toString() ?? "",
    userId: meal.user_id ?? "",
    breakdownText: formatBreakdownForEditor(meal),
  };
}

export default function FoodLoggingScreen() {
  const [meals, setMeals] = useState<MealRow[]>([]);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [editingMeal, setEditingMeal] = useState<MealRow | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>(EMPTY_EDIT_FORM);
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [isEditorVisible, setIsEditorVisible] = useState(false);
  const [openFoodFacts, setOpenFoodFacts] =
    useState<OpenFoodFactsComposerState>(EMPTY_OPEN_FOOD_FACTS_STATE);
  const [notificationState, setNotificationState] =
    useState<NotificationSyncResult>(DEFAULT_NOTIFICATION_STATE);
  const [isConfiguringNotifications, setIsConfiguringNotifications] = useState(false);
  const isFetchingRef = useRef(false);
  const openFoodFactsSearchRequestIdRef = useRef(0);

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

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setNotificationState({
        enabled: false,
        supported: Platform.OS !== "web",
        message: "Connect Supabase to enable nightly reminder and summary notifications.",
      });
      return;
    }

    let isCancelled = false;

    void syncDailyMealNotifications(meals)
      .then((nextState) => {
        if (!isCancelled) {
          setNotificationState(nextState);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setNotificationState({
            enabled: false,
            supported: Platform.OS !== "web",
            message: "Could not refresh the notification schedule yet.",
          });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [meals]);

  useEffect(() => {
    if (editorMode !== "create" || !openFoodFacts.selectedProduct) {
      return;
    }

    const product = openFoodFacts.selectedProduct;
    const nextCalculation = calculateOpenFoodFactsCalories(
      product,
      openFoodFacts.quantityValue,
      openFoodFacts.quantityMode,
    );

    if (!nextCalculation) {
      setEditForm((currentForm) => ({
        ...currentForm,
        mealText: product.name,
        calories: "",
        breakdownText: "",
      }));
      return;
    }

    setEditForm((currentForm) => ({
      ...currentForm,
      mealText: product.name,
      calories: `${nextCalculation.calories}`,
      breakdownText: [product.name, nextCalculation.quantityLabel, `${nextCalculation.calories}`].join(
        " | ",
      ),
    }));
  }, [
    editorMode,
    openFoodFacts.quantityMode,
    openFoodFacts.quantityValue,
    openFoodFacts.selectedProduct,
  ]);

  const isPreviewMode = !isSupabaseConfigured;
  const displayedMeals = isPreviewMode ? SAMPLE_MEALS : meals;
  const totalCalories = displayedMeals.reduce((sum, meal) => sum + getMealCalories(meal), 0);
  const totalFoods = displayedMeals.reduce((sum, meal) => sum + countLoggedFoods(meal), 0);
  const timelineSections = buildTimelineSections(displayedMeals);
  const analytics = buildAnalyticsSnapshot(displayedMeals);
  const timeZoneLabel = getResolvedTimeZone();
  const syncStatusLabel = isPreviewMode
    ? "Preview"
    : errorMessage
      ? "Needs attention"
      : "Live";
  const isBusy = isSaving || isDeleting;
  const selectedFoodCalculation =
    editorMode === "create" && openFoodFacts.selectedProduct
      ? calculateOpenFoodFactsCalories(
          openFoodFacts.selectedProduct,
          openFoodFacts.quantityValue,
          openFoodFacts.quantityMode,
        )
      : null;
  const maxActivityCount = Math.max(1, ...analytics.dailyActivity.map((day) => day.count));
  const maxGroupCount = Math.max(1, ...analytics.groupDistribution.map((group) => group.count));

  function resetOpenFoodFactsComposer() {
    setOpenFoodFacts(EMPTY_OPEN_FOOD_FACTS_STATE);
  }

  function openCreateComposer() {
    setEditorMode("create");
    setEditingMeal(null);
    setEditForm(buildInitialForm(null, meals));
    resetOpenFoodFactsComposer();
    setIsEditorVisible(true);
  }

  function openEditor(meal: MealRow) {
    setEditorMode("edit");
    setEditingMeal(meal);
    setEditForm(buildInitialForm(meal));
    resetOpenFoodFactsComposer();
    setIsEditorVisible(true);
  }

  function closeEditor() {
    if (isBusy) {
      return;
    }

    resetEditor();
  }

  function resetEditor() {
    setIsEditorVisible(false);
    setEditingMeal(null);
    setEditForm(EMPTY_EDIT_FORM);
    resetOpenFoodFactsComposer();
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

  function handleMealTextChange(value: string) {
    if (editorMode === "create" && openFoodFacts.selectedProduct) {
      setOpenFoodFacts((currentState) => ({
        ...currentState,
        selectedProduct: null,
        quantityValue: "1",
        quantityMode: "grams",
        results: [],
        error: null,
        isLoadingSelection: false,
      }));

      setEditForm((currentForm) => ({
        ...currentForm,
        mealText: value,
        calories: "",
        breakdownText: "",
      }));

      return;
    }

    updateEditField("mealText", value);
  }

  function applyOpenFoodFactsSelection(product: OpenFoodFactsProduct) {
    setOpenFoodFacts((currentState) => ({
      ...currentState,
      selectedProduct: null,
      quantityMode: "grams",
      quantityValue: "1",
      results: [],
      error: null,
      isLoadingSelection: true,
    }));

    setEditForm((currentForm) => ({
      ...currentForm,
      mealText: product.name,
      calories: "",
      breakdownText: "",
    }));

    void fetchOpenFoodFactsProduct(product.code)
      .then((fullProduct) => {
        const defaultQuantity = getDefaultOpenFoodFactsQuantity(fullProduct);

        setOpenFoodFacts((currentState) => ({
          ...currentState,
          selectedProduct: fullProduct,
          quantityMode: defaultQuantity.mode,
          quantityValue: defaultQuantity.value,
          error: null,
          isLoadingSelection: false,
        }));
      })
      .catch((error) => {
        setOpenFoodFacts((currentState) => ({
          ...currentState,
          selectedProduct: null,
          error: getErrorMessage(error),
          isLoadingSelection: false,
        }));
      });
  }

  async function handleOpenFoodFactsSearch() {
    const query = editForm.mealText.trim();

    if (query.length < 2) {
      Alert.alert("Search term too short", "Type at least 2 letters before searching.");
      return;
    }

    const requestId = openFoodFactsSearchRequestIdRef.current + 1;
    openFoodFactsSearchRequestIdRef.current = requestId;
    const cachedMatches = getCachedOpenFoodFactsMatches(query);

    setOpenFoodFacts((currentState) => ({
      ...currentState,
      isSearching: true,
      error: null,
      results: cachedMatches,
    }));

    try {
      const results = await searchOpenFoodFactsProducts(query);

      if (openFoodFactsSearchRequestIdRef.current !== requestId) {
        return;
      }

      setOpenFoodFacts((currentState) => ({
        ...currentState,
        isSearching: false,
        results,
        error:
          results.length === 0 ? "No Open Food Facts matches were found for that search." : null,
      }));
    } catch (error) {
      if (openFoodFactsSearchRequestIdRef.current !== requestId) {
        return;
      }

      setOpenFoodFacts((currentState) => ({
        ...currentState,
        isSearching: false,
        results: currentState.results.length > 0 ? currentState.results : cachedMatches,
        error: getErrorMessage(error),
      }));
    }
  }

  function clearOpenFoodFactsSelection() {
    setOpenFoodFacts((currentState) => ({
      ...currentState,
      selectedProduct: null,
      quantityValue: "1",
      quantityMode: "grams",
      results: [],
      error: null,
      isLoadingSelection: false,
    }));

    setEditForm((currentForm) => ({
      ...currentForm,
      calories: "",
      breakdownText: "",
    }));
  }

  async function handleSaveMeal() {
    const mealText = editForm.mealText.trim();
    const userId = editForm.userId.trim();
    const caloriesInput = editForm.calories.trim();
    const parsedCalories =
      caloriesInput.length > 0 ? Number.parseInt(caloriesInput, 10) : null;

    if (editorMode === "create" && openFoodFacts.selectedProduct && !selectedFoodCalculation) {
      Alert.alert(
        "Quantity needed",
        "Enter a valid quantity so calories can be calculated from Open Food Facts.",
      );
      return;
    }

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
      const savedMeal =
        editorMode === "create"
          ? await createMeal({
              mealText: mealText || null,
              calories: parsedCalories,
              userId: userId || null,
              breakdown: parsedBreakdown,
            })
          : await updateMeal(editingMeal?.id ?? "", {
              mealText: mealText || null,
              calories: parsedCalories,
              userId: userId || null,
              breakdown: parsedBreakdown,
            });

      setMeals((currentMeals) => upsertMealInState(currentMeals, savedMeal));
      setLastSyncedAt(new Date().toISOString());
      setErrorMessage(null);
      resetEditor();
    } catch (error) {
      Alert.alert(
        editorMode === "create" ? "Could not create meal" : "Could not update meal",
        getErrorMessage(error),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmDeleteMeal(meal: MealRow) {
    setIsDeleting(true);

    try {
      await deleteMeal(meal.id);
      setMeals((currentMeals) => currentMeals.filter((entry) => entry.id !== meal.id));
      setLastSyncedAt(new Date().toISOString());
      setErrorMessage(null);
      resetEditor();
    } catch (error) {
      Alert.alert("Could not delete meal", getErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  }

  function promptDeleteMeal(meal: MealRow) {
    Alert.alert(
      "Delete this meal?",
      "This removes the meal from the shared backend so the chatbot and app stay aligned.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void confirmDeleteMeal(meal);
          },
        },
      ],
    );
  }

  async function handleEnableNotifications() {
    setIsConfiguringNotifications(true);

    try {
      const nextState = await syncDailyMealNotifications(meals, {
        requestPermission: true,
      });

      setNotificationState(nextState);
    } catch (error) {
      Alert.alert("Could not configure notifications", getErrorMessage(error));
    } finally {
      setIsConfiguringNotifications(false);
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
              <Text style={styles.eyebrow}>Food log</Text>
              <Text style={styles.title}>Meal timeline and sync dashboard</Text>
              <Text style={styles.subtitle}>
                Local time in {timeZoneLabel}. The app now supports add, edit, delete, realtime
                sync, reminders, and a compact analytics view.
              </Text>
            </View>

            <View style={styles.headerActions}>
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
                  <Text style={styles.refreshButtonText}>{isRefreshing ? "..." : "↻"}</Text>
                </Pressable>
              ) : null}

              {!isPreviewMode ? (
                <Pressable
                  onPress={openCreateComposer}
                  style={({ pressed }) => [
                    styles.headerPrimaryButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.headerPrimaryButtonText}>+ Add meal</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{syncStatusLabel}</Text>
            </View>
            <Text style={styles.metaText}>Last sync {formatSyncTimestamp(lastSyncedAt)}</Text>
          </View>

          <View style={styles.statRow}>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>Calories</Text>
              <Text style={styles.statValue}>{totalCalories}</Text>
            </View>

            <View style={styles.statChip}>
              <Text style={styles.statLabel}>Foods</Text>
              <Text style={styles.statValue}>{totalFoods}</Text>
            </View>

            <View style={styles.statChip}>
              <Text style={styles.statLabel}>Entries</Text>
              <Text style={styles.statValue}>{displayedMeals.length}</Text>
            </View>
          </View>

          <View style={styles.segmentedControl}>
            <Pressable
              onPress={() => setViewMode("timeline")}
              style={({ pressed }) => [
                styles.segmentButton,
                viewMode === "timeline" && styles.segmentButtonActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text
                style={[
                  styles.segmentButtonText,
                  viewMode === "timeline" && styles.segmentButtonTextActive,
                ]}
              >
                Timeline
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setViewMode("analytics")}
              style={({ pressed }) => [
                styles.segmentButton,
                viewMode === "analytics" && styles.segmentButtonActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text
                style={[
                  styles.segmentButtonText,
                  viewMode === "analytics" && styles.segmentButtonTextActive,
                ]}
              >
                Analytics
              </Text>
            </Pressable>
          </View>
        </View>

        {isPreviewMode ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Preview mode</Text>
            <Text style={styles.noticeText}>
              Showing the sample banana meal until Supabase is connected. {supabaseConfigError}
            </Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Sync issue</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.notificationCard}>
          <View style={styles.notificationCopy}>
            <Text style={styles.notificationTitle}>
              {notificationState.enabled ? "Daily notifications active" : "Daily notifications"}
            </Text>
            <Text style={styles.notificationText}>{notificationState.message}</Text>
          </View>

          {!isPreviewMode && notificationState.supported ? (
            <Pressable
              onPress={() => {
                void handleEnableNotifications();
              }}
              style={({ pressed }) => [
                styles.notificationButton,
                (pressed || isConfiguringNotifications) && styles.buttonPressed,
              ]}
              disabled={isConfiguringNotifications}
            >
              <Text style={styles.notificationButtonText}>
                {isConfiguringNotifications
                  ? "Setting..."
                  : notificationState.enabled
                    ? "Refresh schedule"
                    : "Enable reminders"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {viewMode === "timeline" ? (
          <>
            <View style={styles.sectionIntro}>
              <Text style={styles.sectionTitle}>Daily timeline</Text>
              <Text style={styles.sectionSubtitle}>
                Meals are grouped by day and shown in your current timezone for quick review.
              </Text>
            </View>

            {isLoading ? (
              <View style={styles.placeholderCard}>
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text style={styles.placeholderText}>Loading your food timeline...</Text>
              </View>
            ) : timelineSections.length === 0 ? (
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderTitle}>Nothing logged yet</Text>
                <Text style={styles.placeholderText}>
                  Add a meal from the app or write to `public.meals` through the chatbot.
                </Text>

                {!isPreviewMode ? (
                  <Pressable
                    onPress={openCreateComposer}
                    style={({ pressed }) => [
                      styles.emptyStateButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.emptyStateButtonText}>Create first meal</Text>
                  </Pressable>
                ) : null}
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
                      <Text style={styles.daySummaryText}>{section.calories} cal</Text>
                      <Text style={styles.daySummaryText}>{section.foods} foods</Text>
                    </View>
                  </View>

                  <View style={styles.timelineList}>
                    {section.meals.map((meal, index) => {
                      const breakdownItems = parseMealBreakdown(meal.breakdown);
                      const mealCalories = getMealCalories(meal);

                      return (
                        <View key={meal.id} style={styles.timelineRow}>
                          <View style={styles.timeColumn}>
                            <Text style={styles.timeText}>{formatTimelineTime(meal.created_at)}</Text>
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
                                <Text style={styles.entryCalorieText}>{mealCalories} cal</Text>
                              </View>
                            </View>

                            {meal.user_id ? (
                              <Text style={styles.entryMeta}>User {meal.user_id}</Text>
                            ) : null}

                            <View style={styles.entryActionRow}>
                              <Pressable
                                onPress={() => openEditor(meal)}
                                style={({ pressed }) => [
                                  styles.entryActionButton,
                                  pressed && styles.buttonPressed,
                                ]}
                              >
                                <Text style={styles.entryActionButtonText}>Edit</Text>
                              </Pressable>

                              {!isPreviewMode ? (
                                <Pressable
                                  onPress={() => promptDeleteMeal(meal)}
                                  style={({ pressed }) => [
                                    styles.entryActionButton,
                                    styles.entryDeleteButton,
                                    pressed && styles.buttonPressed,
                                  ]}
                                >
                                  <Text style={styles.entryDeleteButtonText}>Delete</Text>
                                </Pressable>
                              ) : null}
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
                                {meal.meal_text ?? "No detailed breakdown provided."}
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
          </>
        ) : (
          <>
            <View style={styles.sectionIntro}>
              <Text style={styles.sectionTitle}>Analytics dashboard</Text>
              <Text style={styles.sectionSubtitle}>
                Activity trends, estimated experiment splits, and a lightweight onboarding funnel.
              </Text>
            </View>

            <View style={styles.analyticsCard}>
              <Text style={styles.analyticsCardTitle}>7-day meal activity</Text>
              <Text style={styles.analyticsCardSubtitle}>
                Daily meal logging volume over the past week.
              </Text>

              <View style={styles.chartRow}>
                {analytics.dailyActivity.map((day) => {
                  const barHeight =
                    day.count === 0
                      ? 6
                      : Math.max(18, Math.round((day.count / maxActivityCount) * 128));

                  return (
                    <View key={day.key} style={styles.chartColumn}>
                      <Text style={styles.chartValue}>{day.count}</Text>
                      <View style={styles.chartTrack}>
                        <View style={[styles.chartFill, { height: barHeight }]} />
                      </View>
                      <Text style={styles.chartLabel}>{day.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={styles.analyticsCard}>
              <Text style={styles.analyticsCardTitle}>A/B group distribution</Text>
              <Text style={styles.analyticsCardSubtitle}>
                Users are deterministically split from `user_id` until explicit experiment metadata
                is available.
              </Text>

              <View style={styles.metricStack}>
                {analytics.groupDistribution.map((group) => {
                  const widthPercentage =
                    group.count === 0
                      ? 0
                      : Math.max(12, Math.round((group.count / maxGroupCount) * 100));
                  const fillStyle =
                    group.label === "Test"
                      ? styles.metricBarFillTest
                      : group.label === "Control"
                        ? styles.metricBarFillControl
                        : styles.metricBarFillMuted;

                  return (
                    <View key={group.label} style={styles.metricRow}>
                      <View style={styles.metricHeader}>
                        <Text style={styles.metricLabel}>{group.label}</Text>
                        <Text style={styles.metricValue}>{group.count}</Text>
                      </View>
                      <View style={styles.metricBarTrack}>
                        <View style={[styles.metricBarFill, fillStyle, { width: `${widthPercentage}%` }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={styles.analyticsCard}>
              <Text style={styles.analyticsCardTitle}>Test-group onboarding funnel</Text>
              <Text style={styles.analyticsCardSubtitle}>
                Completion is estimated from repeat activity or a structured meal breakdown because
                this repo does not yet store dedicated onboarding events.
              </Text>

              <View style={styles.funnelHero}>
                <Text style={styles.funnelRate}>{analytics.completionRate}%</Text>
                <Text style={styles.funnelCaption}>Estimated completion rate</Text>
              </View>

              <View style={styles.funnelStatRow}>
                <View style={styles.funnelStat}>
                  <Text style={styles.funnelStatLabel}>Unique users</Text>
                  <Text style={styles.funnelStatValue}>{analytics.totalUniqueUsers}</Text>
                </View>

                <View style={styles.funnelStat}>
                  <Text style={styles.funnelStatLabel}>Test users</Text>
                  <Text style={styles.funnelStatValue}>{analytics.testUsers}</Text>
                </View>

                <View style={styles.funnelStat}>
                  <Text style={styles.funnelStatLabel}>Completed</Text>
                  <Text style={styles.funnelStatValue}>{analytics.completedTestUsers}</Text>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        animationType="slide"
        transparent
        visible={isEditorVisible}
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
                  <Text style={styles.modalEyebrow}>
                    {editorMode === "create" ? "New meal" : "Update meal"}
                  </Text>
                  <Text style={styles.modalTitle}>
                    {editorMode === "create"
                      ? "Add a meal from the app"
                      : "Edit meal data from the app"}
                  </Text>
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
                  disabled={isBusy}
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
                    onChangeText={handleMealTextChange}
                    placeholder="one banana"
                    placeholderTextColor="#6b7280"
                    style={styles.input}
                  />
                  {editorMode === "create" ? (
                    <>
                      <Text style={styles.fieldHelp}>
                        Search Open Food Facts when you're ready, then pick quantity to auto-fill
                        calories.
                      </Text>

                      <View style={styles.searchActionRow}>
                        <Pressable
                          onPress={() => {
                            void handleOpenFoodFactsSearch();
                          }}
                          style={({ pressed }) => [
                            styles.searchButton,
                            (pressed || openFoodFacts.isSearching || openFoodFacts.isLoadingSelection) &&
                              styles.buttonPressed,
                          ]}
                          disabled={openFoodFacts.isSearching || openFoodFacts.isLoadingSelection}
                        >
                          <Text style={styles.searchButtonText}>
                            {openFoodFacts.isSearching ? "Searching..." : "Search product"}
                          </Text>
                        </Pressable>

                        {openFoodFacts.selectedProduct ? (
                          <Pressable
                            onPress={clearOpenFoodFactsSelection}
                            style={({ pressed }) => [
                              styles.searchSecondaryButton,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={styles.searchSecondaryButtonText}>Manual entry</Text>
                          </Pressable>
                        ) : null}
                      </View>

                      {openFoodFacts.error ? (
                        <View style={styles.inlineMessageCard}>
                          <Text style={styles.inlineMessageText}>{openFoodFacts.error}</Text>
                        </View>
                      ) : null}

                      {openFoodFacts.isLoadingSelection ? (
                        <View style={styles.selectedFoodCard}>
                          <Text style={styles.selectedFoodLabel}>Open Food Facts product</Text>
                          <Text style={styles.selectedFoodTitle}>Loading nutrition details...</Text>
                          <Text style={styles.selectedFoodSummaryMuted}>
                            Fetching calories for the selected product before we calculate quantity.
                          </Text>
                        </View>
                      ) : null}

                      {openFoodFacts.selectedProduct ? (
                        <View style={styles.selectedFoodCard}>
                          <Text style={styles.selectedFoodLabel}>Open Food Facts product</Text>
                          <Text style={styles.selectedFoodTitle}>
                            {openFoodFacts.selectedProduct.name}
                          </Text>
                          <Text style={styles.selectedFoodMeta}>
                            {getOpenFoodFactsMeta(openFoodFacts.selectedProduct)}
                          </Text>

                          <View style={styles.quantityRow}>
                            <View style={styles.quantityInputWrap}>
                              <Text style={styles.fieldLabel}>Quantity</Text>
                              <TextInput
                                value={openFoodFacts.quantityValue}
                                onChangeText={(value) => {
                                  setOpenFoodFacts((currentState) => ({
                                    ...currentState,
                                    quantityValue: value,
                                  }));
                                }}
                                placeholder={
                                  openFoodFacts.quantityMode === "grams" ? "100" : "1"
                                }
                                placeholderTextColor="#6b7280"
                                keyboardType="decimal-pad"
                                style={styles.input}
                              />
                            </View>

                            <View style={styles.quantityToggleWrap}>
                              <Text style={styles.fieldLabel}>Unit</Text>
                              <View style={styles.quantityToggle}>
                                <Pressable
                                  onPress={() => {
                                    setOpenFoodFacts((currentState) => ({
                                      ...currentState,
                                      quantityMode: "grams",
                                      quantityValue:
                                        currentState.quantityMode === "grams"
                                          ? currentState.quantityValue
                                          : "100",
                                    }));
                                  }}
                                  style={({ pressed }) => [
                                    styles.quantityToggleButton,
                                    openFoodFacts.quantityMode === "grams" &&
                                      styles.quantityToggleButtonActive,
                                    pressed && styles.buttonPressed,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.quantityToggleButtonText,
                                      openFoodFacts.quantityMode === "grams" &&
                                        styles.quantityToggleButtonTextActive,
                                    ]}
                                  >
                                    g
                                  </Text>
                                </Pressable>

                                {supportsServingMode(openFoodFacts.selectedProduct) ? (
                                  <Pressable
                                    onPress={() => {
                                      setOpenFoodFacts((currentState) => ({
                                        ...currentState,
                                        quantityMode: "servings",
                                        quantityValue:
                                          currentState.quantityMode === "servings"
                                            ? currentState.quantityValue
                                            : "1",
                                      }));
                                    }}
                                    style={({ pressed }) => [
                                      styles.quantityToggleButton,
                                      openFoodFacts.quantityMode === "servings" &&
                                        styles.quantityToggleButtonActive,
                                      pressed && styles.buttonPressed,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.quantityToggleButtonText,
                                        openFoodFacts.quantityMode === "servings" &&
                                          styles.quantityToggleButtonTextActive,
                                      ]}
                                    >
                                      serving
                                    </Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            </View>
                          </View>

                          {selectedFoodCalculation ? (
                            <Text style={styles.selectedFoodSummary}>
                              {selectedFoodCalculation.calories} calories for{" "}
                              {selectedFoodCalculation.quantityLabel}
                            </Text>
                          ) : (
                            <Text style={styles.selectedFoodSummaryMuted}>
                              Enter a valid quantity to calculate calories.
                            </Text>
                          )}
                        </View>
                      ) : null}

                      {openFoodFacts.results.length > 0 ? (
                        <View style={styles.searchResultsCard}>
                          <Text style={styles.searchResultsTitle}>Pick a matching product</Text>

                          {openFoodFacts.results.map((product) => (
                            <Pressable
                              key={product.code}
                              onPress={() => applyOpenFoodFactsSelection(product)}
                              style={({ pressed }) => [
                                styles.searchResultItem,
                                pressed && styles.buttonPressed,
                              ]}
                            >
                              <Text style={styles.searchResultTitle}>{product.name}</Text>
                              <Text style={styles.searchResultMeta}>
                                {getOpenFoodFactsMeta(product)}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </>
                  ) : null}
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
                      style={[
                        styles.input,
                        editorMode === "create" &&
                          openFoodFacts.selectedProduct &&
                          styles.inputReadonly,
                      ]}
                      editable={!(editorMode === "create" && openFoodFacts.selectedProduct)}
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
                    placeholder="Banana | 1 medium | 105"
                    placeholderTextColor="#6b7280"
                    multiline
                    textAlignVertical="top"
                    style={[
                      styles.textarea,
                      editorMode === "create" &&
                        openFoodFacts.selectedProduct &&
                        styles.inputReadonly,
                    ]}
                    editable={!(editorMode === "create" && openFoodFacts.selectedProduct)}
                  />
                  <Text style={styles.fieldHelp}>Example: `Banana | 1 medium | 105`</Text>
                </View>

                {editorMode === "edit" && editingMeal ? (
                  <Pressable
                    onPress={() => promptDeleteMeal(editingMeal)}
                    style={({ pressed }) => [
                      styles.deleteAction,
                      pressed && styles.buttonPressed,
                    ]}
                    disabled={isBusy}
                  >
                    <Text style={styles.deleteActionText}>
                      {isDeleting ? "Deleting..." : "Delete meal"}
                    </Text>
                  </Pressable>
                ) : null}
              </ScrollView>

              <View style={styles.modalActions}>
                <Pressable
                  onPress={closeEditor}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    pressed && styles.buttonPressed,
                  ]}
                  disabled={isBusy}
                >
                  <Text style={styles.secondaryActionText}>Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    void handleSaveMeal();
                  }}
                  style={({ pressed }) => [
                    styles.primaryAction,
                    (pressed || isSaving) && styles.buttonPressed,
                  ]}
                  disabled={isBusy}
                >
                  <Text style={styles.primaryActionText}>
                    {isSaving
                      ? "Saving..."
                      : editorMode === "create"
                        ? "Create meal"
                        : "Save changes"}
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
    maxWidth: 320,
  },
  headerActions: {
    gap: 10,
    alignItems: "flex-end",
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
  headerPrimaryButton: {
    minHeight: 42,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#d97706",
  },
  headerPrimaryButtonText: {
    color: "#111111",
    fontSize: 13,
    fontWeight: "800",
  },
  buttonPressed: {
    opacity: 0.8,
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
  segmentedControl: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#0d0d10",
    borderRadius: 20,
    padding: 6,
    borderWidth: 1,
    borderColor: "#1f1f24",
  },
  segmentButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  segmentButtonActive: {
    backgroundColor: "#1b1b20",
  },
  segmentButtonText: {
    color: "#71717a",
    fontSize: 13,
    fontWeight: "700",
  },
  segmentButtonTextActive: {
    color: "#fafafa",
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
  notificationCard: {
    backgroundColor: "#111827",
    borderRadius: 24,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  notificationCopy: {
    gap: 6,
  },
  notificationTitle: {
    color: "#eff6ff",
    fontSize: 18,
    fontWeight: "800",
  },
  notificationText: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 20,
  },
  notificationButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#38bdf8",
  },
  notificationButtonText: {
    color: "#082f49",
    fontSize: 13,
    fontWeight: "800",
  },
  sectionIntro: {
    gap: 4,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: "#fafafa",
    fontSize: 22,
    fontWeight: "800",
  },
  sectionSubtitle: {
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
  emptyStateButton: {
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#d97706",
  },
  emptyStateButtonText: {
    color: "#111111",
    fontSize: 13,
    fontWeight: "800",
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
    gap: 10,
  },
  entryActionButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "#111114",
    borderWidth: 1,
    borderColor: "#2d2d35",
  },
  entryActionButtonText: {
    color: "#e4e4e7",
    fontSize: 12,
    fontWeight: "700",
  },
  entryDeleteButton: {
    borderColor: "#4c1d1d",
    backgroundColor: "#211011",
  },
  entryDeleteButtonText: {
    color: "#fca5a5",
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
  analyticsCard: {
    backgroundColor: "#10141f",
    borderRadius: 24,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  analyticsCardTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
  },
  analyticsCardSubtitle: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 19,
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
  },
  chartColumn: {
    flex: 1,
    alignItems: "center",
    gap: 8,
  },
  chartValue: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  chartTrack: {
    width: "100%",
    height: 132,
    borderRadius: 999,
    backgroundColor: "#0f172a",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  chartFill: {
    width: "100%",
    borderRadius: 999,
    backgroundColor: "#38bdf8",
  },
  chartLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
  },
  metricStack: {
    gap: 12,
  },
  metricRow: {
    gap: 8,
  },
  metricHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metricLabel: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
  },
  metricValue: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "800",
  },
  metricBarTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#0f172a",
    overflow: "hidden",
  },
  metricBarFill: {
    height: "100%",
    borderRadius: 999,
  },
  metricBarFillControl: {
    backgroundColor: "#f59e0b",
  },
  metricBarFillTest: {
    backgroundColor: "#38bdf8",
  },
  metricBarFillMuted: {
    backgroundColor: "#64748b",
  },
  funnelHero: {
    alignItems: "center",
    gap: 4,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: "#0f172a",
  },
  funnelRate: {
    color: "#f8fafc",
    fontSize: 40,
    fontWeight: "800",
  },
  funnelCaption: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "600",
  },
  funnelStatRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  funnelStat: {
    flexGrow: 1,
    minWidth: 92,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  funnelStatLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
  funnelStatValue: {
    marginTop: 6,
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "800",
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
  searchActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  searchButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#2563eb",
  },
  searchButtonText: {
    color: "#eff6ff",
    fontSize: 13,
    fontWeight: "800",
  },
  searchSecondaryButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#2d2d35",
  },
  searchSecondaryButtonText: {
    color: "#e4e4e7",
    fontSize: 13,
    fontWeight: "700",
  },
  inlineMessageCard: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#27140c",
    borderWidth: 1,
    borderColor: "#7c2d12",
  },
  inlineMessageText: {
    color: "#fed7aa",
    fontSize: 12,
    lineHeight: 18,
  },
  selectedFoodCard: {
    gap: 10,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1d4ed8",
  },
  selectedFoodLabel: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  selectedFoodTitle: {
    color: "#eff6ff",
    fontSize: 17,
    fontWeight: "800",
  },
  selectedFoodMeta: {
    color: "#bfdbfe",
    fontSize: 12,
    lineHeight: 18,
  },
  quantityRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-end",
  },
  quantityInputWrap: {
    flex: 1,
    gap: 8,
  },
  quantityToggleWrap: {
    flex: 1.1,
    gap: 8,
  },
  quantityToggle: {
    flexDirection: "row",
    gap: 8,
  },
  quantityToggleButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
  },
  quantityToggleButtonActive: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  quantityToggleButtonText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
  },
  quantityToggleButtonTextActive: {
    color: "#eff6ff",
  },
  selectedFoodSummary: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "700",
  },
  selectedFoodSummaryMuted: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 18,
  },
  searchResultsCard: {
    gap: 10,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "#101012",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  searchResultsTitle: {
    color: "#fafafa",
    fontSize: 14,
    fontWeight: "800",
  },
  searchResultItem: {
    gap: 4,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#16161a",
    borderWidth: 1,
    borderColor: "#232329",
  },
  searchResultTitle: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
  },
  searchResultMeta: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 18,
  },
  inputReadonly: {
    opacity: 0.75,
  },
  deleteAction: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#331314",
    borderWidth: 1,
    borderColor: "#7f1d1d",
  },
  deleteActionText: {
    color: "#fecaca",
    fontSize: 15,
    fontWeight: "700",
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
