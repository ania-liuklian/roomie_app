"""Manually run reviewed, transactional migration SQL through the Aurora Data API."""
import argparse
import time
from pathlib import Path

import boto3
import sqlparse
from botocore.config import Config
from botocore.exceptions import ClientError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cluster-arn", required=True)
    parser.add_argument("--secret-arn", required=True)
    parser.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args()
    statements = [
        statement
        for path in args.files
        for statement in sqlparse.split(path.read_text())
        if statement.strip().rstrip(";").upper() not in {"BEGIN", "COMMIT"}
    ]
    client = boto3.client("rds-data", region_name="eu-central-1",
                          config=Config(read_timeout=60, retries={"total_max_attempts": 1}))
    credentials = {"resourceArn": args.cluster_arn, "secretArn": args.secret_arn}
    for attempt in range(12):
        try:
            transaction = client.begin_transaction(database="roomie", **credentials)
            break
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "DatabaseResumingException" or attempt == 11:
                raise
            time.sleep(5)
    credentials["transactionId"] = transaction["transactionId"]
    try:
        for statement in statements:
            client.execute_statement(database="roomie", sql=statement, **credentials)
    except Exception as exc:
        try:
            client.rollback_transaction(**credentials)
        except Exception as rollback_error:
            exc.add_note(f"Rollback could not be confirmed: {type(rollback_error).__name__}")
        raise
    # If the commit response is lost, inspect the schema before retrying.
    client.commit_transaction(**credentials)


if __name__ == "__main__":
    main()
