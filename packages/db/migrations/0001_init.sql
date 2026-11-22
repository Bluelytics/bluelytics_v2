-- bluelytics v2 initial schema (docs/ARCHITECTURE.md §5).
-- Money is stored as integers: *_cents = centavos, buy/sell/euro_* = whole pesos, value_hundredths = 1/100 units.
-- Instants are UTC ISO-8601 text ending in Z with at least millisecond digits; days are YYYY-MM-DD Argentine dates.

-- One row per source per run, successes and failures.
CREATE TABLE observations (
  id INTEGER PRIMARY KEY,
  run_at TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL,
  buy_cents INTEGER,
  sell_cents INTEGER,
  source_ts TEXT,
  error TEXT,
  duration_ms INTEGER
);
CREATE INDEX observations_source_run ON observations (source, run_at DESC);
CREATE INDEX observations_run ON observations (run_at);

-- One row per run inside the trading window; voters is JSON {"blue":[...],"oficial":[...]}.
CREATE TABLE ticks (
  run_at TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  blue_buy INTEGER NOT NULL,
  blue_sell INTEGER NOT NULL,
  blue_buy_raw REAL,
  blue_sell_raw REAL,
  oficial_buy INTEGER NOT NULL,
  oficial_sell INTEGER NOT NULL,
  oficial_buy_raw REAL,
  oficial_sell_raw REAL,
  voters TEXT NOT NULL,
  changed INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX ticks_day ON ticks (day, run_at);

CREATE TABLE latest_rates (
  tipo TEXT PRIMARY KEY CHECK (tipo IN ('oficial', 'blue')),
  updated_at TEXT NOT NULL,
  buy INTEGER NOT NULL,
  sell INTEGER NOT NULL,
  buy_raw REAL NOT NULL,
  sell_raw REAL NOT NULL,
  euro_buy INTEGER NOT NULL,
  euro_sell INTEGER NOT NULL
) WITHOUT ROWID;

-- origin: 'backfill_api' (imported from the legacy API) | 'live'.
CREATE TABLE daily_rates (
  day TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('Oficial', 'Blue')),
  buy INTEGER NOT NULL,
  sell INTEGER NOT NULL,
  updated_at TEXT,
  origin TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (day, tipo)
) WITHOUT ROWID;

-- MEP, CCL, cripto, mayorista, tarjeta… (site only, not in the API).
CREATE TABLE extra_rates (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  buy_cents INTEGER,
  sell_cents INTEGER,
  source TEXT NOT NULL,
  source_ts TEXT,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  value_hundredths INTEGER,
  value_date TEXT,
  position INTEGER NOT NULL
) WITHOUT ROWID;

-- id continues the legacy alertas_dolar sequence (seeded with the last two legacy alerts).
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_at TEXT NOT NULL,
  buy INTEGER NOT NULL,
  sell INTEGER NOT NULL,
  push_status TEXT
);

-- status: 'pending' (claimed before calling Buffer) | 'sent' | 'failed' | 'dry_run'.
CREATE TABLE social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  buy INTEGER,
  sell INTEGER,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  external_id TEXT,
  image_key TEXT,
  error TEXT,
  UNIQUE (network, event_key)
);

-- Pre-rendered API bodies; key in ('latest', 'last_price', 'alerts', 'currency', 'evolution_json', 'evolution_csv').
CREATE TABLE rendered (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  body TEXT NOT NULL,
  etag TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
