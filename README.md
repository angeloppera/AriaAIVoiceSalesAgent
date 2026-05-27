# Aria — AI Voice Sales Agent

> An intelligent voice-powered sales agent that conducts real-time conversations, answers product questions from a knowledge base, captures leads, executes sales transactions, and outputs actionable sales data — all by voice.

---

## Overview

Aria is a full-stack AI Sales Agent built on top of **Agora RTC**, **Deepgram STT**, **OpenAI RAG (Assistants API + Vector Store)**, **ElevenLabs TTS**, and **Couchbase Capella**. It allows any business to upload a product catalog and immediately deploy a voice AI agent that can greet customers, answer product questions, handle objections, confirm orders, and store structured transaction data for sales team follow-up.

---

## Key Features

| Feature | Description |
|---|---|
| Voice conversation | Real-time push-to-talk via Agora RTC + Deepgram nova-2 STT |
| RAG knowledge base | Upload any PDF/TXT catalog — OpenAI auto-chunks, embeds, and indexes |
| Sales transaction flow | 8-step guided flow: greet → discover → recommend → close → collect → confirm → finalize |
| Structured order capture | Aria outputs JSON order data (name, contact, product, qty, unit price, total) — no regex guessing |
| Lead detection | Buying intent automatically detected and saved as a lead |
| Couchbase storage | All conversations, leads, and transactions stored in Couchbase Capella |
| Sales dashboard | Overview stats, transactions table, leads table, conversation transcripts |
| CSV export | One-click export of orders and leads for sales team handoff |
| Knowledge base reset | Delete all uploaded files and start fresh with a new catalog |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Python 3.12 + FastAPI + Uvicorn |
| Real-time audio | Agora RTC Web SDK |
| Speech-to-text | Deepgram nova-2 (REST API) |
| AI Sales Agent | OpenAI GPT-4o-mini via Assistants API |
| RAG / Knowledge base | OpenAI Vector Store with file_search tool |
| Text-to-speech | ElevenLabs turbo-v2 |
| Database | Couchbase Capella (NoSQL cloud) |
| Embeddings | OpenAI text-embedding-3-small (via Vector Store) |

---

## System Architecture

```
User (browser)
    │ voice stream
    ▼
Agora RTC ──────────────────────────────────────────────────────┐
    │ PCM audio                                                  │
    ▼                                                            │
Deepgram STT (nova-2)                                           │
    │ transcript text                                            │
    ▼                                                            │
OpenAI RAG (Assistants API)  ◄── OpenAI Vector Store            │
    │                              (uploaded catalog)            │
    │ voice reply + ORDER JSON                                   │
    ├──────────────────────────────────────────────────────────► │
    │                        Lead Capture Service                │
    │                              │                             │
    │                              ▼                             │
    │                     Couchbase Capella                      │
    │                    (leads, transactions,                   │
    │                     conversations)                         │
    │                              │                             │
    │                              ▼                             │
    │                     Sales Dashboard                        │
    │                     (React frontend)                       │
    ▼
ElevenLabs TTS (turbo-v2)
    │ mp3 audio
    ▼
Agora RTC playback
    │
    ▼
User hears Aria
```

---

## Project Structure

```
voice-ai-assistant/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app, startup lifecycle
│   │   ├── core/
│   │   │   └── config.py            # Environment settings (pydantic-settings)
│   │   ├── api/
│   │   │   └── routes.py            # All REST + WebSocket endpoints
│   │   └── services/
│   │       ├── openai_rag.py        # OpenAI Assistants API + Vector Store
│   │       ├── lead_capture.py      # Transaction + lead storage service
│   │       ├── memory.py            # Couchbase Capella connection + queries
│   │       ├── stt.py               # Deepgram STT (httpx REST)
│   │       ├── tts.py               # ElevenLabs TTS
│   │       └── agora_token.py       # Agora RTC token generator
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.tsx                  # Main voice agent UI (Aria)
    │   ├── Dashboard.tsx            # Sales dashboard (stats, tables, export)
    │   ├── app.css                  # Voice agent styles
    │   ├── dashboard.css            # Dashboard styles
    │   ├── hooks/
    │   │   └── useVoiceAgent.ts     # Push-to-talk state machine
    │   └── lib/
    │       └── api.ts               # Typed API client
    ├── index.html
    ├── package.json
    └── vite.config.ts
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/session` | Create session, return Agora token |
| `POST` | `/api/transcribe` | Audio blob → transcript text |
| `POST` | `/api/respond/text` | Text → AI reply (JSON) + lead/transaction capture |
| `POST` | `/api/respond/audio` | Text → TTS audio (mp3) |
| `POST` | `/api/respond` | Combined: text → AI → TTS audio |
| `POST` | `/api/upload-document` | Upload PDF/TXT to OpenAI Vector Store |
| `DELETE` | `/api/knowledge-base` | Reset all uploaded knowledge |
| `GET` | `/api/dashboard` | Sales summary stats |
| `GET` | `/api/leads` | All captured leads |
| `GET` | `/api/leads/export` | Download leads as CSV |
| `GET` | `/api/transactions` | All sales transactions |
| `GET` | `/api/transactions/export` | Download orders as CSV |
| `GET` | `/api/conversations` | Full conversation transcripts |
| `GET` | `/api/conversations/export` | Download transcripts as CSV |
| `PATCH` | `/api/leads/{id}/status` | Update lead status |
| `PATCH` | `/api/transactions/{id}/status` | Update transaction status |
| `WS` | `/ws/voice/{session_id}` | Real-time voice pipeline |

