# D1 Schema

3 D1 databases, one Worker (`wrangler.toml` bindings):

| Binding | Database | Purpose |
|---|---|---|
| `DB` | `rds_factory_management` | Production business data |
| `DB_STAGING` | `staging_rds_factory_management` | Full clone of `DB`, super_admin-only toggle (`X-Db-Target: staging` header, gated by `session.role === 'super_admin'` in `src/index.ts`) |
| `USER_DB` | `user_accounts` | Auth only. Unaffected by the staging toggle — always production. |

R2 bucket: binding `ASSETS`, bucket `rds-factory-management-assets` (PDF cache, uploaded evidence/logos).

Source of truth: `migrations/0001_init.sql` through `migrations/0031_user_audit_columns.sql`. This doc describes the schema as of `0031`, after the `0015` versioning rewrite.

## `USER_DB` (`user_accounts`)

### `user`
| Column | Type | Notes |
|---|---|---|
| `user_id` | TEXT PK | UUID v4, since 0028 (was `INTEGER PK AUTOINCREMENT`) |
| `username` | TEXT NOT NULL UNIQUE | |
| `name` | TEXT NOT NULL | |
| `password_hash` | TEXT NOT NULL | bcrypt |
| `role` | TEXT NOT NULL | `super_admin` gates the staging-DB toggle; `staff`/`quality_control` are `ASSIGNABLE_ROLES` (Team Settings) |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | 0001; since 0030 also flipped by `handleDeactivateUser` (soft deactivate from Team Settings) |
| `created_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `must_change_password` | INTEGER NOT NULL DEFAULT 0 | 0030, set on `handleCreateUser`/`handleResetUserPassword`; cleared by `handleUpdatePassword`; frontend gates the whole app on this via `ForcePasswordChangePage` |
| `created_by` | TEXT | 0031, `user.user_id` UUID of the super_admin who created this account (self for the original seeded accounts, unset) |
| `updated_by` | TEXT | 0031, `user.user_id` UUID of whoever last touched this row (self-service name/password change, or a super_admin's role edit/reset/deactivate via Team Settings) |
| `updated_at` | TEXT | 0031 |

Not yet hydrated to a display name anywhere (no UI surfaces it yet) and not yet covered by the history-snapshot idea (parked — see root `CLAUDE.md`/chat history; `user` now has real edit endpoints too, so it belongs on that list when that work resumes).

The old `user` table on `DB`/`DB_STAGING` (from `0001_init.sql`) is dead — auth moved here. Drop it on both if not already done.

## `DB` / `DB_STAGING` (`rds_factory_management`)

### `business`
Single-row settings table. Columns accumulated across migrations:

| Column | Type | Added in |
|---|---|---|
| `business_id` | INTEGER PK AUTOINCREMENT | 0001 |
| `business_name` | TEXT NOT NULL | 0001 |
| `business_address` | TEXT | 0001 |
| `business_contact_number` | TEXT | 0001 |
| `business_email` | TEXT | 0002 |
| `business_logo_key` | TEXT | 0005 (R2 key) |
| `payment_bank_name` | TEXT | 0009 |
| `payment_account_name` | TEXT | 0009 |
| `payment_account_number` | TEXT | 0009 |
| `business_contact_person` | TEXT | 0010 |

`nota_counter` (0001) was dropped in 0002 — nota numbering is computed, not stored.

### `customer` (versioned, append-only since 0015)
| Column | Type | Notes |
|---|---|---|
| `row_increment` | INTEGER PK AUTOINCREMENT | surrogate row key, not a stable id |
| `customer_id` | INTEGER NOT NULL | stable id, repeats across versions |
| `company_name` | TEXT NOT NULL | |
| `address` | TEXT | |
| `contact_person` | TEXT | merged in from the dropped `customer_contact` table |
| `phone_number` | TEXT | |
| `updated_by` | TEXT | `user.user_id` UUID since 0029 (was username); `handleGetCustomerHistory` hydrates it to a display name via `hydrateUserNames` |
| `updated_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | current-version flag |

Indexes: `idx_customer_customer_id (customer_id)`; `UNIQUE idx_customer_company_name_active (company_name) WHERE is_active = 1`; `UNIQUE idx_customer_phone_active (phone_number) WHERE is_active = 1`.

An edit inserts a new row for the same `customer_id` and flips the old row's `is_active` to 0 — never UPDATEs in place. "Current" customer = `WHERE customer_id = ? AND is_active = 1`.

