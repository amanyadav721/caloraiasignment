import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { countMealsForDate } from "./analytics";
import type { MealRow } from "../types/database";

const ANDROID_CHANNEL_ID = "meal-reminders";
const DAILY_REMINDER_ID = "daily-meal-reminder";
const DAILY_SUMMARY_ID = "daily-meal-summary";
const REMINDER_HOUR = 20;
const REMINDER_MINUTE = 0;
const SUMMARY_HOUR = 21;
const SUMMARY_MINUTE = 0;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type NotificationSyncResult = {
  enabled: boolean;
  supported: boolean;
  message: string;
};

export async function syncDailyMealNotifications(
  meals: MealRow[],
  options?: { requestPermission?: boolean },
) {
  if (Platform.OS === "web") {
    return {
      enabled: false,
      supported: false,
      message: "Notifications are only available on iOS and Android.",
    } satisfies NotificationSyncResult;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Meal reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      enableVibrate: true,
      lightColor: "#f59e0b",
    });
  }

  const currentPermissions = await Notifications.getPermissionsAsync();

  let finalStatus = currentPermissions.status;

  if (finalStatus !== "granted" && options?.requestPermission) {
    const requestedPermissions = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermissions.status;
  }

  if (finalStatus !== "granted") {
    return {
      enabled: false,
      supported: true,
      message: options?.requestPermission
        ? "Notifications are disabled for this app."
        : "Enable notifications to send the daily reminder and summary.",
    } satisfies NotificationSyncResult;
  }

  await cancelExistingNotification(DAILY_REMINDER_ID);
  await cancelExistingNotification(DAILY_SUMMARY_ID);

  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_REMINDER_ID,
    content: {
      title: "Meal reminder",
      body: "Log dinner and keep the mobile app and chatbot timeline in sync.",
      sound: "default",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: REMINDER_HOUR,
      minute: REMINDER_MINUTE,
      ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
  });

  const todayMeals = countMealsForDate(meals, new Date());
  const nextSummaryDate = getNextSummaryDate();
  const mealLabel = todayMeals === 1 ? "meal" : "meals";

  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_SUMMARY_ID,
    content: {
      title: "Today's meal summary",
      body: `You logged ${todayMeals} ${mealLabel} today. Check the dashboard for trends.`,
      sound: "default",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: nextSummaryDate,
      ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
  });

  return {
    enabled: true,
    supported: true,
    message: "Reminder set for 8:00 PM and summary set for 9:00 PM local time.",
  } satisfies NotificationSyncResult;
}

async function cancelExistingNotification(identifier: string) {
  const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

  const matchingNotification = scheduledNotifications.find((notification) => {
    return notification.identifier === identifier;
  });

  if (!matchingNotification) {
    return;
  }

  await Notifications.cancelScheduledNotificationAsync(matchingNotification.identifier);
}

function getNextSummaryDate() {
  const nextDate = new Date();
  nextDate.setHours(SUMMARY_HOUR, SUMMARY_MINUTE, 0, 0);

  if (nextDate.getTime() <= Date.now()) {
    nextDate.setDate(nextDate.getDate() + 1);
  }

  return nextDate;
}
