CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"count" integer DEFAULT 0,
	"window_start" timestamp DEFAULT now(),
	"window_end" timestamp NOT NULL,
	"limit" integer NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "user_endpoint_window" UNIQUE("user_id","endpoint","window_start")
);
--> statement-breakpoint
CREATE TABLE "usage_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"date" timestamp DEFAULT now(),
	"messages_sent" integer DEFAULT 0,
	"messages_received" integer DEFAULT 0,
	"media_files_sent" integer DEFAULT 0,
	"session_duration" integer DEFAULT 0,
	"api_calls" integer DEFAULT 0,
	"errors" integer DEFAULT 0,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "whatsapp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"phone_number" varchar(20),
	"is_authenticated" boolean DEFAULT false,
	"is_active" boolean DEFAULT false,
	"strategy" varchar(50) DEFAULT 'business_hours',
	"last_activity" timestamp DEFAULT now(),
	"connection_attempts" integer DEFAULT 0,
	"qr_code_data" text,
	"session_data" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	CONSTRAINT "whatsapp_sessions_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "type" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "type" SET DEFAULT 'text';--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "status" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "status" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "file_name" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "system_logs" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "system_logs" ALTER COLUMN "level" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "to" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "message_id" varchar(255);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ack_status" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "file_path" varchar(500);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mime_type" varchar(100);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "template_data" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "retry_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "last_retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "system_logs" ADD COLUMN "service" varchar(100);--> statement-breakpoint
ALTER TABLE "system_logs" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "system_logs" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "system_logs" ADD COLUMN "timestamp" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "clinic_name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "clinic_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gmb_link" varchar(500);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "logo" varchar(500);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "primary_color" varchar(7) DEFAULT '#3b82f6';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "secondary_color" varchar(7) DEFAULT '#1e40af';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contact_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contact_email" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contact_whatsapp" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "languages" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_language" varchar(5) DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "enabled_features" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_types" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sheet_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_apps_script_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blueticks_api_key" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whatsapp_integration_available" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "max_sessions" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_preferences" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_stats" ADD CONSTRAINT "usage_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_stats" ADD CONSTRAINT "usage_stats_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limit_window_end_idx" ON "rate_limits" USING btree ("window_end");--> statement-breakpoint
CREATE INDEX "stats_user_id_idx" ON "usage_stats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stats_date_idx" ON "usage_stats" USING btree ("date");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "whatsapp_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_phone_idx" ON "whatsapp_sessions" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "session_active_idx" ON "whatsapp_sessions" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "msg_user_id_idx" ON "messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "msg_session_id_idx" ON "messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "msg_status_idx" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "msg_created_at_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "msg_message_id_idx" ON "messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "logs_level_idx" ON "system_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "logs_service_idx" ON "system_logs" USING btree ("service");--> statement-breakpoint
CREATE INDEX "logs_timestamp_idx" ON "system_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "logs_user_id_idx" ON "system_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "contact_email_idx" ON "users" USING btree ("contact_email");--> statement-breakpoint
CREATE INDEX "role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "whatsapp_available_idx" ON "users" USING btree ("whatsapp_integration_available");--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "phone_number";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "file_url";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "sample_id";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "sent_at";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "delivered_at";--> statement-breakpoint
ALTER TABLE "system_logs" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password";