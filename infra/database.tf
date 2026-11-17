resource "aws_vpc" "roomie" {
  cidr_block                       = "10.73.0.0/24"
  assign_generated_ipv6_cidr_block = true
  enable_dns_support               = true
  enable_dns_hostnames             = true
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.roomie.id
  availability_zone = data.aws_availability_zones.available.names[count.index]
  cidr_block        = cidrsubnet(aws_vpc.roomie.cidr_block, 2, count.index)
  ipv6_cidr_block   = cidrsubnet(aws_vpc.roomie.ipv6_cidr_block, 8, count.index)
}

resource "aws_egress_only_internet_gateway" "roomie" {
  vpc_id = aws_vpc.roomie.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.roomie.id
  route {
    ipv6_cidr_block        = "::/0"
    egress_only_gateway_id = aws_egress_only_internet_gateway.roomie.id
  }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "lambda" {
  name   = "${var.name}-lambda"
  vpc_id = aws_vpc.roomie.id
}

resource "aws_security_group" "db" {
  name   = "${var.name}-db"
  vpc_id = aws_vpc.roomie.id
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.lambda.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "postgres" {
  security_group_id            = aws_security_group.lambda.id
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.lambda.id
  cidr_ipv6         = "::/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_db_subnet_group" "roomie" {
  name       = var.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_rds_cluster" "roomie" {
  cluster_identifier                  = var.name
  engine                              = "aurora-postgresql"
  engine_mode                         = "provisioned"
  engine_version                      = var.aurora_engine_version
  database_name                       = "roomie"
  master_username                     = "roomie_admin"
  manage_master_user_password         = true
  iam_database_authentication_enabled = true
  enable_http_endpoint                = true
  db_subnet_group_name                = aws_db_subnet_group.roomie.name
  vpc_security_group_ids              = [aws_security_group.db.id]
  storage_encrypted                   = true
  backup_retention_period             = 7
  deletion_protection                 = var.protect_database
  skip_final_snapshot                 = false
  final_snapshot_identifier           = var.final_snapshot_identifier
  copy_tags_to_snapshot               = true

  serverlessv2_scaling_configuration {
    min_capacity             = 0
    max_capacity             = 2
    seconds_until_auto_pause = 300
  }
}

resource "aws_rds_cluster_instance" "writer" {
  identifier                   = "${var.name}-writer"
  cluster_identifier           = aws_rds_cluster.roomie.id
  instance_class               = "db.serverless"
  engine                       = aws_rds_cluster.roomie.engine
  engine_version               = aws_rds_cluster.roomie.engine_version
  db_subnet_group_name         = aws_db_subnet_group.roomie.name
  publicly_accessible          = false
  performance_insights_enabled = false
}
