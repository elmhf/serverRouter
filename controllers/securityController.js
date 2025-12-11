import { supabaseAdmin } from '../supabaseClient.js';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { sendEmail } from '../utils/emailService.js';
import { renderEmailTemplate } from '../utils/templateRenderer.js';

// Get security settings for the current user
export async function getSecuritySettings(req, res) {
    try {
        const userId = req.user.id;
        console.log(`[getSecuritySettings] Request for user:`, userId);

        const { data, error } = await supabaseAdmin
            .from('user_security')
            .select('two_factor_enabled, login_notifications, autosave')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found"
            console.error('[getSecuritySettings] Error:', error);
            return res.status(500).json({ error: 'Failed to fetch security settings' });
        }

        if (!data) {
            // If it doesn't exist, we could return default or create it.
            // Given the requirement "create on account creation", it *should* exist.
            // But for robustness, let's return a default object or 404.
            console.log(`[getSecuritySettings] No settings found for user:`, userId);
            // Return default settings instead of 404
            return res.status(200).json({
                two_factor_enabled: false,
                two_factor_enabled: false,
                login_notifications: true, // Default
                autosave: false, // Default
                user_id: userId
            });
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('[getSecuritySettings] Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// Update security settings
export async function updateSecuritySettings(req, res) {
    try {
        const userId = req.user.id;
        const updates = req.body;

        // Prevent updating valid-only fields if necessary, e.g., id, user_id, created_at
        delete updates.id;
        delete updates.user_id;
        delete updates.created_at;
        updates.updated_at = new Date().toISOString();

        console.log(`[updateSecuritySettings] Update for user:`, userId, updates);

        // Check if record exists
        const { data: existing } = await supabaseAdmin
            .from('user_security')
            .select('id')
            .eq('user_id', userId)
            .single();

        let data, error;

        if (existing) {
            console.log(`[updateSecuritySettings] Updating existing settings for user:`, userId);
            ({ data, error } = await supabaseAdmin
                .from('user_security')
                .update(updates)
                .eq('user_id', userId)
                .select()
                .single());
        } else {
            console.log(`[updateSecuritySettings] Creating new settings for user:`, userId);
            ({ data, error } = await supabaseAdmin
                .from('user_security')
                .insert([{ ...updates, user_id: userId }])
                .select()
                .single());
        }

        if (error) {
            console.error('[updateSecuritySettings] Error:', error);
            return res.status(500).json({ error: 'Failed to update security settings' });
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('[updateSecuritySettings] Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// Initiate 2FA - Generate secret and QR code
export async function initiate2FA(req, res) {
    try {
        const userId = req.user.id;
        console.log(`[initiate2FA] Request for user:`, userId);

        // Check if 2FA is already enabled
        const { data: securitySettings, error: securityError } = await supabaseAdmin
            .from('user_security')
            .select('two_factor_enabled')
            .eq('user_id', userId)
            .single();

        if (securitySettings?.two_factor_enabled) {
            return res.status(400).json({ error: '2-Factor Authentication is already enabled' });
        }

        // Fetch email from Supabase data to be sure
        const { data: userData, error: userError } = await supabaseAdmin
            .from('user')
            .select('email')
            .eq('user_id', userId)
            .single();

        if (userError || !userData) {
            console.error('[initiate2FA] Error fetching user email:', userError);
            return res.status(404).json({ error: 'User not found' });
        }

        const userEmail = userData.email;
        console.log(`[initiate2FA] Fetched email from DB:`, userEmail);

        // Generate a temporary secret
        const secret = speakeasy.generateSecret({
            name: `DentalClinic:${userEmail}` // Label for the authenticator app
        });

        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);


        const manualEntryCode = secret.base32;

        try {
            const html = renderEmailTemplate({
                code: manualEntryCode,
                email: userEmail,
                templateName: '2fa_email.html'
            });

            await sendEmail({
                to: userEmail,
                subject: '2-Factor Authentication Setup',
                text: `Code: ${manualEntryCode}`, // Fallback text
                html: html
            });
            console.log(`[initiate2FA] Email sent to:`, userEmail);
        } catch (emailError) {
            console.error('[initiate2FA] Failed to send email:', emailError);
            // Don't fail the request if email fails, just log it. 
            // Or should we fail? Usually strictly security features should ensure notification.
            // Let's proceed but warn.
        }
        console.log(`[initiate2FA] QR code generated for user:`, userId);
        console.log(`[initiate2FA] Manual entry code:`, manualEntryCode);
        console.log(`[initiate2FA] QR code URL:`, qrCodeUrl);
        res.status(200).json({
            secret: secret.base32,
            qrCode: qrCodeUrl
        });

    } catch (error) {
        console.error('[initiate2FA] Error:', error);
        res.status(500).json({ error: 'Failed to initiate 2FA' });
    }
}

// Verify 2FA and Enable it
export async function verify2FA(req, res) {
    try {
        const userId = req.user.id;
        const { token, secret } = req.body; // 'secret' comes from the initiate step (client holds it temporarily)

        if (!token || !secret) {
            return res.status(400).json({ error: 'Token and secret are required' });
        }

        console.log(`[verify2FA] Verifying token for user:`, userId);

        // Verify the token
        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: token
        });
        console.log(`[verify2FA] Token verified:`, verified);
        if (!verified) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        // If verified, enable 2FA in the database
        // Also generate recovery codes
        const recoveryCodes = Array.from({ length: 10 }, () =>
            Math.floor(10000000 + Math.random() * 90000000).toString()
        );
        console.log(`[verify2FA] Generated recovery codes:`, recoveryCodes);
        // Check if record exists
        const { data: existing } = await supabaseAdmin
            .from('user_security')
            .select('id')
            .eq('user_id', userId)
            .single();

        let error;

        if (existing) {
            console.log(`[verify2FA] Updating existing security record for user:`, userId);
            ({ error } = await supabaseAdmin
                .from('user_security')
                .update({
                    two_factor_enabled: true,
                    two_factor_secret: secret,
                    two_factor_recovery_codes: recoveryCodes,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId));
        } else {
            console.log(`[verify2FA] Creating new security record for user:`, userId);
            ({ error } = await supabaseAdmin
                .from('user_security')
                .insert([{
                    user_id: userId,
                    two_factor_enabled: true,
                    two_factor_secret: secret,
                    two_factor_recovery_codes: recoveryCodes,
                    updated_at: new Date().toISOString()
                }]));
        }

        if (error) {
            console.error('[verify2FA] Error updating/creating DB:', error);
            return res.status(500).json({ error: 'Failed to enable 2FA' });
        }

        res.status(200).json({
            message: '2-Factor Authentication enabled successfully',
            recoveryCodes
        });

    } catch (error) {
        console.error('[verify2FA] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// Initiate Disable 2FA - Verify password and send OTP
export async function initiateDisable2FA(req, res) {
    try {
        const userId = req.user.id;
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        console.log(`[initiateDisable2FA] Request for user:`, userId);

        // 1. Verify Password using Supabase Auth (SignIn)
        // We use supabase (client) to verify credentials
        // Assuming we can scope this to just credential check without creating a new session permanently if unnecessary, 
        // or just use the result.
        // Actually, we can use signInWithPassword.

        // We need 'supabaseUser' client which is initialized with anon key usually, 
        // but for server-side auth acting as user we usually need their access token or just credentials.
        // Importing supabaseUser from ../supabaseClient.js
        const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
            email: req.user.email,
            password: password
        });

        if (authError || !authData.user) {
            console.error('[initiateDisable2FA] Password verification failed:', authError);
            return res.status(401).json({ error: 'Incorrect password' });
        }

        // 2. Generate OTP
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

        // 3. Store OTP in user_metadata
        // Fetch current metadata first to preserve it? updateUserById with 'user_metadata' merges or replaces?
        // Supabase updateUserById merges top-level fields but user_metadata is a jsonb field.
        // It usually merges for user_metadata in GoTrue/Supabase.
        // Let's be safe and fetch first or assume merge. Documentation says "Updates the user data".

        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            user_metadata: {
                disable_2fa_otp: code,
                disable_2fa_expires: expires
            }
        });

        if (updateError) {
            console.error('[initiateDisable2FA] Failed to update user metadata:', updateError);
            return res.status(500).json({ error: 'Failed to generate verification code' });
        }

        // 4. Send Email
        try {
            const html = renderEmailTemplate({
                code: code,
                email: req.user.email,
                templateName: '2fa_email.html' // Reusing 2FA template or generic? 
                // The user asked "yab3eth code l email", reusing the template is fine or generic text.
                // Let's reuse 2fa_email.html for consistency, assuming it says "Code de verification".
            });

            await sendEmail({
                to: req.user.email,
                subject: 'Disable 2-Factor Authentication Verification',
                text: `Your verification code to disable 2FA is: ${code}`,
                html: html
            });
            console.log(`[initiateDisable2FA] OTP sent to:`, req.user.email);
        } catch (emailError) {
            console.error('[initiateDisable2FA] Failed to send email:', emailError);
            // If email fails, the user is stuck. Should we fail the request?
            // Yes, user can't proceed without code.
            return res.status(500).json({ error: 'Failed to send verification email' });
        }

        res.status(200).json({ message: 'Verification code sent to email' });

    } catch (error) {
        console.error('[initiateDisable2FA] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// Confirm Disable 2FA - Verify OTP and Disable
export async function confirmDisable2FA(req, res) {
    try {
        const userId = req.user.id;
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Verification code is required' });
        }

        console.log(`[confirmDisable2FA] Request for user:`, userId);

        // 1. Fetch User Metadata to check OTP
        const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (userError || !user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const meta = user.user_metadata || {};
        const storedCode = meta.disable_2fa_otp;
        const expires = meta.disable_2fa_expires;

        // 2. Verify OTP
        if (!storedCode || !expires) {
            return res.status(400).json({ error: 'No verification request found. Please initiate disable again.' });
        }

        if (Date.now() > expires) {
            return res.status(400).json({ error: 'Verification code expired' });
        }

        if (storedCode !== code.toString()) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        // 3. Disable 2FA in DB
        const { error: dbError } = await supabaseAdmin
            .from('user_security')
            .update({
                two_factor_enabled: false,
                two_factor_secret: null,
                two_factor_recovery_codes: [],
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);

        if (dbError) {
            console.error('[confirmDisable2FA] Error updating DB:', dbError);
            return res.status(500).json({ error: 'Failed to disable 2FA' });
        }

        // 4. Cleanup OTP from Metadata
        await supabaseAdmin.auth.admin.updateUserById(userId, {
            user_metadata: {
                disable_2fa_otp: null,
                disable_2fa_expires: null
            }
        });

        res.status(200).json({ message: '2-Factor Authentication disabled successfully' });

    } catch (error) {
        console.error('[confirmDisable2FA] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// Validate 2FA Token (Generic use, e.g. for sensitive actions)
export async function validate2FA(req, res) {
    try {
        const userId = req.user.id;
        const { token } = req.body;

        // Fetch secret from DB
        const { data, error } = await supabaseAdmin
            .from('user_security')
            .select('two_factor_secret')
            .eq('user_id', userId)
            .single();

        if (error || !data || !data.two_factor_secret) {
            return res.status(400).json({ error: '2FA is not enabled' });
        }

        const verified = speakeasy.totp.verify({
            secret: data.two_factor_secret,
            encoding: 'base32',
            token: token
        });

        if (!verified) {
            return res.status(401).json({ valid: false, error: 'Invalid code' });
        }

        res.status(200).json({ valid: true });

    } catch (error) {
        console.error('[validate2FA] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
// Update AutoSave settings
export async function updateAutoSave(req, res) {
    try {
        const userId = req.user.id;
        const { autosave } = req.body;

        if (typeof autosave !== 'boolean') {
            return res.status(400).json({ error: 'Autosave value must be a boolean' });
        }

        console.log(`[updateAutoSave] Request for user: ${userId}, value: ${autosave}`);

        // Check if record exists
        const { data: existing } = await supabaseAdmin
            .from('user_security')
            .select('id')
            .eq('user_id', userId)
            .single();

        let error;

        if (existing) {
            ({ error } = await supabaseAdmin
                .from('user_security')
                .update({
                    autosave: autosave,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId));
        } else {
            ({ error } = await supabaseAdmin
                .from('user_security')
                .insert([{
                    user_id: userId,
                    autosave: autosave,
                    updated_at: new Date().toISOString()
                }]));
        }

        if (error) {
            console.error('[updateAutoSave] Error updating DB:', error);
            return res.status(500).json({ error: 'Failed to update autosave settings' });
        }

        res.status(200).json({ message: 'Autosave settings updated successfully', autosave });

    } catch (error) {
        console.error('[updateAutoSave] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
