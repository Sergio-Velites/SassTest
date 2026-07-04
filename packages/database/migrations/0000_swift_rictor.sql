CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_execution_id" uuid,
	"step_id" uuid,
	"prompt_template_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"status" text NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_calls_provider_check" CHECK ("ai_calls"."provider" IN ('mock', 'openai', 'anthropic', 'gemini')),
	CONSTRAINT "ai_calls_status_check" CHECK ("ai_calls"."status" IN ('succeeded', 'failed', 'schema_mismatch'))
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"output_schema" jsonb,
	"model_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"metadata" jsonb,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_quantity_check" CHECK ("usage_events"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" IN ('draft', 'issued', 'paid', 'void'))
);
--> statement-breakpoint
CREATE TABLE "marketplace_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"commission_cents" integer DEFAULT 0 NOT NULL,
	"net_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_payouts_status_check" CHECK ("marketplace_payouts"."status" IN ('pending', 'paid'))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_slug_check" CHECK ("plans"."slug" IN ('free', 'starter', 'pro', 'business', 'enterprise'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" IN ('active', 'trialing', 'past_due', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"billing_type" text DEFAULT 'one_time' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"rating_avg" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_listings_billing_type_check" CHECK ("marketplace_listings"."billing_type" IN ('one_time', 'subscription')),
	CONSTRAINT "marketplace_listings_status_check" CHECK ("marketplace_listings"."status" IN ('inactive', 'active', 'suspended')),
	CONSTRAINT "marketplace_listings_price_check" CHECK ("marketplace_listings"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"version" text NOT NULL,
	"definition" jsonb NOT NULL,
	"changelog" text,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workflow_templates_category_check" CHECK ("workflow_templates"."category" IN ('finance', 'hr', 'sales', 'support', 'ops', 'other')),
	CONSTRAINT "workflow_templates_status_check" CHECK ("workflow_templates"."status" IN ('draft', 'private', 'published', 'deprecated'))
);
--> statement-breakpoint
CREATE TABLE "connector_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connector_slug" text NOT NULL,
	"name" text NOT NULL,
	"auth_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "connector_accounts_auth_type_check" CHECK ("connector_accounts"."auth_type" IN ('none', 'api_key', 'oauth2')),
	CONSTRAINT "connector_accounts_status_check" CHECK ("connector_accounts"."status" IN ('active', 'revoked', 'error'))
);
--> statement-breakpoint
CREATE TABLE "connector_secrets_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connector_account_id" uuid NOT NULL,
	"secret_ref" text NOT NULL,
	"kind" text NOT NULL,
	"rotated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_secrets_metadata_kind_check" CHECK ("connector_secrets_metadata"."kind" IN ('api_key', 'oauth_tokens'))
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_execution_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"payload" jsonb,
	"required_role" text DEFAULT 'member' NOT NULL,
	"assignee_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_comment" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_status_check" CHECK ("approval_requests"."status" IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
	CONSTRAINT "approval_requests_role_check" CHECK ("approval_requests"."required_role" IN ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_execution_id" uuid NOT NULL,
	"step_id" uuid,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_execution_logs_level_check" CHECK ("workflow_execution_logs"."level" IN ('debug', 'info', 'warn', 'error'))
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_execution_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_execution_steps_status_check" CHECK ("workflow_execution_steps"."status" IN ('pending', 'running', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"installed_workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger_type" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_node_id" text,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_executions_status_check" CHECK ("workflow_executions"."status" IN ('pending', 'running', 'waiting', 'waiting_approval', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "workflow_executions_trigger_check" CHECK ("workflow_executions"."trigger_type" IN ('manual', 'webhook', 'schedule'))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" IN ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_role_check" CHECK ("organization_members"."role" IN ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" "citext" NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_plan_check" CHECK ("organizations"."plan" IN ('free', 'starter', 'pro', 'business', 'enterprise'))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "installed_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_template_version_id" uuid,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "installed_workflows_status_check" CHECK ("installed_workflows"."status" IN ('active', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "workflow_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"from_node_id" text NOT NULL,
	"to_node_id" text NOT NULL,
	"branch" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_nodes_kind_check" CHECK ("workflow_nodes"."kind" IN ('trigger', 'action', 'condition', 'ai', 'approval', 'wait', 'transform'))
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"installed_workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_step_id_workflow_execution_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."workflow_execution_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_prompt_template_id_ai_prompt_templates_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."ai_prompt_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_payouts" ADD CONSTRAINT "marketplace_payouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_slug_plans_slug_fk" FOREIGN KEY ("plan_slug") REFERENCES "public"."plans"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_accounts" ADD CONSTRAINT "connector_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_accounts" ADD CONSTRAINT "connector_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_secrets_metadata" ADD CONSTRAINT "connector_secrets_metadata_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_secrets_metadata" ADD CONSTRAINT "connector_secrets_metadata_connector_account_id_connector_accounts_id_fk" FOREIGN KEY ("connector_account_id") REFERENCES "public"."connector_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_step_id_workflow_execution_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."workflow_execution_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_steps" ADD CONSTRAINT "workflow_execution_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_steps" ADD CONSTRAINT "workflow_execution_steps_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_installed_workflow_id_installed_workflows_id_fk" FOREIGN KEY ("installed_workflow_id") REFERENCES "public"."installed_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_workflows" ADD CONSTRAINT "installed_workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_workflows" ADD CONSTRAINT "installed_workflows_workflow_template_version_id_workflow_template_versions_id_fk" FOREIGN KEY ("workflow_template_version_id") REFERENCES "public"."workflow_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_workflows" ADD CONSTRAINT "installed_workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_installed_workflow_id_installed_workflows_id_fk" FOREIGN KEY ("installed_workflow_id") REFERENCES "public"."installed_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_org_created_idx" ON "ai_calls" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_templates_unique" ON "ai_prompt_templates" USING btree ("organization_id","slug","version");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_action_idx" ON "audit_logs" USING btree ("organization_id","action");--> statement-breakpoint
CREATE INDEX "usage_events_billing_idx" ON "usage_events" USING btree ("organization_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "invoices_org_idx" ON "invoices" USING btree ("organization_id","period_start");--> statement-breakpoint
CREATE INDEX "marketplace_payouts_org_idx" ON "marketplace_payouts" USING btree ("organization_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_unique" ON "subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_listings_template_unique" ON "marketplace_listings" USING btree ("workflow_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_versions_unique" ON "workflow_template_versions" USING btree ("workflow_template_id","version");--> statement-breakpoint
CREATE INDEX "workflow_templates_org_status_idx" ON "workflow_templates" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "workflow_templates_catalog_idx" ON "workflow_templates" USING btree ("status","category");--> statement-breakpoint
CREATE INDEX "connector_accounts_org_slug_idx" ON "connector_accounts" USING btree ("organization_id","connector_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_secrets_metadata_unique" ON "connector_secrets_metadata" USING btree ("connector_account_id","kind");--> statement-breakpoint
CREATE INDEX "approval_requests_org_status_idx" ON "approval_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "approval_requests_assignee_idx" ON "approval_requests" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_exec_idx" ON "workflow_execution_logs" USING btree ("workflow_execution_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_execution_steps_unique" ON "workflow_execution_steps" USING btree ("workflow_execution_id","node_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_steps_org_exec_idx" ON "workflow_execution_steps" USING btree ("organization_id","workflow_execution_id");--> statement-breakpoint
CREATE INDEX "workflow_executions_org_wf_idx" ON "workflow_executions" USING btree ("organization_id","installed_workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_executions_org_status_idx" ON "workflow_executions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_email_idx" ON "invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_unique" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_name_unique" ON "roles" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "installed_workflows_org_status_idx" ON "installed_workflows" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "workflow_edges_version_idx" ON "workflow_edges" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_nodes_unique" ON "workflow_nodes" USING btree ("workflow_version_id","node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_unique" ON "workflow_versions" USING btree ("installed_workflow_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_current_unique" ON "workflow_versions" USING btree ("installed_workflow_id") WHERE "workflow_versions"."is_current" = true;