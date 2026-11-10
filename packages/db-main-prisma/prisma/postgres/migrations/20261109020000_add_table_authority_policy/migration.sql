-- CreateTable
CREATE TABLE "table_authority_policy" (
    "base_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "modified_by" TEXT NOT NULL,
    "modified_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_authority_policy_pkey" PRIMARY KEY ("base_id")
);

-- CreateIndex
CREATE INDEX "table_authority_policy_connection_id_idx" ON "table_authority_policy"("connection_id");

-- AddForeignKey
ALTER TABLE "table_authority_policy" ADD CONSTRAINT "table_authority_policy_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "base"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_authority_policy" ADD CONSTRAINT "table_authority_policy_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "directory_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "table_authority_policy" ADD CONSTRAINT "table_authority_policy_revision_check" CHECK ("revision" > 0);
