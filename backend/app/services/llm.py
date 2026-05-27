"""
Claude LLM service.

Builds prompts with retrieved Capella context and calls
the Anthropic Messages API. Uses OpenAI text-embedding-3-small
for real semantic embeddings stored in Capella.
"""

import logging
from typing import AsyncGenerator

import anthropic
import httpx

from app.core.config import get_settings
from app.services.memory import memory_service

logger = logging.getLogger(__name__)
settings = get_settings()

_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

SYSTEM_PROMPT = """
You are a helpful, concise voice AI assistant.
Your responses will be converted to speech, so:
- Keep answers short and natural (1-3 sentences unless detail is truly needed).
- Avoid markdown, bullet points, or code unless explicitly asked.
- Speak in a warm, conversational tone.
- If you don't know something, say so clearly and briefly.
- If context from documents is provided, use it to answer accurately.
"""

OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings"


# ---------------------------------------------------------------------------
# Real embedding via OpenAI text-embedding-3-small
# ---------------------------------------------------------------------------

async def get_embedding(text: str) -> list[float]:
    """
    Generate a real 1536-dim embedding using OpenAI text-embedding-3-small.
    Enables actual semantic search in Couchbase Capella.
    """
    if not settings.openai_api_key:
        logger.warning("OPENAI_API_KEY not set — returning zero vector")
        return [0.0] * 1536

    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "text-embedding-3-small",
        "input": text,
        "dimensions": 1536,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                OPENAI_EMBED_URL,
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            return data["data"][0]["embedding"]
    except Exception as e:
        logger.error("Embedding failed: %s — returning zero vector", e)
        return [0.0] * 1536


# ---------------------------------------------------------------------------
# Main LLM call
# ---------------------------------------------------------------------------

async def generate_response(
    session_id: str,
    user_text: str,
    stream: bool = False,
) -> str | AsyncGenerator[str, None]:
    """
    1. Embed the user turn with real OpenAI embeddings.
    2. Retrieve relevant context from Capella vector search.
    3. Build a prompt and call Claude.
    4. Store both turns in Capella with real embeddings.
    5. Return the assistant reply text.
    """
    # 1. Real embedding
    user_embedding = await get_embedding(user_text)

    # 2. Retrieve context from Capella
    context_turns = await memory_service.get_relevant_context(
        session_id=session_id,
        query_embedding=user_embedding,
        top_k=settings.max_memory_turns,
    )

    # 3. Build messages list
    messages: list[dict] = []
    for turn in context_turns:
        role = turn.get("role", "user")
        text = turn.get("text", "")
        if role in ("user", "assistant", "system") and text:
            messages.append({"role": role if role != "system" else "user", "content": text})

    # Append current user turn
    messages.append({"role": "user", "content": user_text})

    # 4. Call Claude
    if stream:
        return _stream_response(session_id, user_text, user_embedding, messages)
    else:
        response = _client.messages.create(
            model=settings.claude_model,
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        reply = response.content[0].text

        # 5. Store both turns with real embeddings
        await memory_service.store_turn(session_id, "user", user_text, user_embedding)
        reply_embedding = await get_embedding(reply)
        await memory_service.store_turn(session_id, "assistant", reply, reply_embedding)

        return reply


async def _stream_response(
    session_id: str,
    user_text: str,
    user_embedding: list[float],
    messages: list[dict],
) -> AsyncGenerator[str, None]:
    """Streaming wrapper — yields text chunks, stores on completion."""
    full_reply = ""
    with _client.messages.stream(
        model=settings.claude_model,
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=messages,
    ) as stream:
        for chunk in stream.text_stream:
            full_reply += chunk
            yield chunk

    await memory_service.store_turn(session_id, "user", user_text, user_embedding)
    reply_embedding = await get_embedding(full_reply)
    await memory_service.store_turn(session_id, "assistant", full_reply, reply_embedding)