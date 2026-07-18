variable "project_id" {
  description = "GCP project id for this environment"
  type        = string
}

variable "region" {
  description = "Primary region (EU residency — see docs/deployment/GCP_DEPLOYMENT.md)"
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

variable "api_image" {
  description = "Full image ref for the api service (set by the deploy pipeline after the first push)"
  type        = string
  default     = ""
}

variable "worker_image" {
  description = "Full image ref for the worker service"
  type        = string
  default     = ""
}

variable "web_image" {
  description = "Full image ref for the web service"
  type        = string
  default     = ""
}

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-custom-1-3840"
}

variable "min_instances" {
  description = "Minimum instances for web/api (worker always keeps 1)"
  type        = number
  default     = 0
}

variable "cors_allowed_origins" {
  description = "Comma-separated allowed origins for the API CORS allowlist"
  type        = string
  default     = ""
}

variable "ai_monthly_cost_cap_usd" {
  description = "Hard monthly AI budget per organization"
  type        = number
  default     = 50
}
