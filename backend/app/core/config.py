from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Agora
    agora_app_id: str
    agora_app_certificate: str = ""

    # Anthropic
    anthropic_api_key: str
    claude_model: str = "claude-sonnet-4-20250514"

    # OpenAI (embeddings + optional TTS)
    openai_api_key: str = ""
    openai_tts_model: str = "tts-1"
    openai_tts_voice: str = "alloy"

    # Deepgram
    deepgram_api_key: str

    # ElevenLabs
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"

    # Couchbase Capella
    couchbase_connection_string: str
    couchbase_username: str
    couchbase_password: str
    couchbase_bucket: str = "voice_agent"
    couchbase_scope: str = "agent"
    couchbase_collection: str = "conversations"
    couchbase_search_index: str = "conversations_vector_idx"

    # App
    admin_password: str = "aria2026"
    cors_origins: str = "http://localhost:5173"
    max_memory_turns: int = 6

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()