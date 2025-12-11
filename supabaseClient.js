import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Validate required environment variables
const requiredEnvVars = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
}
console.log(requiredEnvVars,"*********************************************8888888888888888888")
// Check if all required env vars are present
for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

console.log('✅ Supabase environment variables loaded')

// Client for user operations (uses anon key with RLS)
export const supabaseUser = createClient(
  requiredEnvVars.SUPABASE_URL,
  requiredEnvVars.SUPABASE_ANON_KEY
)

// Admin client for server-side operations (bypasses RLS)
export const supabaseAdmin = createClient(
  requiredEnvVars.SUPABASE_URL,
  requiredEnvVars.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

// Test function using admin client
const testAdminAccess = async () => {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers()

    if (error) {
      console.error("❌ Error listing users:", error.message)
      return false
    }

    console.log("✅ Successfully connected to Supabase")
    console.log(`📊 Total users: ${data.users?.length || 0}`)
    return true
  } catch (err) {
    console.error("❌ Connection failed:", err.message)
    return false
  }
}

// Only run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testAdminAccess()
}

// Default export for backwards compatibility
export default supabaseUser