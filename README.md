# TableSpace — DbWebTools

A responsive MariaDB record-management workspace with a separate **ASP.NET Core 9 API** and **React 19 + TypeScript + Vite frontend**.

## Features

- Discover existing MariaDB tables without modifying their schema; browse, search, sort, and paginate records.
- Create, update, and delete with parameterized values, schema-validated identifiers, composite primary keys, and optimistic concurrency checks.
- Users, administrator/member roles, disable accounts, reset passwords, and revoke active sessions on account changes.
- Multiple database connections with encrypted passwords, connection testing, verified TLS by default.
- Deny-by-default per-user, per-table read/create/update/delete permissions enforced by the API.
- Visual editing layouts: field labels, sections, order, Date/DateTime controls, keyed text dropdowns, hidden/read-only fields.
- Configurable related-table lookups: searchable selection dialogs, friendly labels, and key-only storage.
- Recent record-change activity without recording sensitive field values.
- Responsive interface, keyboard-accessible dialogs, loading states, inline errors, and deletion confirmation.

## Quick start

Install .NET SDK 9 and Node.js 22.12+ (or Node 24).

```bash
cp .env.example .env
# Edit .env locally and set a unique BOOTSTRAP_PASSWORD (14+ characters).
# For localhost HTTP testing ONLY, set APP_ENVIRONMENT=Development.
docker compose up --build
```

Open **http://localhost:8080** for local development. Sign in as `admin` with your configured bootstrap password. Add a connection in **Administration → Connections**; choose the database server hostname reachable from the API container (not `localhost` unless the DB runs in that container). Then browse records or configure users, table access, and editor layouts.

For production, keep `APP_ENVIRONMENT=Production` and terminate HTTPS at a trusted reverse proxy in front of the loopback-bound web port. Production authentication cookies require HTTPS. Do not publish the API directly to the Internet. Back up the `app-data` volume, including encryption keys, and restrict access to it. Bootstrap settings are only used when there are no users; remove the bootstrap password after provisioning.

### Development without Docker

Supply `Bootstrap__Password` through your local environment or .NET user-secrets; do not commit it.

```bash
# Terminal 1 (after setting the bootstrap password locally)
ASPNETCORE_ENVIRONMENT=Development dotnet run --project backend/DbWeb.Api --no-launch-profile --urls http://localhost:5188
# Terminal 2
cd frontend
npm ci
npm run dev
```

Open the Vite URL. Vite proxies `/api` to port 5188, so browser API access stays same-origin. There is intentionally no permissive CORS policy.

## Related-table lookups

1. Open **Administration → Editor layouts**, select the connection and source table, and change the relation column's control to **lookup**.
2. In its relation configuration, select the **Related table**, **Stored key**, **Display value**, and optional **Additional search columns**. Save the layout.
3. In the record editor, click **Choose…** to open the record-selection window. Search matches the key, display column, and selected extra columns. Select a row to populate the relation; only its key is saved to MariaDB.

For example, configure `orders.customer_id` to look up `customers.id`, display `customers.name`, and search `customers.email`. The grid and editor show the customer's name; the editor also shows the stored key for disambiguation. Existing relations resolve automatically. Cancel leaves the original selection intact; **Clear** stores NULL for nullable columns. Results are paginated and searchable, and large integer keys retain their exact precision.

Lookups target tables in the **same configured database connection** and require a non-null **single-column primary or unique key** with a compatible source type. Composite-key lookups and multi-column relation mappings are not supported. Existing composite-key CRUD is unchanged. Configuration is stored in existing layout JSON; no application-data migration is required.

Users need **read permission on both source and related tables** to search or resolve related values, plus the usual source create/update permission to save. Without target read access, the grid retains the source key but never exposes related values. Invalid or missing selections are rejected by the API. Layouts do not create or alter database foreign-key constraints: keep actual foreign keys for transactional referential integrity, including changes made outside this application. Search treats `%` and `_` literally; it never executes user SQL.

## List fields and read-only joined fields

In **Administration → Editor layouts**, use **Show in list** to select record-list columns and **List order** to order them. The field label is also used as the list heading. These settings are independent of **Hide in editor** and editor **Order**. Existing layouts without list settings keep all columns visible. Hidden primary keys remain available internally for correct editing/deletion. Selecting no list fields shows an explicit empty-column notice, without changing data access permissions.

