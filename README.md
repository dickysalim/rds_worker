# rds_worker

Cloudflare Worker backend for RDS Factory Management, using D1 as the database.

## Setup

```bash
npm install
```

Create the D1 database (one-time, per Cloudflare account):

```bash
npx wrangler d1 create rds_db
```

Copy the returned `database_id` into `wrangler.jsonc` (`d1_databases[0].database_id`).

Apply migrations:

```bash
npm run db:migrations:apply:local   # local dev
npm run db:migrations:apply:remote  # deployed database
```

## Development

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

In production this repo is connected to Cloudflare Workers Builds for automatic deploys on push to `main`.
