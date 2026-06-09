const BASE = '/api'

function headers(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

async function reqRaw(method, path, token) {
  const res = await fetch(BASE + path, { method, headers: headers(token) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

export const api = {
  login:         (email, password) => req('POST', '/auth/login', { email, password }),
  me:            (t) => req('GET', '/auth/me', null, t),

  getSensors:    (t) => req('GET', '/sensors', null, t),
  getSensor:     (id, t) => req('GET', `/sensors/${id}`, null, t),
  updateSensor:  (id, body, t) => req('PATCH', `/sensors/${id}`, body, t),
  deleteSensor:  (id, t) => req('DELETE', `/sensors/${id}`, null, t),
  getHistory:    (id, range, t) => req('GET', `/sensors/${id}/history?range=${range}`, null, t),
  getStats:      (id, range, t) => req('GET', `/sensors/${id}/stats?range=${range}`, null, t),

  getUsers:      (t) => req('GET', '/users', null, t),
  createUser:    (body, t) => req('POST', '/users', body, t),
  updateUser:    (id, body, t) => req('PATCH', `/users/${id}`, body, t),
  deleteUser:    (id, t) => req('DELETE', `/users/${id}`, null, t),

  sendCommand:   (sensorId, body, t) => req('POST', `/commands/${sensorId}`, body, t),

  // Alertas
  getSmtp:       (t) => req('GET', '/alerts/smtp', null, t),
  saveSmtp:      (body, t) => req('POST', '/alerts/smtp', body, t),
  getAlerts:     (sensorId, t) => req('GET', `/alerts/${sensorId}`, null, t),
  saveAlerts:    (sensorId, body, t) => req('PUT', `/alerts/${sensorId}`, body, t),
  testAlert:     (sensorId, type, t) => req('POST', `/alerts/${sensorId}/test/${type}`, {}, t),
  getAlertHistory: (sensorId, t) => req('GET', `/alerts/${sensorId}/history`, null, t),
  getAlertState: (sensorId, t) => req('GET', `/alerts/${sensorId}/state`, null, t),

  // Relatórios
  getReport:     (sensorId, period, t) => req('GET', `/alerts/${sensorId}/report/${period}`, null, t),
  downloadReport: (sensorId, period, t) => reqRaw('GET', `/alerts/${sensorId}/report/${period}?format=csv`, t),
}
