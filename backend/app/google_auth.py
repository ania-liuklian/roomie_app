"""Verification of Google Identity Services ID tokens (not Google access tokens)."""
import os
from functools import partial

from fastapi import HTTPException
from google.auth import exceptions as google_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token


def verify_google_credential(credential: str) -> dict:
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        raise HTTPException(503, "Google sign-in is not configured")
    try:
        request = partial(google_requests.Request(), timeout=5)
        claims = id_token.verify_oauth2_token(credential, request, client_id)
    except google_exceptions.TransportError:
        raise HTTPException(503, "Google signing keys temporarily unavailable") from None
    except (ValueError, google_exceptions.GoogleAuthError):
        raise HTTPException(401, "Invalid Google credentials") from None
    # Reject unverified email addresses and missing immutable Google identity IDs.
    if claims.get("email_verified") is not True or not claims.get("sub") or not claims.get("email"):
        raise HTTPException(401, "Google account email is not verified")
    return claims
