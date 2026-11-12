CREATE TABLE "directory_role_history" (
  "id" TEXT NOT NULL,
  "role_id" TEXT NOT NULL,
  "actor_id" TEXT,
  "actor_name" TEXT,
  "before" JSONB,
  "after" JSONB NOT NULL,
  "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "directory_role_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "directory_role_history_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "directory_business_role"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "directory_role_history_role_id_created_time_id_idx" ON "directory_role_history"("role_id", "created_time", "id");
