const BASE = '/api'

function headers(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

function handleUnauthorized() {
  // Token expirado ou invalido — limpa sessao e redireciona ao login
  localStorage.removeItem('thguard_token')
  localStorage.removeItem('thguard_user')
  window.dispatchEvent(new Event('thguard:logout'))
}

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined
  })
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Sessao expirada')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// Envio de arquivo binário (upload de firmware)
async function reqBin(method, path, blob, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: blob,
  })
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Sessao expirada')
  }
  if (res.status === 413) throw new Error('Arquivo grande demais para o servidor. Confira o client_max_body_size do Nginx (2m).')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

async function reqRaw(method, path, token) {
  const res = await fetch(BASE + path, { method, headers: headers(token) })
  if (res.status === 401) {
    handleUnauthorized()
    throw new Error('Sessao expirada')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return res
}

export const api = {
  login:         (email, password) => req('POST', '/auth/login', { email, password }),
  me:            (t) => req('GET', '/auth/me', null, t),

  getSensors:    (t, kind) => req('GET', '/sensors' + (kind ? `?kind=${kind}` : ''), null, t),
  getTags:       (t) => req('GET', '/sensors/meta/tags', null, t),
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

  // Relatórios mensais (sensores industriais): calendário do mês e .xlsx do dia
  getIndustrialDays: (month, sensor, t) =>
    req('GET', `/reports/industrial/days?month=${month}&sensor=${encodeURIComponent(sensor)}`, null, t),
  downloadIndustrialDay: (date, sensor, t) =>
    reqRaw('GET', `/reports/industrial/daily.xlsx?date=${date}&sensor=${encodeURIComponent(sensor)}`, t),
}

// Painel de administração (só admin). Exclusões levam confirm: 'EXCLUIR'.
const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
export const admin = {
  overview:         (t) => req('GET', '/admin/overview', null, t),
  sensors:          (t) => req('GET', '/admin/sensors', null, t),
  trash:            (id, purgeHistory, t) => req('POST', `/admin/sensors/${id}/trash`, { purgeHistory }, t),
  restore:          (id, t) => req('POST', `/admin/sensors/${id}/restore`, {}, t),
  purge:            (id, history, t) => req('DELETE', `/admin/sensors/${id}`, { confirm: 'EXCLUIR', history }, t),
  dataPreview:      (body, t) => req('POST', '/admin/data/preview', body, t),
  dataDelete:       (body, t) => req('POST', '/admin/data/delete', { ...body, confirm: 'EXCLUIR' }, t),
  files:            (kind, t) => req('GET', `/admin/files/${kind}`, null, t),
  fileDownload:     (kind, path, t) => reqRaw('GET', `/admin/files/${kind}/download?${qs({ path })}`, t),
  filesDelete:      (kind, paths, t) => req('DELETE', `/admin/files/${kind}`, { confirm: 'EXCLUIR', paths }, t),
  filesCleanup:     (kind, olderThanDays, t) => req('POST', `/admin/files/${kind}/cleanup`, { confirm: 'EXCLUIR', olderThanDays }, t),
  logsSystem:       (params, t) => req('GET', `/admin/logs/system?${qs(params)}`, null, t),
  logsSystemCleanup:(olderThanDays, t) => req('POST', '/admin/logs/system/cleanup', { confirm: 'EXCLUIR', olderThanDays }, t),
  logsEmail:        (params, t) => req('GET', `/admin/logs/email?${qs(params)}`, null, t),
  logsEmailCleanup: (olderThanDays, t) => req('POST', '/admin/logs/email/cleanup', { confirm: 'EXCLUIR', olderThanDays }, t),
  containers:       (t) => req('GET', '/admin/logs/containers', null, t),
  containerLogs:    (name, tail, t) => req('GET', `/admin/logs/containers/${encodeURIComponent(name)}?${qs({ tail })}`, null, t),
  settings:         (t) => req('GET', '/admin/settings', null, t),
  saveSettings:     (body, t) => req('PUT', '/admin/settings', body, t),
  // Firmware e atualização pela rede (OTA)
  firmware:         (t) => req('GET', '/admin/firmware', null, t),
  firmwareUpload:   (file, notes, t) => reqBin('POST', `/admin/firmware?${qs({ notes })}`, file, t),
  firmwareDelete:   (id, t) => req('DELETE', `/admin/firmware/${id}`, { confirm: 'EXCLUIR' }, t),
  firmwareDeploy:   (id, sensors, t) => req('POST', `/admin/firmware/${id}/deploy`, { sensors }, t),
  otaCancel:        (batch, t) => req('POST', `/admin/ota/batches/${encodeURIComponent(batch)}/cancel`, {}, t),
}