`customer_contact` (0001, unique-phone constraint added 0004) was dropped in 0015 — one contact per customer is now inline on `customer`.

### `product` (versioned, same pattern)
| Column | Type | Notes |
|---|---|---|
| `row_increment` | INTEGER PK AUTOINCREMENT | |
| `sku_id` | INTEGER NOT NULL | stable id |
| `sku_name` | TEXT NOT NULL | |
| `unit` | TEXT NOT NULL | |
| `suggested_price` | INTEGER | sell price |
| `cost_price` | INTEGER | 0018, harga modal / cost price — what the business pays to acquire or produce it |
| `updated_by` | TEXT | `user.user_id` UUID since 0029 (was username); `handleGetProductHistory` hydrates it to a display name via `hydrateUserNames` |
| `updated_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | |

Indexes: `idx_product_sku_id (sku_id)`; `UNIQUE idx_product_sku_name_active (sku_name) WHERE is_active = 1`.

### `nota`
Immutable once created (void is the only state change — no versioning needed).

| Column | Type | Added in |
|---|---|---|
| `nota_id` | INTEGER PK AUTOINCREMENT | 0001 |
| `nota_number` | TEXT NOT NULL UNIQUE | 0001 |
| `nota_date` | TEXT NOT NULL | 0001, local `YYYY-MM-DD` |
| `customer_id` | INTEGER NOT NULL | 0001, unenforced (no FK since 0015) |
| `customer_company_name_snapshot` | TEXT NOT NULL | 0001 |
| `customer_address_snapshot` | TEXT | 0001 |
| `contact_name_snapshot` | TEXT NOT NULL | 0001 |
| `contact_phone_number_snapshot` | TEXT NOT NULL | 0001 |
| `total_price` | INTEGER NOT NULL | 0001 |
| `created_by` | INTEGER NOT NULL | 0001, unenforced (was FK to `user`, now dangling — auth moved to `USER_DB`). Holds `user.user_id` UUID since 0029 despite the INTEGER column affinity (SQLite isn't strict); not currently surfaced in any API response |
| `is_void` | INTEGER NOT NULL DEFAULT 0 | 0001 |
| `created_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | 0001 |
| `pdf_r2_key` | TEXT | 0013, server-side PDF cache pointer |
| `notes` | TEXT | 0021, free-text note on the nota |

`contact_id` (0001, FK to `customer_contact`) dropped in 0015 along with `customer_contact`.

Index: `idx_nota_customer (customer_id)`.

### `nota_item`
| Column | Type | Added in |
|---|---|---|
| `nota_item_id` | INTEGER PK AUTOINCREMENT | 0001 |
| `nota_id` | INTEGER NOT NULL | 0001, unenforced |
| `sku_id` | INTEGER NOT NULL | 0001, unenforced |
| `item_name_snapshot` | TEXT NOT NULL | 0001 |
| `unit_snapshot` | TEXT NOT NULL | 0001 |
| `qty` | REAL NOT NULL | 0001 |
| `price` | INTEGER NOT NULL | 0001 |
| `discount_amount` | INTEGER NOT NULL DEFAULT 0 | 0001 |
| `total_price` | INTEGER NOT NULL | 0001 |
| `discount_percent` | REAL NOT NULL DEFAULT 0 | 0006 |
| `cost_price_snapshot` | INTEGER | 0020, product.cost_price at insert time |

Indexes: `idx_nota_item_nota (nota_id)`; `idx_nota_item_sku (sku_id)` (0017, backs the `total_revenue` correlated subquery in `handleListProducts`).

### `payment`
Scoped to a customer's bill period (customer + month), not a single nota, since 0014 — one real-world payment can cover several nota.

