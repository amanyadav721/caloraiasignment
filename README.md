# Calor AI Assignment

An Expo + React Native food log app that reads meals from Supabase and shows them in a daily timeline. When Supabase is not configured yet, the app falls back to a preview mode with a sample meal so the UI can still be reviewed.

## What the app does

- Loads meal entries from `public.meals`
- Groups meals by day in the device's local timezone
- Shows total calories, foods, and entries
- Subscribes to Supabase Realtime so updates appear automatically
- Lets you add, edit, and delete meals directly from the app
- Schedules a daily reminder and a same-day summary notification
- Includes an in-app analytics view for recent activity and experiment splits

## Tech stack

- Expo 54
- React Native 0.81
- TypeScript
- Supabase (`@supabase/supabase-js`)
- Expo Notifications (`expo-notifications`)

## Prerequisites

Before starting, make sure you have:

- Node.js LTS installed
- npm installed
- A Supabase project
- One way to run the app:
  - Expo Go on a physical device
  - Android Studio emulator
  - Xcode simulator on macOS
  - A browser for the web build

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local environment file:

```bash
cp .env.example .env
```

3. Add your Supabase project credentials to `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

You can find both values in your Supabase dashboard under `Project Settings -> API`.

4. Create the required database table and policies:

- Open the Supabase SQL Editor.
- Copy the SQL from `supabase/meals.sql`.
- Run it against your project.

That script:

- Creates the `public.meals` table
- Enables row level security
- Adds read/write policies for `anon` and `authenticated`
- Adds the table to `supabase_realtime`
- Seeds one sample row

5. Start the Expo development server:

```bash
npm start
```

6. Open the app on your preferred platform:

```bash
npm run android
```

```bash
npm run ios
```

```bash
npm run web
```

You can also run `npm start` and then use the Expo prompt to launch Android, iOS, or web.

## Available scripts

- `npm start` starts the Expo dev server
- `npm run android` opens the Android app through Expo
- `npm run ios` opens the iOS app through Expo
- `npm run web` starts the web target through Expo

## Environment variables

The app expects these variables at startup:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

If either value is missing, the app stays in preview mode and shows a sample banana meal instead of live Supabase data.

## Bonus task coverage

- Bonus Task 1: The mobile app now supports meal listing, timestamps, add, edit, delete, and realtime sync through Supabase.
- Bonus Task 2: The app listens for realtime meal changes and can schedule a daily reminder plus a local daily summary notification.
- Bonus Task 3: The app includes an analytics tab with 7-day activity, estimated A/B split, and an onboarding completion proxy for the Test group.

## Project structure

```text
.
|-- App.tsx
|-- src/
|   |-- lib/
|   |   |-- meals.ts
|   |   `-- supabase.ts
|   |-- screens/
|   |   `-- FoodLoggingScreen.tsx
|   `-- types/
|       `-- database.ts
`-- supabase/
    `-- meals.sql
```

## Troubleshooting

- If the app still shows preview mode after adding env vars, stop Expo completely and start it again.
- If you change `.env`, restart the Expo server so the new `EXPO_PUBLIC_*` values are picked up.
- If live updates are not appearing, rerun `supabase/meals.sql` and make sure the `public.meals` table is part of the `supabase_realtime` publication.
- If there are no entries yet, the screen will stay empty until rows exist in `public.meals`.

## Notes

- The repository currently does not define a test script in `package.json`.
- Local environment files are gitignored, and `.env.example` is safe to commit as a template.
