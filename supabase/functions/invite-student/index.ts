const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')!;
    const authorization = request.headers.get('Authorization');

    if (!authorization) return Response.json({ error: 'Missing authorization' }, { status: 401, headers: corsHeaders });
    if (!serviceRoleKey) return Response.json({ error: 'The function service role key is not configured' }, { status: 500, headers: corsHeaders });

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: authorization },
    });
    const user = userResponse.ok ? await userResponse.json() as { id?: string } : null;
    if (!user?.id) return Response.json({ error: 'Invalid session' }, { status: 401, headers: corsHeaders });

    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, {
        headers: { apikey: anonKey, Authorization: authorization },
    });
    const [coachProfile] = profileResponse.ok ? await profileResponse.json() as { role?: string }[] : [];
    if (coachProfile?.role !== 'coach') return Response.json({ error: 'Only coaches can invite students' }, { status: 403, headers: corsHeaders });

    const { fullName, email, profile: profileInput } = await request.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedName = typeof fullName === 'string' ? fullName.trim() : '';
    if (!normalizedName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return Response.json({ error: 'A student name and email address are required' }, { status: 400, headers: corsHeaders });
    }

    const optionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
    const optionalNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    const optionalChoice = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value) ? value : null;
    const studentProfile = profileInput && typeof profileInput === 'object' ? profileInput as Record<string, unknown> : {};
    const studentResponse = await fetch(`${supabaseUrl}/rest/v1/students?select=id,full_name,email,invitation_status,created_at,date_of_birth,age_range,gender,level,dominant_hand,dominant_eye,racket_brand,racket_model,racket_string,racket_head_size_sq_in,racket_weight_g,racket_string_tension_lbs,shoes_used,goals,restrictions,last_lesson_at,student_archived_at,remaining_credits`, {
        method: 'POST',
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        },
        body: JSON.stringify({
            coach_id: user.id,
            full_name: normalizedName,
            email: normalizedEmail,
            date_of_birth: optionalText(studentProfile.date_of_birth),
            gender: optionalChoice(studentProfile.gender, ['female', 'male', 'nonbinary', 'prefer_not_to_say']),
            level: optionalText(studentProfile.level),
            dominant_hand: optionalChoice(studentProfile.dominant_hand, ['left', 'right']),
            dominant_eye: optionalChoice(studentProfile.dominant_eye, ['left', 'right']),
            racket_brand: optionalText(studentProfile.racket_brand),
            racket_model: optionalText(studentProfile.racket_model),
            racket_string: optionalText(studentProfile.racket_string),
            racket_head_size_sq_in: optionalNumber(studentProfile.racket_head_size_sq_in),
            racket_weight_g: optionalNumber(studentProfile.racket_weight_g),
            racket_string_tension_lbs: optionalNumber(studentProfile.racket_string_tension_lbs),
            shoes_used: optionalText(studentProfile.shoes_used),
            goals: optionalText(studentProfile.goals),
            restrictions: optionalText(studentProfile.restrictions),
            last_lesson_at: optionalText(studentProfile.last_lesson_at),
        }),
    });
    if (!studentResponse.ok) {
        const studentError = await studentResponse.json().catch(() => null) as { code?: string; message?: string } | null;
        const message = studentError?.code === '23505'
            ? 'A student account already uses this email address. Use a different email address.'
            : studentError?.message ?? 'Unable to create the student';
        return Response.json({ error: message }, { status: 400, headers: corsHeaders });
    }
    const [student] = await studentResponse.json();

    return Response.json({ student }, { headers: corsHeaders });
});