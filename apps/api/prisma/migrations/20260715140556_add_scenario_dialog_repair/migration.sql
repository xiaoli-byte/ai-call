-- AlterTable
ALTER TABLE "outbound_scenarios" ADD COLUMN     "dialog_repair" JSONB NOT NULL DEFAULT '{}';
