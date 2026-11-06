# D1 Schema

3 D1 databases, one Worker (`wrangler.toml` bindings):

| Binding | Database | Purpose |
|---|---|---|
| `DB` | `rds_factory_management` | Production business data |
| `DB_STAGING` | `staging_rds_factory_management` | Full clone of `DB`, super_admin-only toggle (`X-Db-Target: staging` header, gated by `session.role === 'super_admin'` in `src/index.ts`) |
| `USER_DB` | `user_accounts` | Auth only. Unaffected by the staging toggle — always production. |

R2 bucket: binding `ASSETS`, bucket `rds-factory-management-assets` (PDF cache, uploaded evidence/logos).

Source of truth: `migrations/0001_init.sql` through `migrations/0021_nota_notes.sql`. This doc describes the schema as of `0021`, after the `0015` versioning rewrite.

## `USER_DB` (`user_accounts`)

### `user`
| Column | Type | Notes |
|---|---|---|
| `user_id` | INTEGER PK AUTOINCREMENT | |
| `username` | TEXT NOT NULL UNIQUE | |
| `name` | TEXT NOT NULL | |
| `password_hash` | TEXT NOT NULL | bcrypt |
| `role` | TEXT NOT NULL | `super_admin` gates the staging-DB toggle |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | |
| `created_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

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
| `updated_by` | TEXT | |
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
| `updated_by` | TEXT | |
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
| `created_by` | INTEGER NOT NULL | 0001, unenforced (was FK to `user`, now dangling — auth moved to `USER_DB`) |
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

### `product_stock`
Cached current balance per SKU, not versioned (one row per `sku_id` forever — product price/name edits never touch it). Entirely trigger-maintained; no application code writes to it.

| Column | Type | Notes |
|---|---|---|
| `sku_id` | INTEGER PRIMARY KEY | |
| `current_stock` | REAL NOT NULL DEFAULT 0 | |
| `updated_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

### `stock_ledger`
Append-only record of every staff-reported stock movement (not sales — a sale's debit comes straight from `nota_item`, see triggers below, so it isn't duplicated here).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `sku_id` | INTEGER NOT NULL | unenforced |
| `date` | TEXT NOT NULL | business date of the event |
| `movement_type` | TEXT NOT NULL | `CHECK IN ('stock_input', 'stock_loss', 'adjustment')` |
| `qty` | REAL NOT NULL | signed. `CHECK`: `stock_input` must be `> 0`, `stock_loss` must be `< 0`, `adjustment` can be either |
| `note` | TEXT | reason (damage, recount, PO ref, etc.) |
| `created_by` | TEXT | username |
| `created_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

Index: `idx_stock_ledger_sku (sku_id)`.

### Stock triggers (0019)
All stock bookkeeping happens in the database, not application code — one invariant, enforced regardless of which code path writes the row:

- `trg_product_seed_stock` — `AFTER INSERT ON product`, `INSERT OR IGNORE INTO product_stock`. Only the first INSERT for a given `sku_id` creates the row; later version rows from an edit are no-ops here.
- `trg_stock_ledger_apply` — `AFTER INSERT ON stock_ledger`, applies `qty` to `product_stock.current_stock`.
- `trg_nota_item_debit_stock` — `AFTER INSERT ON nota_item`, debits `product_stock.current_stock` by the item's `qty`.
- `trg_nota_void_restock` — `AFTER UPDATE OF is_void ON nota WHEN NEW.is_void = 1 AND OLD.is_void = 0`, credits back every one of that nota's items. One-way only — there's no un-void flow to handle the reverse.

**Caveat:** if `product` or `nota_item` ever needs a 0015-style rebuild (`DROP`+recreate rather than a plain `ALTER TABLE ADD COLUMN`), these triggers must be dropped first and recreated after, or the rebuild silently drops them.

## No foreign keys, anywhere (since 0015)

`customer_id`/`sku_id` became non-unique once versioned, which breaks SQLite's requirement that an FK target column be unique — and D1 doesn't reliably support disabling FK enforcement mid-migration for a rebuild. Every cross-table reference (`nota.customer_id`, `nota_item.sku_id`, `nota_item.nota_id`, `payment.customer_id`, `nota.created_by`) is a plain unenforced integer column. Referential integrity is maintained by application code only. `nota`/`nota_item`/`payment` carry their own snapshot columns precisely so nothing downstream depends on these being real FKs.

## Adding a migration

New file in `migrations/`, numbered next (`0018_...sql`). Must be applied to `DB`, `DB_STAGING`, and (if touching auth) `USER_DB` separately — see root `CLAUDE.md` → "D1 migrations" for why Claude can't run `wrangler d1 execute/migrations apply --remote` itself.
