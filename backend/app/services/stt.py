"""
Deepgram Speech-to-Text service — one-shot transcription.
"""

import logging
import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"


async def transcribe_audio(audio_bytes: bytes, mimetype: str = "audio/webm") -> str:
    """
    Send audio bytes to Deepgram REST API and return transcript.
    Uses httpx directly — avoids SDK async compatibility issues.
    """
    params = {
        "model": "nova-2",
        "smart_format": "true",
        "punctuate": "true",
        "language": "en-US",
    }
    headers = {
        "Authorization": f"Token {settings.deepgram_api_key}",
        "Content-Type": mimetype,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                DEEPGRAM_URL,
                content=audio_bytes,
                headers=headers,
                params=params,
            )
            response.raise_for_status()
            data = response.json()
            transcript = (
                data["results"]["channels"][0]["alternatives"][0]["transcript"]
            )
            logger.info("Transcript: %s", transcript)
            return transcript
    except httpx.HTTPStatusError as e:
        logger.error("Deepgram HTTP error %s: %s", e.response.status_code, e.response.text)
        raise
    except (KeyError, IndexError) as e:
        logger.error("Deepgram response parse error: %s", e)
        return ""
    except Exception as e:
        logger.error("Deepgram transcription error: %s", e)
        raise