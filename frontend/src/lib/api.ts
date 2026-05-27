const BASE = `${import.meta.env.VITE_API_URL || ''}/api`

export interface Session {
  session_id: string
  channel: string
  token: string
  app_id: string
}

export async function createSession(): Promise<Session> {
  const res = await fetch(`${BASE}/session`, { method: 'POST' })
  if (!res.ok) throw new Error(`Session creation failed: ${res.status}`)
  return res.json()
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const fd = new FormData()
  fd.append('audio', blob, 'recording.webm')
  const res = await fetch(`${BASE}/transcribe`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`STT failed: ${res.status}`)
  const data = await res.json()
  return data.transcript as string
}

/**
 * Step 1 — Get AI text reply (RAG, no audio).
 * Returns the full reply text from Aria.
 */
export async function getTextResponse(
  sessionId: string,
  text: string,
): Promise<{ reply: string; order: any | null }> {
  const fd = new FormData()
  fd.append('session_id', sessionId)
  fd.append('text', text)

  const res = await fetch(`${BASE}/respond/text`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`AI failed: ${res.status}`)
  const data = await res.json()
  return { reply: data.reply as string, order: data.order ?? null }
}

/**
 * Step 2 — Convert text to audio and return object URL.
 */
export async function textToAudio(
  sessionId: string,
  text: string,
): Promise<string> {
  const fd = new FormData()
  fd.append('session_id', sessionId)
  fd.append('text', text)

  const res = await fetch(`${BASE}/respond/audio`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`TTS failed: ${res.status}`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/**
 * Combined: text → AI reply text + audio URL in one call.
 * Kept for backward compatibility.
 */
export async function getAudioResponse(
  sessionId: string,
  text: string,
): Promise<{ audioUrl: string; replyText: string }> {
  const fd = new FormData()
  fd.append('session_id', sessionId)
  fd.append('text', text)

  const res = await fetch(`${BASE}/respond`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`LLM/TTS failed: ${res.status}`)

  // Full reply text from JSON header — no truncation
  const replyText = decodeURIComponent(res.headers.get('X-Transcript-Full') ?? '')
    || (res.headers.get('X-Transcript') ?? '')
  const blob = await res.blob()
  return { audioUrl: URL.createObjectURL(blob), replyText }
}
