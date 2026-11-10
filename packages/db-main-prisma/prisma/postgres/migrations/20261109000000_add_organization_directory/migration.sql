-- CreateTable
CREATE TABLE "directory_connection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directory_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_department" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "parent_external_id" TEXT,
    "name" TEXT NOT NULL,
    "inactive_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directory_department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_member" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "union_id" TEXT,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "external_role_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inactive_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directory_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_membership" (
    "connection_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,

    CONSTRAINT "directory_membership_pkey" PRIMARY KEY ("member_id","department_id")
);

-- CreateTable
CREATE TABLE "directory_sync_run" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_time" TIMESTAMP(3),
    "department_count" INTEGER NOT NULL DEFAULT 0,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,

    CONSTRAINT "directory_sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "directory_connection_provider_tenant_id_key" ON "directory_connection"("provider", "tenant_id");

-- CreateIndex
CREATE INDEX "directory_department_connection_id_parent_external_id_idx" ON "directory_department"("connection_id", "parent_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "directory_department_connection_id_external_id_key" ON "directory_department"("connection_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "directory_department_id_connection_id_key" ON "directory_department"("id", "connection_id");

-- CreateIndex
CREATE INDEX "directory_member_user_id_idx" ON "directory_member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "directory_member_connection_id_external_id_key" ON "directory_member"("connection_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "directory_member_connection_id_user_id_key" ON "directory_member"("connection_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "directory_member_id_connection_id_key" ON "directory_member"("id", "connection_id");

-- CreateIndex
CREATE INDEX "directory_membership_department_id_connection_id_idx" ON "directory_membership"("department_id", "connection_id");

-- CreateIndex
CREATE INDEX "directory_sync_run_connection_id_started_time_idx" ON "directory_sync_run"("connection_id", "started_time");

-- AddForeignKey
ALTER TABLE "directory_department" ADD CONSTRAINT "directory_department_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "directory_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_member" ADD CONSTRAINT "directory_member_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "directory_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_member" ADD CONSTRAINT "directory_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_membership" ADD CONSTRAINT "directory_membership_member_id_connection_id_fkey" FOREIGN KEY ("member_id", "connection_id") REFERENCES "directory_member"("id", "connection_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_membership" ADD CONSTRAINT "directory_membership_department_id_connection_id_fkey" FOREIGN KEY ("department_id", "connection_id") REFERENCES "directory_department"("id", "connection_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_sync_run" ADD CONSTRAINT "directory_sync_run_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "directory_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
