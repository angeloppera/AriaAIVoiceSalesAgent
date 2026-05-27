import os
from openai import OpenAI
from app.core.config import get_settings

settings = get_settings()

_client = OpenAI(api_key=settings.openai_api_key)

async def synthesize_text(text: str) -> bytes:
    response = _client.audio.speech.create(
        model="tts-1",
        voice="nova",
        input=text,
        response_format="mp3",
    )
    return response.content