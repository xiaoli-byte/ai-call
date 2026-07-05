CREATE TABLE "voice_clones" (
  "id" UUID NOT NULL,
  "voice_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "model" TEXT NOT NULL DEFAULT 'cosyvoice',
  "prompt_text" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'ready',
  "source_filename" TEXT NOT NULL,
  "source_mime_type" TEXT NOT NULL,
  "source_file_path" TEXT NOT NULL,
  "source_file_size" INTEGER NOT NULL,
  "preview_text" TEXT,
  "preview_file_path" TEXT,
  "preview_mime_type" TEXT,
  "preview_generated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voice_clones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voice_clones_voice_id_key" ON "voice_clones"("voice_id");
CREATE INDEX "voice_clones_status_updated_at_idx" ON "voice_clones"("status", "updated_at");
