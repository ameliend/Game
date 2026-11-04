import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(
  url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_'),
);
export const supabase = configured
  ? createClient(url, key, {
      auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    })
  : null;
export function client() {
  if (!supabase) throw new Error('Configurez Supabase pour jouer.');
  return supabase;
}
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
