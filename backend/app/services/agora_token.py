"""
Agora RTC token generator.

Generates a temporary RTC token using the Agora Token Builder.
In production, set a short expiry and refresh tokens on the client.

If AGORA_APP_CERTIFICATE is empty, returns "" (App ID only mode —
acceptable for local development, NOT for production).
"""

import time
from app.core.config import get_settings

settings = get_settings()


def generate_rtc_token(
    channel_name: str,
    uid: int = 0,
    role: int = 1,          # 1 = publisher, 2 = subscriber
    expiry_seconds: int = 3600,
) -> str:
    """
    Returns an Agora RTC token string.
    Falls back to "" when no App Certificate is configured (dev mode).
    """
    cert = settings.agora_app_certificate
    if not cert:
        return ""

    try:
        from agora_token_builder import RtcTokenBuilder, Role_Publisher
        expiry_ts = int(time.time()) + expiry_seconds
        token = RtcTokenBuilder.buildTokenWithUid(
            settings.agora_app_id,
            cert,
            channel_name,
            uid,
            Role_Publisher,
            expiry_ts,
        )
        return token
    except ImportError:
        # agora-token-builder not installed — dev mode
        return ""