| Column | Type | Added in |
|---|---|---|
| `payment_id` | INTEGER PK AUTOINCREMENT | 0001 |
| `payment_date` | TEXT NOT NULL | 0001 |
| `amount` | INTEGER NOT NULL | 0001 |
| `method` | TEXT | 0001 |
| `reference` | TEXT | 0001 |
| `is_void` | INTEGER NOT NULL DEFAULT 0 | 0001 |
| `created_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | 0001 |
| `evidence_key` | TEXT | 0007, R2 key for uploaded proof |
| `payment_number` | TEXT | 0008 |
| `customer_id` | INTEGER | 0014, unenforced |
| `bill_year` | INTEGER | 0014 |
| `bill_month` | INTEGER | 0014 |

`nota_id` (0001) dropped in 0014 — replaced by `customer_id` + `bill_year` + `bill_month`.

Index: `idx_payment_bill (customer_id, bill_year, bill_month)`.

### View: `nota_summary`
Computes `paid_amount`/`status` per nota live — never stored. Current version (since 0014) does a waterfall allocation: a customer's bill-period payments are summed and applied to that period's nota in `(nota_date, nota_id)` order, each nota absorbing payment only after earlier nota in the same period are covered.

```sql
status = 'void'    if nota.is_void
       | 'paid'    if computed_paid >= total_price
       | 'partial' if 0 < computed_paid < total_price
       | 'unpaid'  otherwise
```

### `current_stock` (computed, no table)
`product_stock` and all four stock triggers (`trg_product_seed_stock`, `trg_stock_ledger_apply`, `trg_nota_item_debit_stock`, `trg_nota_void_restock`) were removed in `0026` — they were a cache that had to be kept in lockstep with every stock-affecting write, and every 0015-style table rebuild risked silently dropping them. `current_stock` is now computed live in `handleListProducts` (`src/index.ts`):

```sql
SUM(stock_ledger.qty WHERE sku_id = ?)
  - SUM(nota_item.qty WHERE sku_id = ? AND nota.is_void = 0)
```

No cache to drift, no trigger to lose on a rebuild. Cost is an aggregate per SKU per query instead of a cached read — fine at current scale (see chat: matters only around several hundred SKUs on one list page, and the fix then is one GROUP BY join, not reintroducing the cache).

### `stock_ledger`
Append-only record of every staff-reported stock movement (not sales — a sale's debit is computed live from `nota_item`, see above, so it isn't duplicated here).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `sku_id` | INTEGER NOT NULL | unenforced |
| `date` | TEXT NOT NULL | business date of the event |
| `movement_type` | TEXT NOT NULL | `CHECK IN ('production_in', 'shipment_return', 'adjust_up', 'stock_loss', 'stock_out', 'stock_defect', 'adjust_down')` (0026 — `stock_input` renamed to `production_in`; added `shipment_return`, `stock_out`, `stock_defect`) |
| `qty` | REAL NOT NULL | signed. `CHECK`: `production_in`/`shipment_return`/`adjust_up` must be `> 0`, `stock_loss`/`stock_out`/`stock_defect`/`adjust_down` must be `< 0` |
| `note` | TEXT | reason (damage, recount, PO ref, etc.) |
| `created_by` | TEXT | `user.user_id` UUID since 0029 (was username); `handleListStockLedger` hydrates it to a display name via `hydrateUserNames` |
| `created_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | 0027, soft delete — `handleDeleteStockMovement` flips this instead of a real `DELETE`; `handleListStockLedger` excludes `is_active = 0` rows |
| `updated_by` | TEXT | 0027, `user.user_id` UUID since 0029 (was username); set on edit or delete; hydrated same as `created_by` |
| `updated_at` | TEXT | 0027 |

Index: `idx_stock_ledger_sku (sku_id)`.

Cause distinctions, by design: `stock_out` = intentional personal/take-home draw; `stock_defect` = defective item written off, typically after a `shipment_return`; `stock_loss` = known-cause shrinkage (breakage, expiry, fire, theft); `adjust_down`/`adjust_up` = unknown-cause reconciliation when the count is just off.

Production reject / QC reject tracking is pinned — not implemented yet.

## No foreign keys, anywhere (since 0015)

`customer_id`/`sku_id` became non-unique once versioned, which breaks SQLite's requirement that an FK target column be unique — and D1 doesn't reliably support disabling FK enforcement mid-migration for a rebuild. Every cross-table reference (`nota.customer_id`, `nota_item.sku_id`, `nota_item.nota_id`, `payment.customer_id`, `nota.created_by`) is a plain unenforced integer column. Referential integrity is maintained by application code only. `nota`/`nota_item`/`payment` carry their own snapshot columns precisely so nothing downstream depends on these being real FKs.

## Adding a migration

New file in `migrations/`, numbered next (`0018_...sql`). Must be applied to `DB`, `DB_STAGING`, and (if touching auth) `USER_DB` separately — see root `CLAUDE.md` → "D1 migrations" for why Claude can't run `wrangler d1 execute/migrations apply --remote` itself.
