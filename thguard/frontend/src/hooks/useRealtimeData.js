import { useEffect, useRef, useState } from 'react'

export function useRealtimeData(onMessage) {
  const ws = useRef(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const url = `${proto}://${window.location.host}/ws`
      ws.current = new WebSocket(url)

      ws.current.onopen = () => setConnected(true)
      ws.current.onclose = () => {
        setConnected(false)
        setTimeout(connect, 3000) // reconecta automático
      }
      ws.current.onerror = () => ws.current.close()
      ws.current.onmessage = (e) => {
        try { onMessage(JSON.parse(e.data)) } catch {}
      }
    }
    connect()
    return () => ws.current?.close()
  }, [])

  return { connected }
}
