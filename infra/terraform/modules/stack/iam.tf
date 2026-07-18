# One service account per service, least privilege (SECURITY_MODEL / ADR-0008).

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "flowhub-api"
  display_name = "FlowHub API runtime"
}

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "flowhub-worker"
  display_name = "FlowHub worker runtime"
}

resource "google_service_account" "web" {
  project      = var.project_id
  account_id   = "flowhub-web"
  display_name = "FlowHub web runtime"
}

resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "flowhub-deploy"
  display_name = "FlowHub CI deployer (GitHub Actions via WIF)"
}

locals {
  runtime_secret_readers = {
    "api-session"      = { secret = google_secret_manager_secret.auth_session_secret.secret_id, member = google_service_account.api.member }
    "api-db"           = { secret = google_secret_manager_secret.database_url.secret_id, member = google_service_account.api.member }
    "worker-db"        = { secret = google_secret_manager_secret.database_url.secret_id, member = google_service_account.worker.member }
    "worker-openai"    = { secret = google_secret_manager_secret.ai_keys["openai-api-key"].secret_id, member = google_service_account.worker.member }
    "worker-anthropic" = { secret = google_secret_manager_secret.ai_keys["anthropic-api-key"].secret_id, member = google_service_account.worker.member }
  }
}

resource "google_secret_manager_secret_iam_member" "readers" {
  for_each  = local.runtime_secret_readers
  project   = var.project_id
  secret_id = each.value.secret
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}

resource "google_project_iam_member" "sql_clients" {
  for_each = {
    api    = google_service_account.api.member
    worker = google_service_account.worker.member
    deploy = google_service_account.deploy.member # migration job
  }
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = each.value
}

# Deployer: push images, roll Cloud Run revisions, run the migration job,
# and impersonate ONLY the runtime service accounts.
resource "google_project_iam_member" "deploy_roles" {
  for_each = toset([
    "roles/run.developer",
    "roles/artifactregistry.writer",
  ])
  project = var.project_id
  role    = each.value
  member  = google_service_account.deploy.member
}

resource "google_service_account_iam_member" "deploy_impersonates_runtimes" {
  for_each = {
    api    = google_service_account.api.name
    worker = google_service_account.worker.name
    web    = google_service_account.web.name
  }
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deploy.member
}
