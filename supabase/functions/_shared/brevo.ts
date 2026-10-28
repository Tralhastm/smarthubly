/**
 * Reads the Brevo credential from the server-only table, falling back to the
 * environment variable during rollout or local development.
 */
export async function getBrevoApiKey(supabase: any): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_provider_credentials')
    .select('api_key')
    .eq('provider', 'brevo')
    .maybeSingle()

  if (error) {
    console.error('Failed to load Brevo credential from server storage', error)
  }

  const storedKey = data?.api_key?.trim()
  if (storedKey) return storedKey

  return Deno.env.get('BREVO_API_KEY')?.trim() || null
}

export function getBrevoSenderEmail(): string {
  return Deno.env.get('BREVO_SENDER_EMAIL')?.trim() || 'smarthubly@gmail.com'
}
