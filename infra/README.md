# Roomie infrastructure

The original SQLite and Caddy Compose stack is available alongside the Frankfurt serverless configuration. Follow the AWS commands only after deployment approval.

## Local and legacy Compose

For Vite, Uvicorn and the separate PostgreSQL service, see the [root README](../README.md#local-development).

The original stack still uses `infra/compose.yaml`. Copy `.env.example` to `.env` only if you need a new local config. Set `JWT_SECRET` to a stable random value of at least 32 bytes and `GOOGLE_CLIENT_ID` to your Web OAuth client ID. Set `SITE_DOMAIN` to `localhost` for a local run or to the existing DNS hostname for the Caddy HTTPS deployment. From `infra`, run `docker compose up -d --build` and check `docker compose ps`. For local HTTPS, trust Caddy's local CA before browser testing.

The `sqlite_data` volume holds the database and `caddy_data` holds certificate material. Use `docker compose down` to stop services and preserve the volumes. For a consistent SQLite backup of a running backend, use its backup API:

```sh
docker compose exec -T backend python -c 'import sqlite3; src = sqlite3.connect("/data/roomie.db"); dest = sqlite3.connect("/data/backup.db"); src.backup(dest); dest.close(); src.close()'
docker compose cp backend:/data/backup.db ./roomie-backup.db
```

Store the backup securely. The optional PostgreSQL service uses a separate volume and is stopped with `docker compose -f infra/compose.postgres.yaml down` from the root.

## AWS architecture and database access

CloudFront serves the private S3 bucket through Origin Access Control. Its frontend function maps direct invite URLs to the Vite HTML. HTTPS `/api` and `/api/*` go to API Gateway HTTP API with all viewer headers except Host, including Authorization. The API behaviors disable edge caching and send `Cache-Control: no-store` to clients. The bare `/api` path receives the gateway’s unmapped-route response. API Gateway invokes Mangum with v2 events. Lambda concurrency is capped at 10, API throttling is set to 10 requests per second with a burst of 15, and log retention is seven days. The API Gateway URL also accepts requests and applies the same application authorization and stage throttles.

Aurora PostgreSQL uses one private Serverless v2 writer, encrypted storage, seven days of backups and final snapshot protection. The writer can scale from 0 to 2 ACUs and attempts to pause after 300 idle seconds. Lambda uses psycopg over hostname-verified TLS, a narrowly scoped IAM login role, and a fresh connection when checking out a database session. JWT material is fetched from Secrets Manager on cold start. A dual-stack Lambda VPC configuration and an egress-only IPv6 gateway provide HTTPS access to Google certificates and the Secrets Manager dual-stack endpoint. PostgreSQL traffic stays on private IPv4. The design has no provisioned compute, NAT gateway, VPC interface endpoint, RDS Proxy or public IPv4 address.

### Lambda credentials and outbound HTTPS

Lambda supplies temporary execution-role credentials to boto3. Each physical PostgreSQL connection is opened with a locally signed, 15-minute IAM authentication token for `roomie_app`. Signing needs no outbound STS or RDS API request. The database connection uses the private writer's IPv4 endpoint and verifies its TLS certificate and hostname against the RDS CA bundle. SQLAlchemy uses `NullPool`, so returning a connection closes it. The Lambda role reads only the JWT secret, and the Data API bootstrap uses a separate administrator secret. [Lambda credential provider](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html) · [RDS IAM authentication](https://docs.aws.amazon.com/lambda/latest/dg/example_serverless_connect_RDS_Lambda_section.html)

Both Lambda subnets have IPv4 and IPv6 CIDRs. VPC DNS is enabled, and `::/0` uses an egress-only gateway. The Lambda security group permits IPv6 TCP/443 and private TCP/5432 to the database security group. Google Auth retrieves certificates over verified HTTPS from `https://www.googleapis.com/oauth2/v1/certs`. boto3 is pinned to the documented Frankfurt dual-stack Secrets Manager endpoint `https://secretsmanager.eu-central-1.amazonaws.com`. Both hostnames returned publicly resolvable AAAA records. The SDK-generated `secretsmanager.eu-central-1.api.aws` hostname returned NXDOMAIN during preflight. The local machine could not establish native IPv6, so the Lambda HTTPS path remains a live test. [Lambda IPv6 requirements](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html) · [Secrets Manager endpoints](https://docs.aws.amazon.com/secretsmanager/latest/userguide/asm_access.html) · [Google ID token verification](https://developers.google.com/identity/sign-in/web/backend-auth)

After provisioning is approved, invoke health on a fresh Lambda environment to exercise Secrets Manager. Then test real Google sign-in and linking to exercise Google certificate retrieval, and authenticate against the database to verify IAM login and TLS. Verify auto-pause with the `ServerlessDatabaseCapacity` metric, then test read recovery after a five-minute idle interval and after a deep pause. During the pause test, use the health endpoint for availability monitoring and keep authenticated tabs closed.

### RDS Data API assessment

The published `sqlalchemy-aurora-data-api` dialect has an open SQLAlchemy 2.0 compatibility issue. Roomie uses SQLAlchemy 2.x `Session` and `select()` semantics. It also needs generated IDs before dependent inserts, bulk operations and accurate update row counts, SQLSTATE/integrity error handling, repeatable-read snapshots, and locks that stay in the same transaction until commit or rollback. The PostgreSQL Data API does not supply `generatedFields` and requires SQL `RETURNING` for generated keys. Its explicit transaction IDs, unsupported array binds and result-size limits add separate compatibility requirements. A psycopg connection speaks the PostgreSQL wire protocol. [Dialect issue](https://github.com/cloud-utils/sqlalchemy-aurora-data-api/issues/43) · [ExecuteStatement](https://docs.aws.amazon.com/rdsdataservice/latest/APIReference/API_ExecuteStatement.html) · [AWS Data API troubleshooting](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.troubleshooting.html)

An offline smoke test with dialect 0.5.0, SQLAlchemy 2.0.46 and a fake Data API confirmed simple ORM `INSERT … RETURNING`, generated ID extraction, room lock SQL, and basic commit and rollback calls. The repeatable-read path sent a SQL `COMMIT` inside the active Data API transaction ID and reused that ID for the next query. SQLAlchemy’s session-level isolation setup cannot be assumed to survive Data API transaction boundaries. Concurrent requests and transaction behavior must be proven against Aurora before adopting this dialect.

The private psycopg runtime is the supported implementation here. Existing tests exercise generated IDs, commit/rollback, and concurrent joins, chore changes and financial changes against PostgreSQL. The Data API is enabled for reviewed Alembic SQL via an explicit administrative command. Before adopting a runtime Data API dialect, run the same suites against a real Aurora test cluster, including connection resume and verification that failed requests roll back all rows and release locks. Neither the live Data API nor the Lambda IPv6 path has been validated here. [Lambda dual-stack configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html) · [Secrets Manager IPv6](https://docs.aws.amazon.com/secretsmanager/latest/userguide/ip-access.html)

## Google Identity Services

In Google Cloud, configure the OAuth consent screen and create or reuse a **Web application** OAuth client. For a testing consent screen, add the appropriate test users. Put the same public client ID in Terraform's `google_client_id` and the Vite build's `VITE_GOOGLE_CLIENT_ID`. Add `http://localhost:8443` for local testing and the exact `site_url` HTTPS origin after Terraform creates the distribution. Origins contain no path. The GIS JavaScript popup flow needs no redirect URI or client secret. If the assigned CloudFront hostname cannot be registered for the chosen Google project, use a domain you control, an ACM certificate in `us-east-1`, and update the CloudFront alias and OAuth origin as a separate approved change. Verify login and explicit linking in a real browser.

## First AWS deployment after approval

Use AWS CLI credentials with permission to create the listed resources, upload S3 objects, invalidate CloudFront, write the JWT secret, and run the Data API transaction against the Aurora cluster and its managed administrator secret. Use a dedicated AWS account/profile where practical. Terraform stores its state locally by default. Use `umask 077` for local artifacts and keep the state and saved plans protected and backed up, or configure an encrypted state backend with locking before team use. Review the saved plan and monthly estimates before requesting provisioning approval.

1. From the root, build the Lambda ZIP and prepare the reviewed Terraform inputs. Select an exact, currently available Aurora PostgreSQL 16 minor version at or above 16.3 and verify Frankfurt supports Data API, Serverless v2 and a minimum of 0 ACUs for it. Use a unique snapshot name. The following version query is read-only but requires AWS credentials. [Serverless v2 availability](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.html) · [Data API availability](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.regions.html) · [Scale-to-zero requirements](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)

   ```sh
   PYTHON="$PWD/backend/.venv/bin/python" infra/build-lambda.sh
   aws rds describe-db-engine-versions --region eu-central-1 --engine aurora-postgresql \
     --query 'DBEngineVersions[?starts_with(EngineVersion, `"16."`) && ServerlessV2FeaturesSupport.MinCapacity==`0`].EngineVersion'
   # Replace the example version with one returned above. Check db.serverless orderability.
   aws rds describe-orderable-db-instance-options --region eu-central-1 \
     --engine aurora-postgresql --engine-version '16.REPLACE' --db-instance-class db.serverless \
     --query 'OrderableDBInstanceOptions[].DBInstanceClass' --output text
   cp infra/terraform.tfvars.example infra/terraform.tfvars
   # Fill in the engine version, Google client ID and final snapshot name.
   terraform -chdir=infra init
   terraform -chdir=infra plan -out=roomie.tfplan
   terraform -chdir=infra apply roomie.tfplan
   ```

2. Add a random JWT secret as a plain-text secret version outside Terraform. Keep the shell's tracing disabled. Generate this once for a fresh deployment and keep it stable across releases. Existing warm Lambda environments cache it. Coordinate a Lambda rollout if rotating it.

   ```sh
   openssl rand -hex 48 | tr -d '\n' | aws secretsmanager put-secret-value \
     --region eu-central-1 --secret-id "$(terraform -chdir=infra output -raw jwt_secret_arn)" \
     --secret-string file:///dev/stdin --query VersionId --output text
   ```

3. Review the generated SQL and bootstrap grants. Run both files together once against the empty cluster through the Data API. The helper sends one SQL statement per call and commits as one transaction. For a future revision, generate SQL using the current revision as the lower bound, review runtime grants for new tables, and omit the initial role bootstrap. Resolve ambiguous commit outcomes by querying `alembic_version` before retrying.

   ```sh
   mkdir -p infra/build
   (cd backend && DATABASE_URL=postgresql+psycopg:// .venv/bin/alembic upgrade head --sql) > infra/build/schema.sql
   backend/.venv/bin/python -m pip install 'sqlparse>=0.5,<1'
   backend/.venv/bin/python infra/run-data-api-sql.py \
     --cluster-arn "$(terraform -chdir=infra output -raw cluster_arn)" \
     --secret-arn "$(terraform -chdir=infra output -raw database_admin_secret_arn)" \
     infra/build/schema.sql infra/bootstrap-role.sql
   ```

4. Configure the Google origin as above, build with the public client ID, and upload. Keep an archive of each release's frontend and Lambda ZIP for rollback. Upload the hashed assets before publishing the HTML.

   ```sh
   (cd frontend && npm ci && VITE_API_BASE_URL=/api/v1 VITE_GOOGLE_CLIENT_ID='REPLACE.apps.googleusercontent.com' npm run build)
   roomie_bucket="$(terraform -chdir=infra output -raw frontend_bucket)"
   aws s3 sync frontend/dist "s3://$roomie_bucket" --exclude index.html --region eu-central-1
   aws s3 cp frontend/dist/index.html "s3://$roomie_bucket/index.html" \
     --content-type text/html --cache-control 'no-cache' --region eu-central-1
   aws cloudfront create-invalidation \
     --distribution-id "$(terraform -chdir=infra output -raw distribution_id)" --paths '/index.html' '/'
   ```

5. Check the live routing before accepting traffic. Health checks leave Aurora asleep.

   ```sh
   roomie_site="$(terraform -chdir=infra output -raw site_url)"
   curl -fsS "$roomie_site/api/v1/healthz"
   curl -sS -D - -o /dev/null "$roomie_site/api"
   curl -sS -D - -o /dev/null "$roomie_site/api/v1/me"
   ```

   Expect `{"status":"ok"}`, an API Gateway 404 for the unmapped `/api` route and a 401 for unauthenticated `/me`. API responses should send `Cache-Control: no-store`. In two separate browser sessions, verify that repeated authenticated `/me` requests return only the signed-in user’s profile. Verify signup and login with a test account, authenticated profile and avatars, direct invite navigation and joining, permission isolation, shopping deletion confirmation, chores and recurrence, expenses, balances and settlement confirmation, notifications, Google login and linking, and the donation banner target. Test again after an idle period, verify the writer resumes and ensure API responses carrying JWT-authenticated data are never shared across sessions.

## Monthly cost review

**Recommendation:** Use the prepared serverless stack for light, intermittent university traffic. CloudFront and the HTTP API stay publicly reachable around the clock, and Aurora can pause during quiet periods. Budget for a slower first database action after a long pause. If the class needs predictable response times at all hours or measured database usage consistently exceeds roughly 100–125 ACU-hours per month, reprice the single-instance option. EC2 requires OS patching, backups, and recovery from instance or Availability Zone failures.

Estimates are in USD for 730 hours in Frankfurt, based on public rates reviewed on November 17, 2026. They exclude VAT, credits, free allowances, and custom domain registration. The EC2 comparison uses an On-Demand Linux Arm `t4g.small` with Caddy, the existing SQLite deployment, one public IPv4 address for broad client compatibility, a 20 GB gp3 volume, and 10 GB of incremental snapshot storage. It assumes an existing DNS name and no sustained CPU credit overage. [AWS Frankfurt RDS price catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/eu-central-1/index.json) · [AWS Frankfurt EC2 price catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/eu-central-1/index.json) · [Public IPv4 pricing](https://aws.amazon.com/vpc/pricing/)

| Monthly assumptions | Idle | Light | Moderate |
|---|---:|---:|---:|
| HTTP API and Lambda requests | 100 health checks | 20,000 | 200,000 |
| Aurora billed ACU-hours | 0 | 20 | 120 |
| Equivalent time at 0.5 ACU, including idle tails | 0 hr | 40 hr | 240 hr |
| Aurora I/O | 0 | 0.5 million | 5 million |
| Chargeable Aurora backup or snapshot storage | 0 GB | 5 GB | 10 GB |
| Viewer requests and internet transfer | 200 / 0.1 GB | 40,000 / 5 GB | 400,000 / 25 GB |

| Estimated monthly charge | Idle | Light | Moderate |
|---|---:|---:|---:|
| Aurora compute at $0.14/ACU-hour | $0.00 | $2.80 | $16.80 |
| Aurora storage at $0.119/GB-month for 10 GB, plus I/O and backup overage | $1.19 | $1.42 | $2.52 |
| Secrets Manager, two secrets and a small API call allowance | $0.80 | $0.81 | $0.84 |
| API Gateway + Lambda, assuming 512 MB and 0.5 seconds per request on average | < $0.01 | $0.11 | $1.08 |
| CloudFront requests, functions and European viewer transfer | $0.01 | $0.48 | $2.65 |
| S3, CloudWatch, occasional Data API administration and possible cross-AZ traffic | $0.02 | $0.13 | $0.91 |
| **Serverless total, rounded** | **$2.02** | **$5.75** | **$24.80** |
| **Single EC2 total, rounded** | **$20.12** | **$20.56** | **$22.36** |

The EC2 baseline is about $20.11/month before internet transfer, including $14.02 for compute, $3.65 for IPv4, and about $2.44 for EBS and snapshots. The table budgets $0.09/GB for EC2 internet transfer before allowances. The serverless model uses $0.22 per million Aurora I/Os and $0.023 per chargeable backup GB-month after the included backup allocation. Request, log, object-storage and transfer figures are planning estimates. Shared account allowances can reduce both totals and may change the moderate-traffic comparison. Optional Route 53 hosting, domain renewal, extra snapshots, and EC2 CPU credit surcharges can increase the comparison totals. The Terraform stack uses the included CloudFront hostname and avoids hourly NAT, ALB, RDS Proxy, interface endpoint and public IPv4 charges. [Aurora pricing](https://aws.amazon.com/rds/aurora/pricing/) · [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/) · [EBS pricing](https://aws.amazon.com/ebs/pricing/) · [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) · [Lambda pricing](https://aws.amazon.com/lambda/pricing/) · [HTTP API pricing](https://aws.amazon.com/api-gateway/pricing/) · [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/) · [S3 pricing](https://aws.amazon.com/s3/pricing/) · [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)

Aurora awake time drives the estimate. A writer that stays at 0.5 ACU all month costs about **$51.10 in compute alone**. Notification polling pauses in background tabs and after two minutes without interaction. It refreshes when the tab becomes visible, the user interacts after an idle period, or the notification bell is opened. Keep uptime checks on `/api/v1/healthz`, which leaves Aurora asleep. After approval, set an AWS Budgets alert and compare actual `ServerlessV2Usage`, database capacity, and pause events with these assumptions during the first week. Alerts report spend and do not cap the bill. [AWS Pricing Calculator](https://calculator.aws/) · [Aurora auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)

## Troubleshooting

- AWS reports typical Aurora resume around 15 seconds and deeper-sleep resume around 30 seconds or more. Roomie allows 16 seconds for a PostgreSQL connection to cover a typical resume while preserving headroom under the 27-second Lambda and 29-second HTTP API timeouts. A deep resume can outlast one request. Transient database failures return 503 with `Retry-After: 5` on reads. For writes with an uncertain outcome, Roomie sends no retry hint and the client asks the user to check the affected list or balance before resubmitting. Roomie sends each write once. [Aurora pause and resume behavior](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)
- If health fails, check Lambda logs, ZIP architecture, the JWT secret version, and Secrets Manager dual-stack DNS/egress. If only database endpoints fail, check writer readiness, IAM role grants, security groups and the RDS CA. For Google issues, check the registered origin, the two client IDs and IPv6 reachability to Google’s certificate endpoint. Keep passwords, ID tokens, JWTs and request bodies out of diagnostics.

## Rollback and cleanup

For an application rollback, restore the prior ZIP through Terraform and upload the archived frontend with the same public Google client ID and API base URL. Invalidate HTML after restoring it. Keep migrations forward-compatible where possible. If a schema change requires recovery, restore the snapshot to a separate cluster and test recovery before redirecting traffic. The SQLite Compose service can still be run from its original data volume, but new Aurora records require a separate data transfer to appear there.

Before an approved teardown, confirm the AWS account and state, archive required data, choose a unique final snapshot identifier, and apply a reviewed plan with `protect_database = false`. Empty only the stack's frontend bucket after archiving releases. Review `terraform -chdir=infra plan -destroy -out=destroy.tfplan` before explicitly applying it. Confirm the distribution, Lambda, API, bucket and cluster were removed, then review any remaining final snapshots, retained backups, manually configured budgets and pending secret deletions. Retained snapshots continue to incur storage charges. Use `docker compose down` separately for local services and keep their volumes.