Choose **Add joined field** to display a value from another table without adding a physical database column. Configure:

1. **Local key column**, for example `orders.customer_id`.
2. **Related table** and **Related unique key**, for example `customers.id`.
3. **Displayed value**, for example `customers.email`.
4. A label such as *Customer email*, editor visibility/order, and list visibility/order.

Joined fields are always read-only. They are available in the record editor and optionally the list, refresh when the local key changes (including lookup selections), and are never sent as stored values. The API rejects attempts to write virtual joined fields. A missing match or NULL local key displays NULL; without related-table read permission the value displays **Unavailable**, and no related data is returned.

Joins use existing tables in the **same connection**, a compatible local column and a non-null **single-column primary/unique target key**. Up to 20 virtual joined fields are supported per layout. Multiple fields may display different values from the same related row. One-to-many joins, composite join keys, join chains, custom SQL expressions, and joined-field sorting/searching are not supported. Source rows are paginated first; bounded LEFT JOIN queries resolve their related values without dropping or duplicating records. Source concurrency versions depend only on source data, not related display values.

List settings and joins are stored in existing layout JSON. No schema migration is required. List/editor visibility is presentation configuration, **not column-level security**; existing table permissions still govern access.

## Dates, timestamps, and dropdowns

In **Administration → Editor layouts**, use these controls:

- **Auto** selects Date for MariaDB `DATE` columns and DateTime for `DATETIME`/`TIMESTAMP` columns.
- **Date** is available for all three temporal types. Changing a Date control on a `DATETIME`/`TIMESTAMP` stores the selected day at midnight. Simply opening or saving an unchanged field does not discard its original time.
- **DateTime** is available for `DATETIME` and `TIMESTAMP`, with date, time, seconds, and milliseconds. Times are displayed and submitted in the database session timezone, without browser timezone conversion. MariaDB continues to apply its normal TIMESTAMP timezone behavior. Untouched values keep their full database precision, including microseconds; editing with the native picker uses millisecond precision. Choose Text when exact manual microsecond input is needed.
- **Dropdown** is available for text columns. Add key/display pairs beneath the layout table (for example `draft` → `Draft document`, `ready` → `Ready to publish`). Each key and each display label must be unique within that dropdown, ignoring case. Define 1–200 options, with non-blank keys/labels of up to 256 characters and no surrounding whitespace. Save the layout.

Dropdowns display labels in both the editor and record grid, while only keys are stored in MariaDB. Unknown submitted keys and duplicate configuration entries are rejected by the API. Existing values removed from the option list remain visible as unconfigured values and are not silently rewritten; choose a configured replacement to change them. Nullable fields can be cleared, and untouched fields on new records retain database defaults. Updating a record submits only changed fields, preserving unrelated timestamps and allowing database `ON UPDATE` behavior to operate normally.

These settings use the existing layout JSON in `/var/lib/dbwebtools/app.db` on the hosted instance; no MariaDB schema changes or application metadata migrations are required.

## Build and test

```bash
./scripts/build.sh
# Windows:
./scripts/build.ps1
```

The scripts restore locked dependencies, build with warnings as errors, run backend and frontend tests, and publish independent artifacts into `artifacts/api` and `artifacts/web`.

To exercise real MariaDB CRUD locally, set `MARIADB_TEST_CONNECTION` to a connection string for a **disposable test database**, then run the script. The integration tests create and drop only randomly named test tables. CI always requires and runs this test against a MariaDB service. Without this environment variable, local runs do not exercise the database integration scenario.

## Architecture

```text
frontend/                React/TypeScript SPA, editor, administration, nginx image
backend/DbWeb.Api/        HTTP API, authentication/authorization, application metadata
  Models.cs              EF Core SQLite application metadata (never target data)
  DatabaseService.cs     MariaDB schema inspection and transactional record operations
  Program.cs             Composition root and authenticated endpoint mappings
tests/DbWeb.Tests/        HTTP security tests and real MariaDB integration test
scripts/                 Bash and PowerShell build entrypoints
.github/workflows/       PR validation, release artifacts, container publication
```

Authentication uses PBKDF2 password hashing through ASP.NET Core PasswordHasher, HTTP-only SameSite cookies, antiforgery tokens on all API mutations (including login), and login rate limiting. Passwords for target databases use ASP.NET Core Data Protection. Only administrators may configure target hosts; deploy with network egress restricted to intended database servers. Use dedicated least-privilege database accounts with only the required SELECT/INSERT/UPDATE/DELETE privileges.

