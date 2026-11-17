output "site_url" {
  value = "https://${aws_cloudfront_distribution.roomie.domain_name}"
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.id
}

output "distribution_id" {
  value = aws_cloudfront_distribution.roomie.id
}

output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt.arn
}

output "cluster_arn" {
  value = aws_rds_cluster.roomie.arn
}

output "database_admin_secret_arn" {
  value = aws_rds_cluster.roomie.master_user_secret[0].secret_arn
}
