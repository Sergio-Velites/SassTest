# Private VPC: Cloud SQL and Redis get private IPs only; Cloud Run reaches
# them through a Serverless VPC Access connector.
resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "flowhub-${var.environment}"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  project       = var.project_id
  name          = "flowhub-${var.environment}-main"
  region        = var.region
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/24"
}

# Reserved range for Google-managed services (Cloud SQL private IP).
resource "google_compute_global_address" "private_services" {
  project       = var.project_id
  name          = "flowhub-${var.environment}-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
  depends_on              = [google_project_service.apis]
}

resource "google_vpc_access_connector" "run" {
  project       = var.project_id
  name          = "flowhub-${var.environment}"
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.11.0.0/28"
  min_instances = 2
  max_instances = 3
  depends_on    = [google_project_service.apis]
}
