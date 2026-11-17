"""API Gateway HTTP API v2 entry point."""
import os
from functools import lru_cache

import boto3
from botocore.config import Config
from mangum import Mangum
from sqlalchemy.engine import URL

from .main import create_app


@lru_cache(maxsize=1)
def adapter():
    host = os.environ["ROOMIE_DB_HOST"]
    user = os.environ["ROOMIE_DB_USER"]
    region = os.environ["AWS_REGION"]
    rds = boto3.client("rds", region_name=region)
    secrets = boto3.client(
        "secretsmanager", region_name=region,
        # Secrets Manager's documented dual-stack hostname uses amazonaws.com.
        endpoint_url=f"https://secretsmanager.{region}.amazonaws.com",
        config=Config(connect_timeout=2, read_timeout=3, retries={"total_max_attempts": 1}),
    )
    jwt_secret = secrets.get_secret_value(SecretId=os.environ["ROOMIE_JWT_SECRET_ARN"])["SecretString"]

    def connect_token():
        return rds.generate_db_auth_token(DBHostname=host, Port=5432, DBUsername=user)

    url = URL.create("postgresql+psycopg", username=user, host=host, port=5432,
                     database=os.environ["ROOMIE_DB_NAME"], query={
                         "sslmode": "verify-full",
                         "sslrootcert": os.environ["ROOMIE_DB_CA"],
                         "connect_timeout": "16",
                         "options": "-c statement_timeout=8000 -c lock_timeout=3000",
                     })
    return Mangum(create_app(url, jwt_secret, create_schema=False, connect_token=connect_token), lifespan="off")


def handler(event, context):
    return adapter()(event, context)
