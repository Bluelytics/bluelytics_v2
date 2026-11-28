-- iPhones that turned alerts on: the jobs Worker sends each alert to every token straight through
-- APNs (apps/jobs/src/apns.ts). Android devices subscribe to the FCM topic instead and are not here.
-- environment: 'production' (App Store, TestFlight) | 'sandbox' (development builds from Xcode).
CREATE TABLE apns_devices (
  token TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
