/**
 * useVoiceAgent — push-to-talk with two-step pipeline:
 * Step 1: Get full AI text reply → show in UI immediately
 * Step 2: Convert text to audio → play
 *
 * This ensures the displayed text always matches exactly what Aria says.
 */
const BASE = `${import.meta.env.VITE_API_URL || ''}/api`
import { useCallback, useEffect, useRef, useState } from 'react'
import { createSession, transcribeAudio, getTextResponse, textToAudio } from '../lib/api'

export type AgentState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking'

export interface Turn {
  role: 'user' | 'assistant'
  text: string
  timestamp: Date
}

export interface UseVoiceAgentReturn {
  state: AgentState
  turns: Turn[]
  error: string | null
  startListening: () => void
  stopListening: () => void
  resetSession: () => void
}

export function useVoiceAgent(): UseVoiceAgentReturn {
  const [state, setState] = useState<AgentState>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [error, setError] = useState<string | null>(null)

  const sessionRef = useRef<string | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // ── init session ───────────────────────────────────────────────────
  const initSession = useCallback(async () => {
    setState('connecting')
    try {
      const sess = await createSession()
      sessionRef.current = sess.session_id
      setState('idle')
    } catch (e: any) {
      setError('Failed to create session. Is the backend running?')
      setState('idle')
    }
  }, [])

  useEffect(() => { initSession() }, [initSession])

  const appendTurn = (role: 'user' | 'assistant', text: string) => {
    setTurns(prev => [...prev, { role, text, timestamp: new Date() }])
  }

  // ── push-to-talk ───────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (!sessionRef.current) { await initSession(); return }
    setError(null)
    chunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType })

        if (blob.size < 1000) {
          setState('idle')
          setError('No audio detected. Please try again.')
          return
        }

        setState('thinking')
        try {
          // Step 1: Transcribe audio → user text
          const transcript = await transcribeAudio(blob)
          if (!transcript.trim()) {
            setState('idle')
            setError('Could not understand audio. Please try again.')
            return
          }
          appendTurn('user', transcript)

          // Step 2: Get full AI text reply — show in UI immediately
          const { reply: replyText } = await getTextResponse(sessionRef.current!, transcript)
          if (!replyText) throw new Error('Empty response from AI')
          appendTurn('assistant', replyText)

          // Step 3: Convert reply text to audio and play
          setState('speaking')
          const audioUrl = await textToAudio(sessionRef.current!, replyText)

          const audio = new Audio(audioUrl)
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl)
            setState('idle')
          }
          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl)
            setState('idle')
          }
          await audio.play()

        } catch (e: any) {
          setError(e.message ?? 'Something went wrong.')
          setState('idle')
        }
      }

      recorder.start()
      setState('listening')
    } catch (e: any) {
      if (e.name === 'NotAllowedError') {
        setError('Microphone permission denied. Please allow microphone access.')
      } else {
        setError(e.message ?? 'Could not access microphone.')
      }
      setState('idle')
    }
  }, [initSession])

  // ── stop ───────────────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    if (mediaRef.current?.state === 'recording') {
      mediaRef.current.stop()
      mediaRef.current = null
    }
  }, [])

  // ── reset ──────────────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    if (mediaRef.current?.state === 'recording') mediaRef.current.stop()
    mediaRef.current = null
    sessionRef.current = null
    setTurns([])
    setError(null)
    setState('idle')
    initSession()
  }, [initSession])

  return { state, turns, error, startListening, stopListening, resetSession }
}
