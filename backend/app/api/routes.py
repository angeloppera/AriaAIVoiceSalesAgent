"""
API routes — Sales Voice AI Agent (Aria)
"""

import json
import logging
import uuid
import csv
import io
from urllib.parse import quote

from fastapi import APIRouter, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, JSONResponse

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

@router.post("/session")
async def create_session(channel: str | None = None):
    try:
        from app.services.agora_token import generate_rtc_token
        session_id = str(uuid.uuid4())
        channel_name = channel or f"voice-{session_id[:8]}"
        token = generate_rtc_token(channel_name)
        return {
            "session_id": session_id,
            "channel": channel_name,
            "token": token,
            "app_id": settings.agora_app_id,
        }
    except Exception as e:
        logger.error("Session error: %s", e)
        session_id = str(uuid.uuid4())
        return {
            "session_id": session_id,
            "channel": f"voice-{session_id[:8]}",
            "token": "",
            "app_id": settings.agora_app_id,
        }




# ---------------------------------------------------------------------------
# Admin auth
# ---------------------------------------------------------------------------

@router.post("/admin/login")
async def admin_login(password: str = Form(...)):
    """Validate admin password."""
    if password == settings.admin_password:
        return {"status": "ok", "token": password}
    from fastapi import HTTPException
    raise HTTPException(status_code=401, detail="Invalid password")


@router.get("/admin/verify")
async def admin_verify(token: str):
    """Verify admin token."""
    if token == settings.admin_password:
        return {"status": "ok"}
    from fastapi import HTTPException
    raise HTTPException(status_code=401, detail="Invalid token")

# ---------------------------------------------------------------------------
# STT
# ---------------------------------------------------------------------------

@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    from app.services.stt import transcribe_audio
    data = await audio.read()
    mimetype = audio.content_type or "audio/webm"
    text = await transcribe_audio(data, mimetype)
    return {"transcript": text}


# ---------------------------------------------------------------------------
# Step 1 — Get AI text reply only
# ---------------------------------------------------------------------------

@router.post("/respond/text")
async def respond_text(
    session_id: str = Form(...),
    text: str = Form(...),
):
    from app.services.openai_rag import generate_rag_response
    from app.services.lead_capture import process_conversation_turn

    voice_text, order_data = await generate_rag_response(session_id, text)
    await process_conversation_turn(session_id, text, voice_text, order_data)
    return JSONResponse({"reply": voice_text, "session_id": session_id, "order": order_data})


# ---------------------------------------------------------------------------
# Step 2 — TTS only
# ---------------------------------------------------------------------------

@router.post("/respond/audio")
async def respond_audio(
    session_id: str = Form(...),
    text: str = Form(...),
):
    from app.services.tts import synthesize_text
    audio_bytes = await synthesize_text(text)
    return StreamingResponse(iter([audio_bytes]), media_type="audio/mpeg")


# ---------------------------------------------------------------------------
# Combined respond
# ---------------------------------------------------------------------------

@router.post("/respond")
async def respond(
    session_id: str = Form(...),
    text: str = Form(...),
):
    from app.services.openai_rag import generate_rag_response
    from app.services.tts import synthesize_text
    from app.services.lead_capture import process_conversation_turn

    reply_text = await generate_rag_response(session_id, text)
    await process_conversation_turn(session_id, text, reply_text)
    audio_bytes = await synthesize_text(reply_text)

    return StreamingResponse(
        iter([audio_bytes]),
        media_type="audio/mpeg",
        headers={
            "X-Transcript": reply_text[:200],
            "X-Transcript-Full": quote(reply_text, safe=''),
        },
    )


@router.get("/respond/stream")
async def respond_stream(session_id: str, text: str):
    from app.services.openai_rag import generate_rag_response
    from app.services.tts import synthesize_stream
    from app.services.lead_capture import process_conversation_turn

    voice_text, order_data = await generate_rag_response(session_id, text)
    await process_conversation_turn(session_id, text, voice_text, order_data)

    async def audio_generator():
        async for chunk in synthesize_stream(voice_text):
            yield chunk

    return StreamingResponse(
        audio_generator(),
        media_type="audio/mpeg",
        headers={
            "X-Transcript": voice_text[:200],
            "X-Transcript-Full": quote(voice_text, safe=''),
        },
    )


# ---------------------------------------------------------------------------
# Document upload
# ---------------------------------------------------------------------------