Table names and column identifiers are validated against `information_schema` and safely quoted. Values are parameters. Updates/deletes require the full primary key and a record version checked inside a transaction with `SELECT ... FOR UPDATE`. Tables without primary keys are read-only; views are not exposed. Large integer and decimal values are transported as strings to preserve precision; binary values use base64. Defaulted fields omitted from create requests retain their database default.

Layouts are presentation settings, **not column-level security**. Table grants protect all columns in a table. MariaDB transactional tables (InnoDB) are required for reliable concurrency guarantees. Foreign keys and database constraints are enforced by MariaDB; schema editing and file attachments are outside this release. Application metadata currently uses a single SQLite instance; scale the application as a single replica and use migrations before evolving its schema. The activity log and target database are separate stores, not a distributed atomic audit ledger.

## CI/CD and contributing

Every pull request runs release builds, backend authorization/CSRF tests, frontend editor tests, and real MariaDB CRUD/concurrency validation. Successful builds upload separate deployment artifacts. Every PR also validates both container builds. A version tag (`v*`) validates first, then builds and publishes commit-SHA-tagged API/web images to GitHub Container Registry. No external production deployment target is assumed.

Use feature branches and pull requests for subsequent changes; never commit credentials or application data. Configure branch protection to require the `validate` job before merging.

### Required fields

In **Administration → Editor layouts**, check **Required** for fields that must be filled and save the layout. Required fields are marked in the record editor. NULL, missing values, empty strings, and whitespace-only strings are rejected; zero and false are valid. The API enforces the rule as well as the form. On updates, it checks submitted values together with the locked current record, so an unchanged empty required field must be repaired before other edits can be saved. Deletes are unaffected.

Required fields must be visible, editable stored columns; generated, auto-increment, hidden, read-only, and joined fields cannot be marked required. Hiding a field or marking it read-only clears its Required option. On creation, a required value must be supplied explicitly, even if the database defines a default. Existing layouts default to not required; database NOT NULL constraints still apply. Configuration is stored in existing layout JSON, without schema changes.

### Labels, default sorting, and list filters

In **Administration → Editor layouts**, choose a connection/table:

- Set **Field label** for friendly names in list headings, editing forms, and filter controls. Empty labels fall back to column names. Labels do not rename database columns.
- Set **List title** to replace the table name above the record list (optional).
- Choose a **Default sort column** and **Ascending/Descending** direction. Primary keys are added as tie-breakers for stable pagination. Users can temporarily sort by clicking a list heading, then click **Use default sorting** to restore the saved order.
- Click **Add filter**, select a stored field, condition, and value. Use **All criteria (AND)** or **Any criterion (OR)**. Save the layout. Up to 20 criteria are supported. Filter and sort columns can be hidden from the list, but cannot be virtual joined fields.

Filters are enforced on the records API before counting and pagination; free-text search is combined with the saved criteria, never substituted for them. The list displays its active filter. Create/update operations can produce records outside the current view; those records will disappear from that list after saving. Filters are list configuration, **not row-level security**, and do not constrain lookup selectors or change existing table permissions.

Conditions include equals/not-equals, greater/less than (inclusive or exclusive), text contains/starts-with, and IS NULL/IS NOT NULL. Text matching follows MariaDB column collation; contains/starts-with values treat `%` and `_` literally. Empty text and NULL are distinct. Not-equals excludes NULL rows; use an OR with IS NULL to include them. Relation filters use stored keys; configured text dropdowns offer display labels while storing the option key. Dates use database-session values without timezone conversion. Numeric filters preserve integer/decimal precision (up to 65 digits and 30 decimal places).

Settings remain in `RecordLayout.FieldsJson` in the existing application SQLite database. Existing array-shaped layouts are read without migration. The layout PUT endpoint accepts `{ "fields": [...], "view": { "label": "Open orders", "sort": "id", "descending": true, "match": "all", "filters": [{ "column": "status", "operator": "eq", "value": "open" }] } }`; legacy field-array writes preserve saved view settings. The settings GET endpoint returns `fields`, `view`, and `grant`. Set `view` to `{}` to clear list settings.
