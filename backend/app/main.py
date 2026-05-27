"""
Voice AI Assistant — FastAPI backend entry point.

Run with:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.api.routes import router
from app.services.memory import memory_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Couchbase (session storage — optional)
    logger.info("Connecting to Couchbase Capella…")
    try:
        memory_service.connect()
        logger.info("Couchbase Capella connected.")
    except Exception as e:
        logger.warning("Couchbase connection failed: %s", e)

    # OpenAI RAG bootstrap
    logger.info("Initializing OpenAI RAG (Assistant + Vector Store)…")
    try:
        from app.services.openai_rag import init_openai_rag
        init_openai_rag()
    except Exception as e:
        logger.warning("OpenAI RAG init failed: %s", e)

    yield

    try:
        memory_service.disconnect()
    except Exception:
        pass


app = FastAPI(
    title="Voice AI Assistant",
    description="Agora RTC + Deepgram STT + Claude + OpenAI RAG + ElevenLabs TTS",
    version="2.0.0",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.cors_origins.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok"}