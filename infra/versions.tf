terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "eu-central-1"
  default_tags {
    tags = { Project = var.name }
  }
}

variable "name" {
  type    = string
  default = "roomie"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.name))
    error_message = "Use 3–30 lowercase letters, digits or hyphens, starting with a letter and ending with a letter or digit."
  }
}

variable "google_client_id" {
  type = string
}

variable "aurora_engine_version" {
  type        = string
  description = "Exact Frankfurt Aurora PostgreSQL 16 minor version verified for Serverless v2 scale-to-zero and Data API."
  validation {
    condition     = can(regex("^16\\.([3-9]|[1-9][0-9]+)(\\.[0-9]+)?$", var.aurora_engine_version))
    error_message = "Select an exact Aurora PostgreSQL 16 minor version (16.3 or newer) offered in Frankfurt."
  }
}

variable "protect_database" {
  type    = bool
  default = true
}

variable "final_snapshot_identifier" {
  type        = string
  description = "Unique snapshot name to use on approved cluster deletion."
}

variable "lambda_zip" {
  type    = string
  default = "build/roomie-lambda.zip"
}

data "aws_availability_zones" "available" {
  state = "available"
  filter {
    name   = "zone-type"
    values = ["availability-zone"]
  }
}
