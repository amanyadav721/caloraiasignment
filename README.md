# Calor AI Assignment

An Expo + React Native food log app that reads meals from Supabase and shows them in a daily timeline. When Supabase is not configured yet, the app falls back to a preview mode with a sample meal so the UI can still be reviewed.

## What the app does

- Loads meal entries from `public.meals`
- Groups meals by day in the device's local timezone
- Shows total calories, foods, and entries
- Subscribes to Supabase Realtime so updates appear automatically
- Lets you add, edit, and delete meals directly from the app
- Schedules a daily reminder and a same-day summary notification
- Includes an in-app analytics view for real onboarding, experiment, and engagement metrics

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

4. Create the required database tables and policies:

- Open the Supabase SQL Editor.
- Copy the SQL from `supabase/meals.sql`.
- Run it against your project.
- Copy the SQL from `supabase/analytics.sql`.
- Run it against your project too.

Those scripts:

- Creates the `public.meals` table
- Creates the `public.users` and `public.events` tables
- Enables row level security
- Adds the read policies needed by the app
- Adds the tables to `supabase_realtime`
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
- `npm run test:analytics` compiles and runs the analytics unit tests

## Environment variables

The app expects these variables at startup:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

If either value is missing, the app stays in preview mode and shows a sample banana meal instead of live Supabase data.

## Architecture overview

- The Expo app is the client layer. `App.tsx` renders `FoodLoggingScreen`, which handles timeline rendering, meal CRUD flows, analytics display, Open Food Facts lookups, and notification controls.
- Supabase is the backend layer. The app reads and writes meal data through `src/lib/supabase.ts` and `src/lib/meals.ts`, while `supabase/meals.sql` sets up the `meals` table, row level security, and Realtime publishing.
- External workflow automation is assumed to live outside this repo. The intended shape is that n8n or a chatbot flow writes meal and event data into the same Supabase project, and the mobile app reflects those changes in near real time.

## Tools and services used and why

- Expo and React Native are used to ship one codebase across iOS, Android, and web with a fast local development loop. That kept the assignment focused on product behavior instead of native platform setup.
- TypeScript is used to keep the Supabase payloads, UI state, and helper modules typed. That reduces avoidable bugs when working with nullable database fields and structured meal breakdowns.
- Supabase is used for Postgres storage, simple API access, and Realtime subscriptions in one hosted service. It was a fast fit for the assignment because the app can read and sync meal data without building a custom backend first.
- Expo Notifications is used for the reminder and daily summary experience on mobile. It gives a lightweight way to test retention-oriented behavior without introducing another backend service for push delivery.
- Open Food Facts is used as a public nutrition lookup source when creating meals from packaged products. It helps auto-fill calorie estimates without maintaining a custom food database for the prototype.
- n8n is treated as the workflow automation layer for the broader product idea. It is a good fit for connecting chatbot events, meal ingestion, and backend writes quickly, even though that workflow configuration is not stored in this repository.

## Bonus task coverage

- Bonus Task 1: The mobile app now supports meal listing, timestamps, add, edit, delete, and realtime sync through Supabase.
- Bonus Task 2: The app listens for realtime meal changes and can schedule a daily reminder plus a local daily summary notification.
- Bonus Task 3: The app includes an analytics tab with real backend onboarding state, experiment split, completion by variant, and engagement metrics.

## Project structure

```text
.
|-- App.tsx
|-- src/
|   |-- lib/
|   |   |-- analytics.ts
|   |   |-- analyticsData.ts
|   |   |-- datetime.ts
|   |   |-- meals.ts
|   |   |-- notifications.ts
|   |   |-- openFoodFacts.ts
|   |   `-- supabase.ts
|   |-- screens/
|   |   `-- FoodLoggingScreen.tsx
|   `-- types/
|       `-- database.ts
`-- supabase/
    |-- analytics.sql
    `-- meals.sql
```

## Troubleshooting

- If the app still shows preview mode after adding env vars, stop Expo completely and start it again.
- If you change `.env`, restart the Expo server so the new `EXPO_PUBLIC_*` values are picked up.
- If live updates are not appearing, rerun `supabase/meals.sql` and make sure the `public.meals` table is part of the `supabase_realtime` publication.
- If there are no entries yet, the screen will stay empty until rows exist in `public.meals`.

## Assumptions and trade-offs

- I assumed the n8n workflow and any chatbot integration live outside this repo and write into the same Supabase project. This README documents that dependency, but the workflow definition itself is not versioned here.
- I used a Supabase anon key and assignment-friendly read/write policies to keep setup fast. For a production app, I would tighten auth, scope policies per user, and avoid broad public write access.
- The app includes a preview mode with seeded sample data so the UI can still be reviewed before backend setup is complete. That improves demoability, but it also means a misconfigured environment can look superficially healthy at first glance.
- Analytics are now powered by the real `users`, `events`, and `meals` tables in Supabase. The optional Step 3 and time-to-complete metrics still depend on whether your backend writes that state explicitly.
- Open Food Facts is a public best-effort data source. Product coverage and calorie quality can vary, so manual meal entry remains necessary as a fallback.

## Time breakdown

- n8n workflow and automation thinking: about 1 hour 40 minutes
- Mobile app development: about 1 hour
- Supabase setup and schema wiring: about 20 minutes
- Remaining setup, polish, and documentation: about 20 minutes
- Total: about 3 hours 20 minutes

## Notes

- The repository now includes `npm run test:analytics` for the backend-powered analytics calculations.
- Local environment files are gitignored, and `.env.example` is safe to commit as a template.
