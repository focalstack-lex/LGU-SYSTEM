# Setup Guide - COE Budget Transparency System

## Prerequisites

- Node.js v18+ (https://nodejs.org)
- A Supabase project (https://supabase.com)

---

## Step 1: Install Dependencies

```bash
npm install
```

---

## Step 2: Configure Supabase

1. Go to [supabase.com](https://supabase.com) → New Project
2. In the SQL Editor, run the migration files **in order**:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/policies/002_rls_policies.sql`
   - `supabase/migrations/003_seed_data.sql` _(optional, for testing)_
3. In Supabase Storage, create a bucket named **`receipts`** and set it to **Public**.

---

## Step 3: Set Environment Variables

Copy `.env.example` to `.env`:

```bash
copy .env.example .env
```

Fill in your values from **Supabase → Project Settings → API**:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-public-key
```

---

## Step 4: Configure the Frontend

Edit `client/js/config.js`:

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_ANON = "your-anon-public-key";
```

---

## Step 5: Run the Server

```bash
npm run dev
```

Visit: **http://localhost:3000**

---

## Step 6: Create Your First Admin

1. Register a new account on the site.
2. In Supabase → Table Editor → `profiles` table:
3. Find your row and change the `role` field from `student` to `admin`.

---

## Deploying

| Layer    | Service  | Notes                     |
| -------- | -------- | ------------------------- |
| Frontend | Vercel   | Root directory `client/`; `client/vercel.json` runs `npm run build` (Vite) and serves `dist/` |
| Backend  | Render   | Set env vars from `.env`  |
| Database | Supabase | Already cloud-hosted      |
