# Required Google APIs. disable_on_destroy=false so destroying the stack
# never turns off APIs shared with anything else in the project.
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "servicenetworking.googleapis.com",
    "vpcaccess.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "redis.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "compute.googleapis.com",
    "sts.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
