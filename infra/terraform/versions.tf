# Provider requirements for the future GCP deployment.
# This configuration has never been applied — there is no GCP project yet.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}
