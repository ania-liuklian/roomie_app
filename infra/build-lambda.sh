#!/bin/sh
set -eu

cd "$(dirname "$0")"
build_dir="$PWD/build"
mkdir -p "$build_dir"
stage="$(mktemp -d "$build_dir/lambda.XXXXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/package"

"${PYTHON:-python3}" -m pip install --disable-pip-version-check --no-cache-dir \
  --platform manylinux2014_x86_64 --platform manylinux_2_28_x86_64 \
  --python-version 3.12 --implementation cp --abi cp312 --only-binary=:all: \
  --no-compile --target "$stage/package" -r ../backend/requirements-runtime.txt

mkdir "$stage/package/app"
cp ../backend/app/*.py "$stage/package/app/"
curl --fail --silent --show-error --location \
  https://truststore.pki.rds.amazonaws.com/eu-central-1/eu-central-1-bundle.pem \
  -o "$stage/package/amazon-rds-ca.pem"

(cd "$stage/package" && zip -qr "$stage/roomie-lambda.zip" .)
mv "$stage/roomie-lambda.zip" "$build_dir/roomie-lambda.zip"
