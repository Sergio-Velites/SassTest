# FlowHub AI — production environment.
# Usage: terraform init && terraform plan (see ../../README.md).

terraform {
  required_version = ">= 1.9.0"
  # State bucket is created out-of-band (see README). Uncomment after creating it:
  # backend "gcs" {
  #   bucket = "flowhub-terraform-state"
  #   prefix = "production"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

module "stack" {
  source = "../../modules/stack"

  project_id           = var.project_id
  region               = var.region
  environment          = "production"
  github_repository    = var.github_repository
  min_instances        = 1
  db_tier              = "db-custom-2-7680"
  cors_allowed_origins = var.cors_allowed_origins
}

output "api_url" {
  value = module.stack.api_url
}

output "web_url" {
  value = module.stack.web_url
}

output "artifact_registry" {
  value = module.stack.artifact_registry
}

output "workload_identity_provider" {
  value = module.stack.workload_identity_provider
}

output "deploy_service_account" {
  value = module.stack.deploy_service_account
}