@router.post("/upload-document")
async def upload_document(
    file: UploadFile = File(...),
    knowledge_base_id: str = Form(default="global"),
):
    from app.services.openai_rag import upload_file_to_vector_store
    from fastapi import HTTPException

    content = await file.read()
    mimetype = file.content_type or "application/octet-stream"
    try:
        result = await upload_file_to_vector_store(
            content_bytes=content,
            filename=file.filename or "document",
            mimetype=mimetype,
        )
        return {"status": "success", **result}
    except Exception as e:
        logger.error("Upload error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Reset Knowledge Base
# ---------------------------------------------------------------------------

@router.delete("/knowledge-base")
async def reset_knowledge_base():
    from app.services.openai_rag import (
        _client, _ASSISTANT_ID_FILE, _VECTOR_STORE_ID_FILE, init_openai_rag,
    )
    import app.services.openai_rag as rag
    from fastapi import HTTPException

    try:
        deleted_files = 0
        if rag._vector_store_id:
            vs_files = _client.vector_stores.files.list(
                vector_store_id=rag._vector_store_id
            )
            for vs_file in vs_files.data:
                try:
                    _client.vector_stores.files.delete(
                        vector_store_id=rag._vector_store_id,
                        file_id=vs_file.id,
                    )
                    _client.files.delete(vs_file.id)
                    deleted_files += 1
                except Exception as e:
                    logger.warning("Could not delete file %s: %s", vs_file.id, e)
            try:
                _client.vector_stores.delete(rag._vector_store_id)
            except Exception as e:
                logger.warning("Could not delete vector store: %s", e)

        if rag._assistant_id:
            try:
                _client.beta.assistants.delete(rag._assistant_id)
            except Exception as e:
                logger.warning("Could not delete assistant: %s", e)

        rag._vector_store_id = None
        rag._assistant_id = None
        rag._session_threads = {}

        if _ASSISTANT_ID_FILE.exists():
            _ASSISTANT_ID_FILE.unlink()
        if _VECTOR_STORE_ID_FILE.exists():
            _VECTOR_STORE_ID_FILE.unlink()

        init_openai_rag()

        return {
            "status": "reset",
            "deleted_files": deleted_files,
            "message": "Knowledge base cleared. Aria is ready for new documents.",
        }
    except Exception as e:
        logger.error("Reset error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Data Capture — Dashboard stats
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def get_dashboard():
    """Return summary stats for the sales dashboard."""
    from app.services.memory import memory_service
    from fastapi import HTTPException

    if not memory_service._connected:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # Total leads
        leads_q = f"""
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN name IS NOT NULL THEN 1 END) as with_name,
                   COUNT(CASE WHEN contact IS NOT NULL THEN 1 END) as with_contact
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE type = 'lead'
        """
        leads_result = list(memory_service._cluster.query(leads_q).rows())
        lead_stats = leads_result[0] if leads_result else {}

        # Total conversations
        conv_q = f"""
            SELECT COUNT(*) as total,
                   COUNT(DISTINCT session_id) as sessions
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE type = 'conversation'
        """
        conv_result = list(memory_service._cluster.query(conv_q).rows())
        conv_stats = conv_result[0] if conv_result else {}

        # Recent leads (last 5)
        recent_q = f"""
            SELECT session_id, name, contact, quantity, created_at, user_message
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE type = 'lead'
            ORDER BY created_at DESC
            LIMIT 5
        """
        recent_leads = list(memory_service._cluster.query(recent_q).rows())

        # Transaction stats
        tx_q = f"""
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
                   COUNT(CASE WHEN status = 'fulfilled' THEN 1 END) as fulfilled
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE type = 'transaction'
        """
        tx_result = list(memory_service._cluster.query(tx_q).rows())
        tx_stats = tx_result[0] if tx_result else {}

        # Recent transactions
        recent_tx_q = f"""
            SELECT session_id, name, contact, quantity, status, created_at
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE type = 'transaction'
            ORDER BY created_at DESC
            LIMIT 5
        """
        recent_transactions = list(memory_service._cluster.query(recent_tx_q).rows())

        return {
            "leads": {
                "total": lead_stats.get("total", 0),
                "with_name": lead_stats.get("with_name", 0),
                "with_contact": lead_stats.get("with_contact", 0),
            },
            "conversations": {
                "total": conv_stats.get("total", 0),
                "sessions": conv_stats.get("sessions", 0),
            },
            "transactions": {
                "total": tx_stats.get("total", 0),
                "confirmed": tx_stats.get("confirmed", 0),
                "fulfilled": tx_stats.get("fulfilled", 0),
            },
            "recent_leads": recent_leads,
            "recent_transactions": recent_transactions,
        }
    except Exception as e:
        logger.error("Dashboard error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Data Capture — All leads
# ---------------------------------------------------------------------------

@router.get("/leads")
async def get_leads():
    from app.services.memory import memory_service
    from fastapi import HTTPException

    if not memory_service._connected:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        query = f"""
            SELECT META().id as doc_id, session_id, name, contact,
                   quantity, price, status, created_at, user_message, ai_reply
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE type = 'lead'
            ORDER BY created_at DESC
            LIMIT 200
        """
        leads = list(memory_service._cluster.query(query).rows())
        return {"leads": leads, "count": len(leads)}
    except Exception as e:
        logger.error("Leads error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Data Handoff — Export leads as CSV
# ---------------------------------------------------------------------------

@router.get("/leads/export")
async def export_leads_csv():
    """Export all leads as a downloadable CSV file."""
    from app.services.memory import memory_service
    from fastapi import HTTPException

    if not memory_service._connected:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = f"""
            SELECT session_id, name, contact, quantity,
                   price, status, created_at, user_message, ai_reply
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE type = 'lead'
            ORDER BY created_at DESC
        """
        leads = list(memory_service._cluster.query(query).rows())

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=[
            "date", "name", "contact", "quantity", "price",
            "status", "customer_message", "aria_reply", "session_id"
        ])
        writer.writeheader()
        for lead in leads:
            writer.writerow({
                "date": lead.get("created_at", ""),
                "name": lead.get("name", ""),
                "contact": lead.get("contact", ""),
                "quantity": lead.get("quantity", ""),
                "price": lead.get("price", ""),
                "status": lead.get("status", "new"),
                "customer_message": lead.get("user_message", ""),
                "aria_reply": lead.get("ai_reply", ""),
                "session_id": lead.get("session_id", ""),
            })

        csv_content = output.getvalue()
        return StreamingResponse(
            iter([csv_content.encode()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=aria_leads.csv"
            },
        )
    except Exception as e:
        logger.error("CSV export error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Data Handoff — Full conversation transcript per session
# ---------------------------------------------------------------------------

@router.get("/conversations")
async def get_conversations(session_id: str | None = None):
    from app.services.memory import memory_service
    from fastapi import HTTPException

    if not memory_service._connected:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        where = "type = 'conversation'"
        if session_id:
            where += f" AND session_id = '{session_id}'"
        query = f"""
            SELECT META().id as doc_id, session_id,
                   user_message, ai_reply, created_at
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT 100
        """
        conversations = list(memory_service._cluster.query(query).rows())
        return {"conversations": conversations, "count": len(conversations)}
    except Exception as e:
        logger.error("Conversations error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversations/export")
async def export_conversations_csv(session_id: str | None = None):
    """Export conversation transcripts as CSV."""
    from app.services.memory import memory_service
    from fastapi import HTTPException

    if not memory_service._connected:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        where = "type = 'conversation'"
        if session_id:
            where += f" AND session_id = '{session_id}'"
        query = f"""
            SELECT session_id, user_message, ai_reply, created_at
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE {where}
            ORDER BY created_at ASC
        """
        conversations = list(memory_service._cluster.query(query).rows())

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=[
            "date", "session_id", "customer_message", "aria_reply"
        ])
        writer.writeheader()
        for conv in conversations:
            writer.writerow({
                "date": conv.get("created_at", ""),
                "session_id": conv.get("session_id", ""),
                "customer_message": conv.get("user_message", ""),
                "aria_reply": conv.get("ai_reply", ""),
            })

        return StreamingResponse(
            iter([output.getvalue().encode()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=aria_conversations.csv"
            },
        )
    except Exception as e:
        logger.error("Conversations export error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Update lead status (handoff)
# ---------------------------------------------------------------------------

@router.patch("/leads/{doc_id}/status")
async def update_lead_status(doc_id: str, status: str = Form(...)):
    """Update lead status: new → contacted → converted → closed"""
    from app.services.memory import memory_service
    from fastapi import HTTPException

    valid_statuses = ["new", "contacted", "converted", "closed"]
    if status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {valid_statuses}"
        )

    if not memory_service._connected:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        from couchbase.subdocument import replace
        memory_service._collection.mutate_in(
            doc_id,
            [replace("status", status)]
        )
        return {"doc_id": doc_id, "status": status}
    except Exception as e:
        logger.error("Status update error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@router.websocket("/ws/voice/{session_id}")
async def voice_websocket(websocket: WebSocket, session_id: str):
    from app.services.stt import DeepgramLiveSession
    from app.services.openai_rag import generate_rag_response
    from app.services.tts import synthesize_stream
    from app.services.lead_capture import process_conversation_turn

    await websocket.accept()
    transcript_buffer = []

    async def on_transcript(text: str, is_final: bool):
        if is_final and text:
            transcript_buffer.append(text)
            full_text = " ".join(transcript_buffer)
            transcript_buffer.clear()

            await websocket.send_json({"type": "transcript", "text": full_text})
            await websocket.send_json({"type": "thinking"})

            voice_text, order_data = await generate_rag_response(session_id, full_text)
            await process_conversation_turn(session_id, full_text, voice_text, order_data)

            await websocket.send_json({"type": "reply", "text": voice_text, "order": order_data})
            await websocket.send_json({"type": "audio_start"})

            async for chunk in synthesize_stream(voice_text):
                await websocket.send_bytes(chunk)

            await websocket.send_json({"type": "audio_end"})
        elif not is_final and text:
            await websocket.send_json({"type": "interim", "text": text})

    try:
        async with DeepgramLiveSession(on_transcript=on_transcript) as dg:
            while True:
                msg = await websocket.receive()
                if "bytes" in msg and msg["bytes"]:
                    await dg.send_audio(msg["bytes"])
                elif "text" in msg:
                    try:
                        ctrl = json.loads(msg["text"])
                        if ctrl.get("action") == "stop":
                            break
                    except Exception:
                        pass
    except WebSocketDisconnect:
        logger.info("WS disconnected: session=%s", session_id)
    except Exception as e:
        logger.error("WS error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------

@router.get("/transactions")
async def get_transactions():
    """Return all sales transactions from Couchbase."""
    from app.services.memory import memory_service
    from fastapi import HTTPException

    if not memory_service._connected:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        query = f"""
            SELECT META().id as doc_id, session_id, name, contact,
                   product, description, quantity, unit, unit_price, total_price, currency, status, created_at, user_message, ai_reply
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE type = 'transaction'
            ORDER BY created_at DESC
            LIMIT 200
        """
        transactions = list(memory_service._cluster.query(query).rows())
        return {"transactions": transactions, "count": len(transactions)}
    except Exception as e:
        logger.error("Transactions error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/transactions/export")
async def export_transactions_csv():
    """Export all transactions as CSV."""
    from app.services.memory import memory_service
    from fastapi import HTTPException

    if not memory_service._connected:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        query = f"""
            SELECT session_id, name, contact, product, description,
                   quantity, unit, unit_price, total_price, currency,
                   status, created_at, user_message, ai_reply
            FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
            WHERE type = 'transaction'
            ORDER BY created_at DESC
        """
        transactions = list(memory_service._cluster.query(query).rows())

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=[
            "date", "customer_name", "contact_number", "product",
            "description", "quantity", "unit", "unit_price", "total_price", "currency",
            "status", "customer_message", "aria_reply", "session_id"
        ])
        writer.writeheader()
        for tx in transactions:
            writer.writerow({
                "date": tx.get("created_at", ""),
                "customer_name": tx.get("name", ""),
                "contact_number": tx.get("contact", ""),
                "product": tx.get("product", ""),
                "description": tx.get("description", ""),
                "quantity": tx.get("quantity", ""),
                "unit": tx.get("unit", ""),
                "unit_price": tx.get("unit_price", ""),
                "total_price": tx.get("total_price", ""),
                "currency": tx.get("currency", "PHP"),
                "status": tx.get("status", ""),
                "customer_message": tx.get("user_message", ""),
                "aria_reply": tx.get("ai_reply", ""),
                "session_id": tx.get("session_id", ""),
            })

        return StreamingResponse(
            iter([output.getvalue().encode()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=aria_transactions.csv"},
        )
    except Exception as e:
        logger.error("Transactions export error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/transactions/{doc_id}/status")
async def update_transaction_status(doc_id: str, status: str = Form(...)):
    """Update transaction status: pending → confirmed → fulfilled → cancelled"""
    from app.services.memory import memory_service
    from fastapi import HTTPException
    from couchbase.subdocument import replace

    valid = ["pending", "confirmed", "fulfilled", "cancelled"]
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Must be one of: {valid}")
    if not memory_service._connected:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        memory_service._collection.mutate_in(doc_id, [replace("status", status)])
        return {"doc_id": doc_id, "status": status}
    except Exception as e:
        logger.error("Status update error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))