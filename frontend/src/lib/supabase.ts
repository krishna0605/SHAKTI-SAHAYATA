import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || ''
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || ''

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export const getSupabaseSession = async () => {
  if (!supabase) return null
  const authClient = (supabase as any).auth
  const { data } = await authClient.getSession()
  return data.session ?? null
}

export const getSupabaseAccessToken = async () => {
  const session = await getSupabaseSession()
  return session?.access_token ?? null
}

export const refreshSupabaseSession = async () => {
  if (!supabase) return null
  const authClient = (supabase as any).auth
  const { data, error } = await authClient.refreshSession()
  if (error) throw error
  return data.session ?? null
}

export const signInWithSupabasePassword = async (email: string, password: string) => {
  if (!supabase) {
    throw new Error('Supabase auth is not configured')
  }

  const authClient = (supabase as any).auth
  const { data, error } = await authClient.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export const signUpWithSupabasePassword = async (email: string, password: string) => {
  if (!supabase) {
    throw new Error('Supabase auth is not configured')
  }

  const authClient = (supabase as any).auth
  const { data, error } = await authClient.signUp({ email, password })
  if (error) throw error
  return data
}

export const signOutSupabase = async () => {
  if (!supabase) return
  const authClient = (supabase as any).auth
  await authClient.signOut()
}

export const uploadToSupabaseSignedUrl = async ({
  bucket,
  objectPath,
  token,
  signedUrl,
  file,
}: {
  bucket: string
  objectPath: string
  token?: string | null
  signedUrl?: string | null
  file: File
}) => {
  if (!supabase) {
    throw new Error('Supabase storage is not configured')
  }

  const storage = supabase.storage.from(bucket)
  const untypedStorage = storage as any
  if (token && typeof untypedStorage.uploadToSignedUrl === 'function') {
    const { data, error } = await untypedStorage.uploadToSignedUrl(objectPath, token, file, {
      cacheControl: '3600',
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
    if (error) throw error
    return data
  }

  if (!signedUrl) {
    throw new Error('Signed upload URL is missing')
  }

  const response = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-upsert': 'false',
    },
    body: file,
  })

  if (!response.ok) {
    throw new Error('Failed to upload file to Supabase storage')
  }

  return { path: objectPath, fullPath: objectPath }
}
