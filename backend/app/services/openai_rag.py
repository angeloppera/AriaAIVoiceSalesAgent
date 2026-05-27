"""
OpenAI RAG service — Sales AI Agent (Aria)
Assistants API + Vector Store + structured order output.
"""

import re
import json
import time
import logging
from pathlib import Path

from openai import OpenAI
from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_client = OpenAI(api_key=settings.openai_api_key)

ASSISTANT_NAME = "Sales AI Agent — Aria"
VECTOR_STORE_NAME = "sales_knowledge_base"

_ID_DIR = Path(__file__).parent.parent.parent
_ASSISTANT_ID_FILE = _ID_DIR / ".assistant_id"
_VECTOR_STORE_ID_FILE = _ID_DIR / ".vector_store_id"

SYSTEM_PROMPT = """You are Aria, a friendly and professional AI Sales Agent.
Your knowledge comes entirely from the documents in your knowledge base.

SALES CONVERSATION FLOW:
1. GREET — Welcome the customer warmly, introduce yourself as Aria.
2. DISCOVER — Ask what they are looking for.
3. RECOMMEND — Use the knowledge base to suggest the right product.
4. HANDLE OBJECTIONS — Address concerns using knowledge base facts.
5. CLOSE — Guide the customer to place an order.
6. COLLECT ORDER DETAILS — Ask for:
   - Full name
   - Contact number
   - Product name and quantity
7. CONFIRM — Read back the order clearly:
   "Just to confirm: [Name], [quantity] of [product] at [price] each, contact [number]. Shall I finalize this order?"
8. FINALIZE — When customer confirms, say the voice reply AND output a JSON block.

CRITICAL INSTRUCTION — WHEN ORDER IS CONFIRMED:
When the customer confirms the order (says yes, go ahead, confirm, proceed, etc.),
you MUST output your response in this EXACT format — voice reply first, then JSON:

<VOICE>
Your order has been placed! Our team will contact you at [number] to arrange delivery. Thank you, [name]!
</VOICE>
<ORDER>
{
  "name": "customer full name",
  "contact": "contact number",
  "product": "exact product name from knowledge base",
  "description": "product description from knowledge base",
  "quantity": "number only e.g. 10",
  "unit": "unit e.g. cans, pcs, kg",
  "unit_price": "price per unit e.g. 42.00",
  "total_price": "total amount e.g. 420.00",
  "currency": "PHP"
}
</ORDER>

VOICE GUIDELINES:
- Keep voice responses short — 1 to 3 sentences.
- No bullet points or markdown in voice responses.
- Be warm, confident, and conversational.
- Only recommend products found in the knowledge base.
"""


def _load_id(path: Path) -> str | None:
    return path.read_text().strip() if path.exists() else None


def _save_id(path: Path, val: str):
    path.write_text(val)


def get_or_create_vector_store() -> str:
    vs_id = _load_id(_VECTOR_STORE_ID_FILE)
    if vs_id:
        try:
            _client.vector_stores.retrieve(vs_id)
            logger.info("Reusing Vector Store: %s", vs_id)
            return vs_id
        except Exception:
            logger.warning("Vector Store ID invalid — creating new")
    vs = _client.vector_stores.create(name=VECTOR_STORE_NAME)
    _save_id(_VECTOR_STORE_ID_FILE, vs.id)
    logger.info("Created Vector Store: %s", vs.id)
    return vs.id


def get_or_create_assistant(vector_store_id: str) -> str:
    asst_id = _load_id(_ASSISTANT_ID_FILE)
    if asst_id:
        try:
            _client.beta.assistants.update(
                asst_id,
                instructions=SYSTEM_PROMPT,
                tool_resources={"file_search": {"vector_store_ids": [vector_store_id]}},
            )
            logger.info("Reusing Assistant: %s", asst_id)
            return asst_id
        except Exception:
            logger.warning("Assistant ID invalid — creating new")
    asst = _client.beta.assistants.create(
        name=ASSISTANT_NAME,
        instructions=SYSTEM_PROMPT,
        model="gpt-4o-mini",
        tools=[{"type": "file_search"}],
        tool_resources={"file_search": {"vector_store_ids": [vector_store_id]}},
    )
    _save_id(_ASSISTANT_ID_FILE, asst.id)
    logger.info("Created Assistant: %s", asst.id)
    return asst.id


