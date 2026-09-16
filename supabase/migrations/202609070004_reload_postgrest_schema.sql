-- Make recently created RPC functions available to Supabase's REST API immediately.
notify pgrst, 'reload schema';