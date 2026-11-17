data "aws_caller_identity" "current" {}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${var.name}/jwt"
  recovery_window_in_days = 7
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = 7
}

resource "aws_iam_role" "lambda" {
  name = "${var.name}-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.lambda.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.jwt.arn
      },
      {
        Effect   = "Allow"
        Action   = "rds-db:connect"
        Resource = "arn:aws:rds-db:eu-central-1:${data.aws_caller_identity.current.account_id}:dbuser:${aws_rds_cluster.roomie.cluster_resource_id}/roomie_app"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets",
          "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"
        ]
        Resource = "*"
      },
      {
        Effect = "Deny"
        Action = [
          "ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets",
          "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"
        ]
        Resource = "*"
        Condition = {
          ArnEquals = {
            "lambda:SourceFunctionArn" = "arn:aws:lambda:eu-central-1:${data.aws_caller_identity.current.account_id}:function:${var.name}"
          }
        }
      }
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name                  = var.name
  role                           = aws_iam_role.lambda.arn
  handler                        = "app.lambda_handler.handler"
  runtime                        = "python3.12"
  architectures                  = ["x86_64"]
  filename                       = var.lambda_zip
  source_code_hash               = try(filebase64sha256(var.lambda_zip), null)
  memory_size                    = 512
  timeout                        = 27
  reserved_concurrent_executions = -1

  lifecycle {
    precondition {
      condition     = fileexists(var.lambda_zip)
      error_message = "Build the Lambda ZIP using infra/build-lambda.sh before planning deployment."
    }
  }

  vpc_config {
    subnet_ids                  = aws_subnet.private[*].id
    security_group_ids          = [aws_security_group.lambda.id]
    ipv6_allowed_for_dual_stack = true
  }

  environment {
    variables = {
      GOOGLE_CLIENT_ID      = var.google_client_id
      ROOMIE_DB_HOST        = aws_rds_cluster.roomie.endpoint
      ROOMIE_DB_NAME        = aws_rds_cluster.roomie.database_name
      ROOMIE_DB_USER        = "roomie_app"
      ROOMIE_DB_CA          = "/var/task/amazon-rds-ca.pem"
      ROOMIE_JWT_SECRET_ARN = aws_secretsmanager_secret.jwt.arn
    }
  }

  depends_on = [aws_iam_role_policy.lambda, aws_route_table_association.private]
}

resource "aws_apigatewayv2_api" "roomie" {
  name          = var.name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.roomie.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "api" {
  api_id    = aws_apigatewayv2_api.roomie.id
  route_key = "ANY /api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/http-api/${var.name}"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.roomie.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 15
    throttling_rate_limit  = 10
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId = "$context.requestId"
      routeKey  = "$context.routeKey"
      status    = "$context.status"
      latency   = "$context.responseLatency"
    })
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowRoomieHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.roomie.execution_arn}/$default/*/api/*"
}
