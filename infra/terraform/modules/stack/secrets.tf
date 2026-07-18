# Runtime secrets in Secret Manager. Terraform generates what it can;
# AI provider keys are created empty and filled manually by an operator
# (never through terraform state).

resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "auth_session_secret" {
  project   = var.project_id
  secret_id = "flowhub-${var.environment}-auth-session-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "auth_session_secret" {
  secret      = google_secret_manager_secret.auth_session_secret.id
  secret_data = random_password.session_secret.result
}

resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = "flowhub-${var.environment}-database-url"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id
  secret_data = format(
    "postgresql://%s:%s@%s:5432/%s",
    google_sql_user.flowhub.name,
    random_password.db_password.result,
    google_sql_database_instance.postgres.private_ip_address,
    google_sql_database.flowhub.name,
  )
}

# Created empty on purpose — an operator adds versions when enabling real AI:
#   gcloud secrets versions add flowhub-<env>-anthropic-api-key --data-file=-
resource "google_secret_manager_secret" "ai_keys" {
  for_each  = toset(["openai-api-key", "anthropic-api-key"])
  project   = var.project_id
  secret_id = "flowhub-${var.environment}-${each.value}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}
