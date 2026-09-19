CREATE UNIQUE INDEX IF NOT EXISTS "bid_workspaces_single_user_opportunity_uidx"
  ON "bid_workspaces" ("opportunity_id")
  WHERE "company_profile_id" IS NULL;
