import { getSupabaseClient } from './supabase'

export function joinApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getSession()

  if (error || !data.session?.access_token) {
    throw new Error('Authentication required')
  }

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${data.session.access_token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(joinApiUrl(import.meta.env.VITE_API_BASE_URL ?? '', path), {
    ...init,
    headers,
  })

  if (!response.ok) {
    const requestId = response.headers.get('x-request-id')
    throw new Error(`Request failed (${response.status})${requestId ? ` [${requestId}]` : ''}`)
  }

  return (await response.json()) as T
}
