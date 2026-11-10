-- CreateTable
CREATE TABLE "directory_business_role" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rules" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directory_business_role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "directory_business_role_connection_id_name_key_key" ON "directory_business_role"("connection_id", "name_key");

-- CreateIndex
CREATE UNIQUE INDEX "directory_business_role_id_connection_id_key" ON "directory_business_role"("id", "connection_id");

-- AddForeignKey
ALTER TABLE "directory_business_role" ADD CONSTRAINT "directory_business_role_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "directory_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "directory_business_role" ADD CONSTRAINT "directory_business_role_version_check" CHECK ("version" > 0);
ALTER TABLE "directory_business_role" ADD CONSTRAINT "directory_business_role_rules_check"
  CHECK (jsonb_typeof("rules") = 'array' AND jsonb_array_length("rules") <= 100);
