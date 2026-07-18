output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "artifact_registry" {
  description = "Docker repo base path for image pushes"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "workload_identity_provider" {
  description = "Set as GCP_WIF_PROVIDER in GitHub (repo variable)"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_service_account" {
  description = "Set as GCP_DEPLOY_SA in GitHub (repo variable)"
  value       = google_service_account.deploy.email
}
