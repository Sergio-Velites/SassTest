# Artifact Registry + Cloud Run services and the migration job.
# Image refs come from the deploy pipeline; a public placeholder keeps the
# first apply green before any image has been pushed.

locals {
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"
  api_image         = var.api_image != "" ? var.api_image : local.placeholder_image
  worker_image      = var.worker_image != "" ? var.worker_image : local.placeholder_image
  web_image         = var.web_image != "" ? var.web_image : local.placeholder_image
}

resource "google_artifact_registry_repository" "docker" {
  project       = var.project_id
  location      = var.region
  repository_id = "flowhub"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}

resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = "flowhub-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = 5
    }
    vpc_access {
      connector = google_vpc_access_connector.run.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = local.api_image
      ports {
        container_port = 3001
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "API_PORT"
        value = "3001"
      }
      env {
        name  = "CORS_ALLOWED_ORIGINS"
        value = var.cors_allowed_origins
      }
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.queue.host}:${google_redis_instance.queue.port}"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "AUTH_SESSION_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.auth_session_secret.secret_id
            version = "latest"
          }
        }
      }
      startup_probe {
        http_get {
          path = "/health"
          port = 3001
        }
        initial_delay_seconds = 5
      }
    }
  }

  lifecycle {
    # The pipeline rolls new images with gcloud; terraform manages the shape.
    ignore_changes = [template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service" "worker" {
  project  = var.project_id
  name     = "flowhub-worker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.worker.email
    scaling {
      # The BullMQ consumer must always be alive (ADR-0005/0008).
      min_instance_count = 1
      max_instance_count = 3
    }
    vpc_access {
      connector = google_vpc_access_connector.run.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = local.worker_image
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "AI_PROVIDER"
        value = "mock"
      }
      env {
        name  = "AI_MONTHLY_COST_CAP_USD"
        value = tostring(var.ai_monthly_cost_cap_usd)
      }
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.queue.host}:${google_redis_instance.queue.port}"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service" "web" {
  project  = var.project_id
  name     = "flowhub-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.web.email
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = 5
    }
    containers {
      image = local.web_image
      ports {
        container_port = 3000
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }
}

# Public access for web and api; the worker stays internal-only.
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = {
    api = google_cloud_run_v2_service.api.name
    web = google_cloud_run_v2_service.web.name
  }
  project  = var.project_id
  location = var.region
  name     = each.value
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Migration job: same api image, migrate entrypoint. The pipeline updates
# the image and executes it before rolling new revisions.
resource "google_cloud_run_v2_job" "migrate" {
  project  = var.project_id
  name     = "flowhub-migrate"
  location = var.region

  template {
    template {
      service_account = google_service_account.deploy.email
      vpc_access {
        connector = google_vpc_access_connector.run.id
        egress    = "PRIVATE_RANGES_ONLY"
      }
      containers {
        image   = local.api_image
        command = ["node", "node_modules/@flowhub/database/dist/migrate.js"]
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
      }
      max_retries = 0
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }
}

# The deployer (not the runtimes) reads the DB secret when running migrations.
resource "google_secret_manager_secret_iam_member" "deploy_reads_db" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.deploy.member
}
