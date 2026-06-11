import { useEffect, useRef, useState, useCallback } from 'react'

export function useRealtimeData(onMessage) {
  const ws        = useRef(null)
  const onMsgRef  = useRef(onMessage)
  const [connected, setConnected] = useState(false)

  // Mantém a ref atualizada sem recriar o WebSocket (corrige stale closure)
  useEffect(() => { onMsgRef.current = onMessage }, [onMessage])

  useEffect(() => {
    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const token = localStorage.getItem('thguard_token') || ''
      const url   = `${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`

      ws.current = new WebSocket(url)

      ws.current.onopen    = () => setConnected(true)
      ws.current.onclose   = () => {
        setConnected(false)
        setTimeout(connect, 3000)
      }
      ws.current.onerror   = () => ws.current.close()
      ws.current.onmessage = (e) => {
        try { onMsgRef.current(JSON.parse(e.data)) } catch {}
      }
    }

    connect()
    return () => ws.current?.close()
  }, [])

  return { connected }
}
