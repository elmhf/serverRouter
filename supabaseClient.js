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

// Check if all required env vars are present
for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}
console.log(requiredEnvVars)
// Client for user operations (uses anon key with RLS)
export const supabaseUser = createClient(
  "https://intukonwqiiyokuagplg.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImludHVrb253cWlpeW9rdWFncGxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5MzUxMTAsImV4cCI6MjA2ODUxMTExMH0.IOlnJ_U3S8nnGDiZ7_4vAYy2Xz2bzXrVoq3a03VGgQU"
)

// Admin client for server-side operations (bypasses RLS)
export const supabaseAdmin = createClient(
  "https://intukonwqiiyokuagplg.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImludHVrb253cWlpeW9rdWFncGxnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjkzNTExMCwiZXhwIjoyMDY4NTExMTEwfQ.YdnqRdR4p34tci74mQhBR7Xtplh3cdUdnaDDRodutIY",
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