_vector_store_id: str | None = None
_assistant_id: str | None = None


def init_openai_rag():
    global _vector_store_id, _assistant_id
    try:
        _vector_store_id = get_or_create_vector_store()
        _assistant_id = get_or_create_assistant(_vector_store_id)
        logger.info("Sales AI RAG ready — VS: %s | Assistant: %s",
                    _vector_store_id, _assistant_id)
    except Exception as e:
        logger.error("OpenAI RAG init failed: %s", e)


async def upload_file_to_vector_store(
    content_bytes: bytes,
    filename: str,
    mimetype: str,
) -> dict:
    global _vector_store_id
    if not _vector_store_id:
        _vector_store_id = get_or_create_vector_store()

    uploaded = _client.files.create(
        file=(filename, content_bytes, mimetype),
        purpose="assistants",
    )
    _client.vector_stores.files.create(
        vector_store_id=_vector_store_id,
        file_id=uploaded.id,
    )
    for _ in range(30):
        vs_file = _client.vector_stores.files.retrieve(
            vector_store_id=_vector_store_id,
            file_id=uploaded.id,
        )
        if vs_file.status == "completed":
            break
        elif vs_file.status == "failed":
            raise Exception(f"Processing failed: {vs_file.last_error}")
        time.sleep(1)

    logger.info("File indexed: %s", filename)
    return {
        "file_id": uploaded.id,
        "filename": filename,
        "vector_store_id": _vector_store_id,
        "status": "indexed",
    }


_session_threads: dict[str, str] = {}


def parse_aria_response(raw: str) -> tuple[str, dict | None]:
    """
    Parse Aria's response into voice text and optional order data.

    Returns:
        (voice_text, order_dict | None)
    """
    # Remove file citations
    raw = re.sub(r"【.*?】", "", raw).strip()

    # Check for structured order output
    voice_match = re.search(r"<VOICE>(.*?)</VOICE>", raw, re.DOTALL)
    order_match = re.search(r"<ORDER>(.*?)</ORDER>", raw, re.DOTALL)

    if voice_match and order_match:
        voice_text = voice_match.group(1).strip()
        try:
            order_data = json.loads(order_match.group(1).strip())
            logger.info("Structured order captured: %s", order_data)
            return voice_text, order_data
        except json.JSONDecodeError as e:
            logger.error("Failed to parse order JSON: %s", e)
            return voice_text, None

    # No structured output — return full text as voice
    return raw, None


async def generate_rag_response(
    session_id: str,
    user_text: str,
) -> tuple[str, dict | None]:
    """
    Generate AI response.
    Returns (voice_text, order_data | None)
    """
    global _assistant_id
    if not _assistant_id:
        init_openai_rag()

    thread_id = _session_threads.get(session_id)
    if not thread_id:
        thread = _client.beta.threads.create()
        thread_id = thread.id
        _session_threads[session_id] = thread_id

    _client.beta.threads.messages.create(
        thread_id=thread_id,
        role="user",
        content=user_text,
    )

    run = _client.beta.threads.runs.create(
        thread_id=thread_id,
        assistant_id=_assistant_id,
    )

    for _ in range(90):
        run = _client.beta.threads.runs.retrieve(
            thread_id=thread_id,
            run_id=run.id,
        )
        if run.status == "completed":
            break
        elif run.status in ("failed", "cancelled", "expired"):
            raise Exception(f"OpenAI assistant run {run.status}. Please try again.")
        time.sleep(1)
    else:
        raise Exception("OpenAI assistant timed out. Please try again.")

    messages = _client.beta.threads.messages.list(
        thread_id=thread_id,
        order="desc",
        limit=1,
    )
    for msg in messages.data:
        if msg.role == "assistant":
            for block in msg.content:
                if block.type == "text":
                    raw = block.text.value
                    return parse_aria_response(raw)

    return "I'm sorry, I couldn't generate a response.", None