ALTER TABLE "barbarian_tribes" DROP CONSTRAINT "barbarian_tribes_game_id_games_id_fk";
--> statement-breakpoint
ALTER TABLE "disasters" DROP CONSTRAINT "disasters_game_id_games_id_fk";
--> statement-breakpoint
ALTER TABLE "disasters" DROP CONSTRAINT "disasters_city_id_cities_id_fk";
--> statement-breakpoint
ALTER TABLE "random_events" DROP CONSTRAINT "random_events_game_id_games_id_fk";
--> statement-breakpoint
ALTER TABLE "barbarian_tribes" ADD CONSTRAINT "barbarian_tribes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "disasters" ADD CONSTRAINT "disasters_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "disasters" ADD CONSTRAINT "disasters_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "random_events" ADD CONSTRAINT "random_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
