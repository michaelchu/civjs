ALTER TABLE "players" ADD COLUMN "ai_level" varchar(20) DEFAULT 'easy' NOT NULL;
ALTER TABLE "players" ADD COLUMN "ai_traits" jsonb DEFAULT '{"expansionist":50,"trader":50,"aggressive":50,"builder":50}'::jsonb NOT NULL;
ALTER TABLE "players" ADD COLUMN "ai_state" jsonb DEFAULT '{}'::jsonb NOT NULL;
