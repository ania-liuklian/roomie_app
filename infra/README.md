# Roomie infrastructure

Roomie runs on the Frankfurt serverless stack. GitHub Actions releases application code to the existing infrastructure. The SQLite and Caddy Compose stack is available for local development and testing.

## Local and legacy Compose

For Vite, Uvicorn and the separate PostgreSQL service, see the [root README](../README.md#local-development).

The original stack still uses `infra/compose.yaml`. Copy `.env.example` to `.env` only if you need a new local config. Set `JWT_SECRET` to a stable random value of at least 32 bytes and `GOOGLE_CLIENT_ID` to your Web OAuth client ID. Set `SITE_DOMAIN` to `localhost` for a local run or to the existing DNS hostname for the Caddy HTTPS deployment. From `infra`, run `docker compose up -d --build` and check `docker compose ps`. For local HTTPS, trust Caddy's local CA before browser testing.

The `sqlite_data` volume holds the database and `caddy_data` holds certificate material. Use `docker compose down` to stop services and preserve the volumes. For a consistent SQLite backup of a running backend, use its backup API:

```sh
docker compose exec -T backend python -c 'import sqlite3; src = sqlite3.connect("/data/roomie.db"); dest = sqlite3.connect("/data/backup.db"); src.backup(dest); dest.close(); src.close()'
docker compose cp backend:/data/backup.db ./roomie-backup.db
```

Store the backup securely. The optional PostgreSQL service uses a separate volume and is stopped with `docker compose -f infra/compose.postgres.yaml down` from the root.

## Production architecture and database access

CloudFront serves the private S3 bucket through Origin Access Control. Its frontend function maps direct invite URLs to the Vite HTML. HTTPS `/api` and `/api/*` go to API Gateway HTTP API with all viewer headers except Host, including Authorization. The API behaviors disable edge caching and send `Cache-Control: no-store` to clients. The bare `/api` path receives the gateway’s unmapped-route response. API Gateway invokes Mangum with v2 events. Lambda concurrency is capped at 10, API throttling is set to 10 requests per second with a burst of 15, and log retention is seven days. The API Gateway URL also accepts requests and applies the same application authorization and stage throttles.

Aurora PostgreSQL uses one private Serverless v2 writer, encrypted storage, seven days of backups and final snapshot protection. The writer can scale from 0 to 2 ACUs and attempts to pause after 300 idle seconds. Lambda uses psycopg over hostname-verified TLS, a narrowly scoped IAM login role, and a fresh connection when checking out a database session. JWT material is fetched from Secrets Manager on cold start. A dual-stack Lambda VPC configuration and an egress-only IPv6 gateway provide HTTPS access to Google certificates and the Secrets Manager dual-stack endpoint. PostgreSQL traffic stays on private IPv4. The design has no provisioned compute, NAT gateway, VPC interface endpoint, RDS Proxy or public IPv4 address.

### Lambda credentials and outbound HTTPS

Lambda supplies temporary execution-role credentials to boto3. Each physical PostgreSQL connection is opened with a locally signed, 15-minute IAM authentication token for `roomie_app`. Signing needs no outbound STS or RDS API request. The database connection uses the private writer's IPv4 endpoint and verifies its TLS certificate and hostname against the RDS CA bundle. SQLAlchemy uses `NullPool`, so returning a connection closes it. The Lambda role reads only the JWT secret, and the Data API bootstrap uses a separate administrator secret. [Lambda credential provider](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html) · [RDS IAM authentication](https://docs.aws.amazon.com/lambda/latest/dg/example_serverless_connect_RDS_Lambda_section.html)

Both Lambda subnets have IPv4 and IPv6 CIDRs. VPC DNS is enabled, and `::/0` uses an egress-only gateway. The Lambda security group permits IPv6 TCP/443 to Google’s public signing-key endpoint and Frankfurt Secrets Manager, and private TCP/5432 to the database security group. The SDK uses the documented Frankfurt endpoint, `https://secretsmanager.eu-central-1.amazonaws.com`. [Lambda IPv6 requirements](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html) · [Secrets Manager endpoints](https://docs.aws.amazon.com/secretsmanager/latest/userguide/asm_access.html) · [Google ID token verification](https://developers.google.com/identity/sign-in/web/backend-auth)

### Schema changes on the deployed stack

Application queries use private psycopg connections. RDS Data API is reserved for the operator to submit reviewed Alembic SQL using the separate database administrator secret. GitHub Actions does not run production migrations.

Room creation and renaming use the existing `rooms.number VARCHAR(12)` column and require no schema change.

## Google Identity Services

In Google Cloud, configure the OAuth consent screen and create or reuse a **Web application** OAuth client. For a testing consent screen, add the appropriate test users. Put the same public client ID in Terraform's `google_client_id` and the Vite build's `VITE_GOOGLE_CLIENT_ID`. Add `http://localhost:8443` for local testing and the exact `site_url` HTTPS origin after Terraform creates the distribution. Origins contain no path. The GIS JavaScript popup flow needs no redirect URI or client secret. If the assigned CloudFront hostname cannot be registered for the chosen Google project, use a domain you control, an ACM certificate in `us-east-1`, and update the CloudFront alias and OAuth origin as a separate approved change. Verify login and explicit linking in a real browser.

## Bootstrap a separate AWS stack after approval

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

## GitHub Actions CI/CD

Automatic production deployment from `main` is enabled for `ania-liuklian/roomie_app`. The workflow releases app code and frontend files. Use the setup steps below when restoring or replacing the integration. Manage infrastructure and reviewed schema changes separately.

### 1. Confirm the existing AWS targets

In the AWS Console, select the production account. In **Lambda → Functions**, select Frankfurt (`eu-central-1`) and copy the function name. Confirm that the HTTP API invokes the unqualified function, as in `api.tf`. In **S3 → General purpose buckets**, copy the private frontend bucket name. In **CloudFront → Distributions**, copy the distribution ID and its public HTTPS origin (the existing CloudFront domain or HTTPS alias). Use the account ID from the AWS Console account menu. The example policy assumes the bucket uses SSE-S3 as in the Roomie stack.

### 2. Protect the repository and environment

1. In **Settings → Actions → General**, enable Actions and allow the pinned actions from GitHub, HashiCorp and AWS used in these workflows. Keep default workflow token permissions read-only. The production job requests its own `id-token: write`.
2. In **Settings → Environments**, create an environment named exactly `production`. Under **Deployment branches and tags**, choose **Selected branches and tags**, add a **Branch** rule for exactly `main`, and leave tags without any rule. Use a required reviewer for the first deployment if available. Keep the branch restriction in place when enabling automatic deploys. Confirm the repository plan supports environment deployment branch rules before configuring the AWS trust. [GitHub environment protection rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
3. In **Settings → Rules → Rulesets**, create or update an active branch ruleset targeting `main`. Require a pull request and review, block force pushes, and require these four checks from GitHub Actions after they have run on a PR: **Backend SQLite**, **Backend PostgreSQL**, **Frontend**, and **Terraform**. Limit bypass privileges. Review changes to `.github/workflows/` and `infra/deploy-release.sh` before merge. [GitHub ruleset settings](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
4. In **Settings → Secrets and variables → Actions → Variables**, add repository variables `VITE_GOOGLE_CLIENT_ID` (the public Google Web client ID used by Lambda) and `ROOMIE_AUTO_DEPLOY` (`false` initially). The build job reads the client ID before entering the production environment. No GitHub Actions secrets are needed.

### 3. Create the OIDC provider and deployment role

1. In **IAM → Identity providers**, reuse the provider for `token.actions.githubusercontent.com` if it already lists the audience `sts.amazonaws.com`. Otherwise choose **Add provider → OpenID Connect**, enter provider URL `https://token.actions.githubusercontent.com` and audience `sts.amazonaws.com`. If the provider already exists without the audience, add the audience to that provider. [GitHub OIDC setup for AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
2. In **IAM → Policies → Create policy → JSON**, paste this identity policy, replacing the four angle-bracket placeholders with the existing values from step 1. Name it `RoomieGitHubDeploy`. No permission to read application or database secrets is needed. [S3 action requirements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html) · [Lambda update waiter](https://docs.aws.amazon.com/cli/latest/reference/lambda/wait/function-updated.html) · [CloudFront invalidation waiter](https://docs.aws.amazon.com/cli/latest/reference/cloudfront/wait/invalidation-completed.html)

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "UpdateExistingLambdaCode",
         "Effect": "Allow",
         "Action": ["lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode"],
         "Resource": "arn:aws:lambda:eu-central-1:<AWS_ACCOUNT_ID>:function:<LAMBDA_FUNCTION_NAME>"
       },
       {
         "Sid": "UploadFrontendObjects",
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:AbortMultipartUpload"],
         "Resource": "arn:aws:s3:::<FRONTEND_BUCKET>/*",
         "Condition": {"StringEquals": {"aws:ResourceAccount": "<AWS_ACCOUNT_ID>"}}
       },
       {
         "Sid": "InvalidateExistingDistribution",
         "Effect": "Allow",
         "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
         "Resource": "arn:aws:cloudfront::<AWS_ACCOUNT_ID>:distribution/<CLOUDFRONT_DISTRIBUTION_ID>"
       }
     ]
   }
   ```

3. In **IAM → Roles → Create role**, choose **Custom trust policy**. Paste the following JSON with the production AWS account ID and attach only `RoomieGitHubDeploy`. Name the role `RoomieGitHubDeploy` and copy its ARN.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:ania-liuklian@246476250/roomie_app@1457854596:environment:production"
           }
         }
       }
     ]
   }
   ```

   The repository was created on November 14, 2026, after GitHub introduced immutable default OIDC subjects. The two numeric IDs are its public owner and repository IDs. The job's subject ends in `:environment:production` because it references that environment. The GitHub environment restricts the branch to `main`. Keep exact matches. If a repository-level subject template has been configured, check it under the repository's Actions OIDC settings, or inspect it with `gh api repos/ania-liuklian/roomie_app/actions/oidc/customization/sub`. Align any customized subject deliberately before using the trust policy. Never dump a raw OIDC token to diagnose a mismatch. [GitHub environment subjects and immutable repository IDs](https://docs.github.com/en/actions/reference/security/oidc)

4. In **Settings → Environments → production → Environment variables**, add:

   | Variable | Value |
   |---|---|
   | `ROOMIE_DEPLOY_ROLE_ARN` | The ARN of the dedicated IAM role |
   | `ROOMIE_AWS_ACCOUNT_ID` | The 12-digit AWS account ID, used to verify assumed credentials |
   | `ROOMIE_LAMBDA_FUNCTION` | The existing unqualified Lambda function name |
   | `ROOMIE_FRONTEND_BUCKET` | The bucket name, without `s3://` |
   | `ROOMIE_DISTRIBUTION_ID` | The bare CloudFront distribution ID, without quotes, whitespace, ARN, or URL |
   | `ROOMIE_SITE_URL` | The public HTTPS origin, without a path |

### 4. Test a manual release before enabling automatic releases

1. Merge the workflows through a reviewed pull request with **ROOMIE_AUTO_DEPLOY=false**. The `main` run executes CI and skips packaging and deployment. Preserve the deployed Lambda ZIP and frontend files as a rollback point. If you don't have the original release archive, use the following with an authorized operator profile and the target values above. The operator needs read access to the existing function code and frontend bucket. The deployment role has narrower permissions. Run with shell tracing disabled so the temporary Lambda download URL stays out of logs.

   ```sh
   umask 077
   export AWS_REGION=eu-central-1 AWS_DEFAULT_REGION=eu-central-1
   roomie_backup="$(mktemp -d)"
   roomie_zip_url="$(aws lambda get-function --function-name "$ROOMIE_LAMBDA_FUNCTION" --query 'Code.Location' --output text)"
   curl --fail --silent --show-error --proto '=https' "$roomie_zip_url" -o "$roomie_backup/roomie-lambda.zip"
   unset roomie_zip_url
   aws s3 cp "s3://$ROOMIE_FRONTEND_BUCKET/" "$roomie_backup/frontend/" --recursive --only-show-errors
   ```

   Copy the resulting directory to secure, durable storage.
2. In **Actions → Deploy Roomie → Run workflow**, select **main** and run it. Approve the production job if it requires a reviewer. This performs a real code release after tests pass. The job uploads fingerprinted assets, updates Lambda, waits for completion, and checks the public HTTPS health endpoint before publishing `index.html`. It waits for CloudFront invalidation of `/` and `/index.html`, then repeats the health check. Health requests use no credentials and do not query Aurora.
3. Check the homepage and sign in with a test account in a browser. Confirm both sign-in and a database-backed room view. Once the manual release passes, set **ROOMIE_AUTO_DEPLOY=true**. Next merges to `main` release after all tests pass. Remove the optional environment reviewer if releases should run unattended. Keep the environment restricted to `main`. A superseded commit is skipped, and automatic and manual production jobs share one concurrency group. GitHub can replace an older pending deployment with a newer one and lets an active deployment finish.

### Rollback and troubleshooting

- **Normal rollback:** Open a PR that reverts the faulty application changes. Merge it after CI passes. If automatic releases are disabled, run **Deploy Roomie** on `main` after merging. CI retains release artifacts for 30 days, subject to the repository's retention limit. Save known-good releases separately when longer retention is needed.
- **Urgent rollback:** Set `ROOMIE_AUTO_DEPLOY=false`, let any active production job finish and cancel queued jobs before using an authorized operator role. Download the previous successful run's artifact and extract `roomie-lambda.zip` and `frontend/` together. Export `ROOMIE_LAMBDA_FUNCTION`, `ROOMIE_FRONTEND_BUCKET`, `ROOMIE_DISTRIBUTION_ID`, and `ROOMIE_SITE_URL` using the values above, then run `bash infra/deploy-release.sh /path/to/extracted-release`. The script updates the existing function and publishes the archived frontend. It preserves old fingerprinted assets and does not change the schema. Keep the database schema and API compatible across releases.
- **Failed deployment:** A failure before publishing `index.html` leaves the old HTML in place, although hashed files and a new Lambda ZIP might already be deployed. A failure after publishing HTML can leave both new artifacts live. Inspect the failed step and use the rollback procedure if needed. Coordinate operator uploads with GitHub's release queue. They do not share its concurrency lock.
- **OIDC access denied:** Check the exact subject, issuer, audience, repository identity, environment name, branch rule and account ID. For an AWS API denial after authentication, check the scope of the resource ARN and confirm the bucket still uses SSE-S3. For a smoke failure, check the public origin and Lambda/API logs with an authorized operator account.
- **Terraform ownership:** The infrastructure still references a local Lambda ZIP. Before a later infrastructure plan, check for a proposed Lambda code change and use the currently deployed archive if the infrastructure change should preserve that release. The deployment workflow never runs Terraform apply, destroy or schema migrations.

## Monthly cost review

**Recommendation:** The deployed serverless stack is sized for light, intermittent university traffic. CloudFront and the HTTP API stay publicly reachable around the clock, and Aurora can pause during quiet periods. Budget for a slower first database action after a long pause. If the class needs predictable response times at all hours or measured database usage consistently exceeds roughly 100–125 ACU-hours per month, reprice the single-instance option. EC2 requires OS patching, backups, and recovery from instance or Availability Zone failures.

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

For an application rollback, use the [release rollback procedure](#rollback-and-troubleshooting) with the matching Lambda and frontend artifacts. Invalidate HTML after restoring it. Keep migrations forward-compatible where possible. If a schema change requires recovery, restore the snapshot to a separate cluster and test recovery before redirecting traffic. The SQLite Compose service can still be run from its original data volume, but new Aurora records require a separate data transfer to appear there.

Before an approved teardown, confirm the AWS account and state, archive required data, choose a unique final snapshot identifier, and apply a reviewed plan with `protect_database = false`. Empty only the stack's frontend bucket after archiving releases. Review `terraform -chdir=infra plan -destroy -out=destroy.tfplan` before explicitly applying it. Confirm the distribution, Lambda, API, bucket and cluster were removed, then review any remaining final snapshots, retained backups, manually configured budgets and pending secret deletions. Retained snapshots continue to incur storage charges. Use `docker compose down` separately for local services and keep their volumes.
