import axios from './axios'
import fetchRequest from './fetch'

// Our backend API (proxied via vite dev server, or same-origin in prod)
export const SERVER_URL = '/api/v1'

// Session token — passed from parent iframe via URL param, stored in localStorage
export function getSessionToken(): string | null {
  const url = new URLSearchParams(location.search)
  const fromUrl = url.get('token')
  if (fromUrl) {
    localStorage.setItem('ppt_session_token', fromUrl)
    return fromUrl
  }
  return localStorage.getItem('ppt_session_token')
}

function authHeaders() {
  return { 'x-session-token': getSessionToken() || '' }
}

export default {
  getMockData(filename: string): Promise<any> {
    return axios.get(`./mocks/${filename}.json`)
  },

  searchImage(body: any): Promise<any> {
    return axios.post(`${SERVER_URL}/tools/img_search`, body, { headers: authHeaders() })
  },

  AIPPT_Outline({
    content,
    language,
    model,
  }: { content: string; language: string; model: string }): Promise<any> {
    return fetchRequest(`${SERVER_URL}/tools/aippt_outline`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
      },
      body: JSON.stringify({
        content,
        language,
        model,
        stream: true,
      }),
    })
  },

  AIPPT({
    content,
    language,
    style,
    model,
  }: { content: string; language: string; style: string; model: string }): Promise<any> {
    return fetchRequest(`${SERVER_URL}/tools/aippt`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
      },
      body: JSON.stringify({
        content,
        language,
        model,
        style,
        stream: true,
      }),
    })
  },

  AI_Writing({
    content,
    command,
  }: { content: string; command: string }): Promise<any> {
    return fetchRequest(`${SERVER_URL}/tools/ai_writing`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
      },
      body: JSON.stringify({
        content,
        command,
        stream: true,
      }),
    })
  },

  Agent({
    message,
    deckSummary,
  }: { message: string; deckSummary?: unknown }): Promise<any> {
    return fetchRequest(`${SERVER_URL}/tools/agent`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
      },
      body: JSON.stringify({
        message,
        deckSummary,
        stream: true,
      }),
    })
  },
}
