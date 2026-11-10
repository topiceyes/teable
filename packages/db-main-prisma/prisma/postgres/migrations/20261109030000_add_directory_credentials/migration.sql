ALTER TABLE "directory_connection"
  ADD COLUMN "app_key" TEXT,
  ADD COLUMN "app_secret" TEXT,
  ADD COLUMN "configuration_version" INTEGER NOT NULL DEFAULT 0;
