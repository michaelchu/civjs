ALTER TABLE "games" ADD COLUMN "winner_player_id" uuid;
ALTER TABLE "games" ADD COLUMN "end_reason" varchar(30);
ALTER TABLE "games" ADD COLUMN "end_game_report" jsonb;
