import { getSupabaseClient } from './supabase'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null

  constructor(status: number, code: string, requestId: string | null) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

export function joinApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getSession()

  if (error || !data.session?.access_token) {
    throw new Error('Authentication required')
  }

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${data.session.access_token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  return fetch(joinApiUrl(import.meta.env.VITE_API_BASE_URL ?? '', path), { ...init, headers })
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiRequest(path, init)

  if (!response.ok) {
    const requestId = response.headers.get('x-request-id')
    let code = 'request_failed'
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') code = body.error
    } catch {
      // Non-JSON error bodies still map to a generic API error.
    }
    throw new ApiError(response.status, code, requestId)
  }

  return (await response.json()) as T
}
