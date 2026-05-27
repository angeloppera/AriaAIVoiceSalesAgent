"""
Couchbase Capella memory service.

Stores conversation turns as JSON documents and performs
vector search to retrieve semantically relevant context
for the LLM on each new user turn.

Vector index must be created manually in Capella UI:
  - Collection: conversations
  - Field: embedding  (type: vector, dims: 1536, similarity: dot_product)
"""

import uuid
import time
import logging
from datetime import datetime
from typing import Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class CapellaMemoryService:
    """Manages conversation memory in Couchbase Capella with vector search."""

    def __init__(self):
        self._cluster = None
        self._collection = None
        self._connected = False

    def connect(self):
        """Initialize Couchbase connection (call at app startup)."""
        from couchbase.auth import PasswordAuthenticator
        from couchbase.cluster import Cluster
        from couchbase.options import ClusterOptions

        auth = PasswordAuthenticator(
            settings.couchbase_username,
            settings.couchbase_password,
        )
        self._cluster = Cluster(
            settings.couchbase_connection_string,
            ClusterOptions(auth),
        )
        bucket = self._cluster.bucket(settings.couchbase_bucket)
        scope = bucket.scope(settings.couchbase_scope)
        self._collection = scope.collection(settings.couchbase_collection)
        self._connected = True
        logger.info("Connected to Couchbase Capella")

    def disconnect(self):
        if self._cluster:
            self._cluster.close()
            self._connected = False
            logger.info("Couchbase connection closed")

    # ------------------------------------------------------------------
    # Store a turn
    # ------------------------------------------------------------------
    async def store_turn(
        self,
        session_id: str,
        role: str,
        text: str,
        embedding: list[float],
    ) -> str:
        """Upsert a conversation turn document with its embedding vector."""
        if not self._connected:
            logger.warning("Couchbase not connected — skipping store_turn")
            return ""

        doc_id = f"{session_id}::{uuid.uuid4()}"
        doc = {
            "session_id": session_id,
            "role": role,
            "text": text,
            "embedding": embedding,
            "timestamp": datetime.utcnow().isoformat(),
            "ts_epoch": time.time(),
        }
        try:
            self._collection.upsert(doc_id, doc)
            logger.debug("Stored turn %s [%s]", doc_id, role)
        except Exception as e:
            logger.error("Failed to store turn: %s", e)
        return doc_id

    # ------------------------------------------------------------------
    # Retrieve relevant context
    # ------------------------------------------------------------------
    async def get_relevant_context(
        self,
        session_id: str,
        query_embedding: list[float],
        top_k: int = 4,
    ) -> list[dict]:
        """Vector-search for the most semantically relevant past turns."""
        if not self._connected:
            return []

        try:
            from couchbase.vector_search import VectorQuery, VectorSearch
            from couchbase.options import SearchOptions

            search = VectorSearch.from_vector_query(
                VectorQuery(
                    "embedding",
                    query_embedding,
                    num_candidates=top_k * 3,
                )
            )
            result = self._cluster.search(
                settings.couchbase_search_index,
                search,
                SearchOptions(
                    limit=top_k,
                    fields=["session_id", "role", "text", "ts_epoch"],
                ),
            )
            rows = []
            for row in result.rows():
                fields = row.fields
                if fields.get("session_id") == session_id:
                    rows.append(fields)

            rows.sort(key=lambda r: r.get("ts_epoch", 0))
            return rows

        except Exception as e:
            logger.error("Vector search failed: %s", e)
            return []

    # ------------------------------------------------------------------
    # Session tail (last N turns via N1QL)
    # ------------------------------------------------------------------
    async def get_session_tail(
        self,
        session_id: str,
        n: int = 6,
    ) -> list[dict]:
        """Fetch the most recent N turns for a session via N1QL."""
        if not self._connected:
            return []

        try:
            query = f"""
                SELECT role, text, ts_epoch
                FROM `{settings.couchbase_bucket}`.`{settings.couchbase_scope}`.`{settings.couchbase_collection}`
                WHERE session_id = $session_id
                ORDER BY ts_epoch DESC
                LIMIT $n
            """
            result = self._cluster.query(
                query,
                named_parameters={"session_id": session_id, "n": n},
            )
            rows = [row for row in result.rows()]
            rows.sort(key=lambda r: r.get("ts_epoch", 0))
            return rows
        except Exception as e:
            logger.error("Session tail query failed: %s", e)
            return []


# Singleton
memory_service = CapellaMemoryService()