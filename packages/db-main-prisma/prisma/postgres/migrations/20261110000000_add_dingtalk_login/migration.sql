-- Login is explicitly enabled by an instance administrator per enterprise.
ALTER TABLE "directory_connection"
  ADD COLUMN "login_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "auto_provision" BOOLEAN NOT NULL DEFAULT false;