---

## Sales Conversation Flow

Aria follows an 8-step structured sales flow:

```
1. GREET      — "Hi, I'm Aria! How can I help you today?"
2. DISCOVER   — Understand what the customer is looking for
3. RECOMMEND  — Suggest products from the knowledge base
4. OBJECTIONS — Handle concerns using catalog facts
5. CLOSE      — Guide customer toward placing an order
6. COLLECT    — Gather: name, contact, product, quantity
7. CONFIRM    — "Just to confirm: [name], [qty] of [product] at [price]..."
8. FINALIZE   — Output voice reply + structured ORDER JSON → saved to Couchbase
```

---

## Data Capture & Handoff

When a customer confirms an order, Aria outputs a structured JSON block alongside the voice reply:

```json
{
  "name": "Angelo Pera",
  "contact": "09121234567",
  "product": "Antec Atom 550 watts PSU",
  "description": "A reliable power supply unit with 550 watts capacity",
  "quantity": "5",
  "unit": "pcs",
  "unit_price": "1750.00",
  "total_price": "8750.00",
  "currency": "PHP"
}
```

This is parsed server-side and stored directly in Couchbase — no regex guessing.

**Transaction lifecycle:**
```
confirmed → contacted → fulfilled → cancelled
```

Sales team can update status in the dashboard and export the full order list as CSV for fulfillment.

---

## Couchbase Capella — Document Structure

### Transaction document
```json
{
  "type": "transaction",
  "session_id": "uuid",
  "name": "customer name",
  "contact": "phone number",
  "product": "product name",
  "description": "product description",
  "quantity": "10",
  "unit": "cans",
  "unit_price": "42.00",
  "total_price": "420.00",
  "currency": "PHP",
  "status": "confirmed",
  "created_at": "2026-05-27 07:35:54"
}
```

### Lead document
```json
{
  "type": "lead",
  "session_id": "uuid",
  "user_message": "I'm interested in your products",
  "ai_reply": "Great! What are you looking for today?",
  "status": "new",
  "created_at": "2026-05-27 07:12:00"
}
```

### Conversation document
```json
{
  "type": "conversation",
  "session_id": "uuid",
  "user_message": "How much is the sardines?",
  "ai_reply": "Our sardines in tomato sauce is PHP 42 per can.",
  "created_at": "2026-05-27 07:10:00"
}
```

---

## Setup & Installation

### Prerequisites

- Python 3.12+
- Node.js 18+
- Couchbase Capella account (free tier available)
- API keys: Agora, Deepgram, OpenAI, ElevenLabs

### 1. Couchbase Capella Setup

1. Create a free cluster at https://cloud.couchbase.com
2. Create bucket: `voice_agent`
3. Create scope: `agent`
4. Create collection: `conversations`
5. Whitelist your IP: **Settings → Allowed IP Addresses → Add Current IP**

### 2. Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Fill in all API keys

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health check: http://localhost:8000/health

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:5173

### 4. Environment Variables

```env
# Agora
AGORA_APP_ID=your_agora_app_id
AGORA_APP_CERTIFICATE=your_certificate  # optional for dev

# Anthropic (optional — not used in RAG mode)
ANTHROPIC_API_KEY=your_key

# OpenAI (required — RAG + TTS embeddings)
OPENAI_API_KEY=your_openai_key

# Deepgram
DEEPGRAM_API_KEY=your_deepgram_key

# ElevenLabs
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM  # Rachel (default)

# Couchbase Capella
COUCHBASE_CONNECTION_STRING=couchbases://your-cluster.cloud.couchbase.com
COUCHBASE_USERNAME=your_username
COUCHBASE_PASSWORD=your_password
COUCHBASE_BUCKET=voice_agent
COUCHBASE_SCOPE=agent
COUCHBASE_COLLECTION=conversations
```

---

## How to Use

### Step 1 — Upload your product catalog
Click **"Upload catalog"** in the header → select a PDF or TXT file with your product list, prices, and descriptions. OpenAI will automatically index it.

### Step 2 — Start a conversation
Click the microphone button → speak → click again to send. Aria will respond by voice and text.

### Step 3 — Complete a sale
Tell Aria what you want, provide your name and contact number, confirm the order. Aria will finalize and save the transaction.

### Step 4 — View the dashboard
Click **"Dashboard"** → see Overview stats, Transactions, Leads, and Conversations. Export any table as CSV.

### Step 5 — Reset knowledge base
Click **"Reset KB"** to clear all uploaded documents and start fresh with a new catalog.

---

## Sales Dashboard

| Tab | Contents |
|---|---|
| Overview | Total conversations, leads, orders, conversion rate, recent transactions |
| Transactions | Full order table with product, description, qty, unit price, total, status |
| Leads | All captured buying intents with status workflow |
| Conversations | Full transcript history per session |

All tabs support **CSV export** for sales team handoff.

---

## Built With

- [Agora RTC](https://www.agora.io) — Real-time audio transport
- [Deepgram](https://deepgram.com) — Speech-to-text (nova-2)
- [OpenAI](https://openai.com) — GPT-4o-mini + Assistants API + Vector Store
- [ElevenLabs](https://elevenlabs.io) — Text-to-speech (turbo-v2)
- [Couchbase Capella](https://www.couchbase.com/products/capella/) — NoSQL cloud database
- [FastAPI](https://fastapi.tiangolo.com) — Python backend
- [React](https://react.dev) + [Vite](https://vitejs.dev) — Frontend

---

## License

MIT
