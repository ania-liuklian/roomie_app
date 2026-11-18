#!/usr/bin/env bash
# Release the two application artifacts to the existing Roomie stack.
set -euo pipefail

release_dir=${1:?Pass the directory containing roomie-lambda.zip and frontend/}
: "${ROOMIE_LAMBDA_FUNCTION:?Set the existing Lambda function name or ARN}"
: "${ROOMIE_FRONTEND_BUCKET:?Set the existing S3 bucket name}"
: "${ROOMIE_DISTRIBUTION_ID:?Set the existing CloudFront distribution ID}"
: "${ROOMIE_SITE_URL:?Set the public HTTPS site origin}"

site_url=${ROOMIE_SITE_URL%/}
if [[ ! "$site_url" =~ ^https://[A-Za-z0-9][A-Za-z0-9.-]*$ ]]; then
  echo 'ROOMIE_SITE_URL must be an HTTPS origin without a path.' >&2
  exit 1
fi

zip_path="$release_dir/roomie-lambda.zip"
frontend_dir="$release_dir/frontend"
if [[ ! -s "$zip_path" || ! -s "$frontend_dir/index.html" || ! -d "$frontend_dir/assets" ]]; then
  echo 'Release is missing the Lambda ZIP, frontend index.html, or assets directory.' >&2
  exit 1
fi

export AWS_REGION=eu-central-1
export AWS_DEFAULT_REGION=eu-central-1
export AWS_PAGER=""

smoke_test() {
  # Inspect only the public health JSON and never send credentials.
  curl --disable --proto '=https' --fail --silent --show-error --connect-timeout 5 \
    --max-time 35 --retry 3 --retry-all-errors --retry-max-time 80 \
    "$site_url/api/v1/healthz" |
    jq --exit-status '.status == "ok"' >/dev/null
}

bucket="s3://$ROOMIE_FRONTEND_BUCKET"

echo 'Uploading fingerprinted frontend assets.'
aws s3 cp "$frontend_dir/assets/" "$bucket/assets/" --recursive --only-show-errors \
  --cache-control 'public, max-age=31536000, immutable'

echo 'Updating Lambda and waiting for the update.'
revision_id=$(aws lambda get-function-configuration --function-name "$ROOMIE_LAMBDA_FUNCTION" \
  --query RevisionId --output text)
aws lambda update-function-code --function-name "$ROOMIE_LAMBDA_FUNCTION" \
  --revision-id "$revision_id" --zip-file "fileb://$zip_path" --query CodeSha256 --output text >/dev/null
aws lambda wait function-updated --function-name "$ROOMIE_LAMBDA_FUNCTION"
smoke_test

echo 'Publishing frontend files and then index.html.'
aws s3 cp "$frontend_dir/" "$bucket/" --recursive --only-show-errors \
  --exclude 'assets/*' --exclude 'index.html' --cache-control 'no-cache'
aws s3 cp "$frontend_dir/index.html" "$bucket/index.html" --only-show-errors \
  --content-type 'text/html; charset=utf-8' --cache-control 'no-cache, max-age=0, must-revalidate'

echo 'Invalidating CloudFront homepage and waiting for completion.'
invalidation_id=$(aws cloudfront create-invalidation --distribution-id "$ROOMIE_DISTRIBUTION_ID" \
  --paths '/' '/index.html' --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --distribution-id "$ROOMIE_DISTRIBUTION_ID" --id "$invalidation_id"

smoke_test
echo 'Public HTTPS health check passed.'
