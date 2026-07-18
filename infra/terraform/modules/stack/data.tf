# PostgreSQL 16 (private IP only) + Memorystore Redis.

resource "google_sql_database_instance" "postgres" {
  project          = var.project_id
  name             = "flowhub-${var.environment}"
  region           = var.region
  database_version = "POSTGRES_16"

  settings {
    tier              = var.db_tier
    availability_type = var.environment == "production" ? "REGIONAL" : "ZONAL"

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 4
    }
  }

  # Never let terraform destroy the production database by accident.
  deletion_protection = var.environment == "production"
  depends_on          = [google_service_networking_connection.psa]
}

resource "google_sql_database" "flowhub" {
  project  = var.project_id
  name     = "flowhub"
  instance = google_sql_database_instance.postgres.name
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_sql_user" "flowhub" {
  project  = var.project_id
  name     = "flowhub"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db_password.result
}

resource "google_redis_instance" "queue" {
  project            = var.project_id
  name               = "flowhub-${var.environment}"
  region             = var.region
  tier               = "BASIC"
  memory_size_gb     = 1
  authorized_network = google_compute_network.vpc.id
  redis_version      = "REDIS_7_0"
  depends_on         = [google_project_service.apis]
}
