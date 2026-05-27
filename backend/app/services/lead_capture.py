"""
Lead capture + Sales transaction service.

Transactions are saved from Aria's structured JSON output — accurate.
Leads are saved from simple intent detection — best-effort.
"""

import uuid
import time
import re
import logging

from app.services.memory import memory_service

logger = logging.getLogger(__name__)

# ── Intent keywords for lead detection ────────────────────────────────────
INTENT_KEYWORDS = [
    "order", "buy", "purchase", "want", "interested", "how much",
    "price", "cost", "quantity", "available", "deliver", "shipping",
    "book", "reserve", "i want", "i need", "can i get",
    "place an order", "i'd like", "send me", "give me",
]


def detect_intent(text: str) -> bool:
    return any(kw in text.lower() for kw in INTENT_KEYWORDS)


# ── Save confirmed transaction from structured order data ──────────────────

async def save_transaction_from_order(
    session_id: str,
    order: dict,
    user_text: str,
    ai_reply: str,
) -> str | None:
    """
    Save a sales transaction using Aria's structured order output.
    All fields come directly from the JSON — no regex guessing.
    """
    if not memory_service._connected:
        logger.warning("Couchbase not connected — transaction not saved")
        return None

    doc_id = f"transaction::{session_id}::{uuid.uuid4()}"
    doc = {
        "type": "transaction",
        "session_id": session_id,
        # Clean structured fields from Aria's JSON
        "name": order.get("name"),
        "contact": order.get("contact"),
        "product": order.get("product"),
        "description": order.get("description"),
        "quantity": order.get("quantity"),
        "unit": order.get("unit"),
        "unit_price": order.get("unit_price"),
        "total_price": order.get("total_price"),
        "currency": order.get("currency", "PHP"),
        # Raw conversation context
        "user_message": user_text,
        "ai_reply": ai_reply,
        "status": "confirmed",
        "ts_epoch": time.time(),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
    }
    try:
        memory_service._collection.upsert(doc_id, doc)
        logger.info(
            "Transaction saved: %s | name=%s product=%s qty=%s unit_price=%s total=%s",
            doc_id,
            doc["name"], doc["product"],
            doc["quantity"], doc["unit_price"], doc["total_price"],
        )
        return doc_id
    except Exception as e:
        logger.error("Failed to save transaction: %s", e)
        return None


# ── Save lead from intent detection ───────────────────────────────────────

async def save_lead(
    session_id: str,
    user_text: str,
    ai_reply: str,
) -> str | None:
    """Save a lead when buying intent is detected (no confirmed order yet)."""
    if not memory_service._connected:
        return None

    doc_id = f"lead::{session_id}::{uuid.uuid4()}"
    doc = {
        "type": "lead",
        "session_id": session_id,
        "user_message": user_text,
        "ai_reply": ai_reply,
        "status": "new",
        "ts_epoch": time.time(),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
    }
    try:
        memory_service._collection.upsert(doc_id, doc)
        logger.info("Lead saved: %s", doc_id)
        return doc_id
    except Exception as e:
        logger.error("Failed to save lead: %s", e)
        return None


# ── Main entry point ───────────────────────────────────────────────────────

async def process_conversation_turn(
    session_id: str,
    user_text: str,
    ai_reply: str,
    order_data: dict | None = None,
):
    """
    Store conversation turn.
    If order_data is present (from Aria's structured output) → save transaction.
    If buying intent detected → save lead.
    """
    # Always store conversation turn
    turn_doc_id = f"conv::{session_id}::{uuid.uuid4()}"
    turn_doc = {
        "type": "conversation",
        "session_id": session_id,
        "user_message": user_text,
        "ai_reply": ai_reply,
        "ts_epoch": time.time(),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
    }
    try:
        if memory_service._connected:
            memory_service._collection.upsert(turn_doc_id, turn_doc)
    except Exception as e:
        logger.error("Failed to store conversation: %s", e)

    # Confirmed order with structured data → save accurate transaction
    if order_data:
        logger.info("Structured order received — saving transaction")
        await save_transaction_from_order(
            session_id=session_id,
            order=order_data,
            user_text=user_text,
            ai_reply=ai_reply,
        )

    # Buying intent only → save lead
    elif detect_intent(user_text):
        await save_lead(
            session_id=session_id,
            user_text=user_text,
            ai_reply=ai_reply,
        )