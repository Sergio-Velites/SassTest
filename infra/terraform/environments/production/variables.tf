variable "project_id" {
  description = "GCP project id for production"
  type        = string
}

variable "region" {
  description = "Primary region"
  type        = string
  default     = "europe-west1"
}

variable "github_repository" {
  description = "owner/repo allowed to deploy via WIF"
  type        = string
  default     = "Sergio-Velites/SassTest"
}

variable "cors_allowed_origins" {
  description = "Comma-separated allowed origins for the API"
  type        = string
  default     = ""
}
