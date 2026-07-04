# Common variables for FlowHub AI infrastructure.
# Values are provided per-environment in environments/<env>/terraform.tfvars
# (never committed — see .gitignore).

variable "project_id" {
  description = "GCP project id (separate project per environment, e.g. flowhub-staging)"
  type        = string
}

variable "region" {
  description = "Primary region. EU residency requirement — see docs/deployment/GCP_DEPLOYMENT.md"
  type        = string
  default     = "europe-west1"
}

variable "environment" {
  description = "Environment name: staging | production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "github_repository" {
  description = "GitHub repo (owner/name) allowed to deploy via Workload Identity Federation"
  type        = string
}

# Planned resources (implemented as modules when deployment happens):
# - google_artifact_registry_repository (docker images)
# - google_sql_database_instance (PostgreSQL 16, private IP)
# - google_redis_instance (Memorystore, while BullMQ remains)
# - google_cloud_run_v2_service x3 (web, api, worker)
# - google_secret_manager_secret (runtime secrets)
# - google_service_account x4 (web, api, worker, deploy) with least-privilege IAM
# - google_iam_workload_identity_pool + provider (GitHub OIDC — no JSON keys)
# - google_storage_bucket (documents; terraform state bucket created out-of-band)
