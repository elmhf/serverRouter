import { supabaseAdmin, supabaseUser } from '../supabaseClient.js';
import generateCode from '../utils/generateCode.js';
import { renderEmailTemplate } from '../utils/templateRenderer.js';
import { sendEmail } from '../utils/emailService.js';
import validateEmailUsage from '../utils/emailverification.js';
import crypto from 'crypto';
import speakeasy from 'speakeasy';

// Encryption setup
const ENCRYPTION_KEY = crypto.createHash('sha256').update(String(process.env.JWT_SECRET || 'secret')).digest('base64').substr(0, 32);
const IV_LENGTH = 16;

function encryptTempToken(data) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(JSON.stringify(data));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptTempToken(text) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return JSON.parse(decrypted.toString());
}

// إعدادات الـ cookies
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // https في الإنتاج فقط
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
  path: '/'
};

// مدة انتهاء الـ cookies
const ACCESS_TOKEN_EXPIRES = 60 * 60 * 1000; // 60 دقيقة
const REFRESH_TOKEN_EXPIRES = 7 * 24 * 60 * 60 * 1000; // 7 أيام

// In-memory store for OTP codes (for demo)
const emailOtpCodes = new Map();
// Send OTP after verifying password
export async function sendPasswordOtp(req, res) {
  try {
    const { email, password } = req.body;
    // Vérifier le mot de passe
    const { data: userData, error: userError } = await supabaseAdmin.from('user').select('user_id, password').eq('email', email).single();
    if (userError || !userData) return res.status(404).json({ error: 'User not found' });
    if (userData.password !== password) return res.status(401).json({ error: 'Invalid password' });

    // Générer et envoyer OTP
    const code = Math.floor(100000 + Math.random() * 900000);
    const expires = Date.now() + 5 * 60 * 1000;
    // Remplace sendEmail par ton service d'envoi réel
    await sendEmail({ to: email, subject: 'Your OTP Code', text: `Your verification code is: ${code}` });

    // Stocker OTP dans user_metadata
    const { data: { user }, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userData.user_id);
    if (getUserError || !user) return res.status(404).json({ error: 'User not found' });
    const meta = user.user_metadata || {};
    meta.password_otp_code = code.toString();
    meta.password_otp_expires = expires;
    await supabaseAdmin.auth.admin.updateUserById(userData.user_id, { user_metadata: meta });

    res.json({ message: 'OTP code sent to email' });
  } catch (error) {
    console.error('sendPasswordOtp error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}

// Verify OTP and update password
export async function verifyPasswordOtpAndUpdate(req, res) {
  try {
    const { email, code, newPassword } = req.body;
    // Récupérer user_id
    const { data: userData, error: userError } = await supabaseAdmin.from('user').select('user_id').eq('email', email).single();
    if (userError || !userData) return res.status(404).json({ error: 'User not found' });

    // Vérifier OTP
    const { data: { user }, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userData.user_id);
    if (getUserError || !user) return res.status(404).json({ error: 'User not found' });
    const meta = user.user_metadata || {};
    if (!meta.password_otp_code || !meta.password_otp_expires) return res.status(400).json({ error: 'No OTP found' });
    if (Date.now() > meta.password_otp_expires) return res.status(400).json({ error: 'OTP expired' });
    if (meta.password_otp_code !== code.toString()) return res.status(400).json({ error: 'Invalid OTP code' });

    // Mettre à jour le mot de passe dans Auth et dans la table user
    await supabaseAdmin.auth.admin.updateUserById(userData.user_id, { password: newPassword, user_metadata: { ...meta, password_otp_code: null, password_otp_expires: null } });
    await supabaseAdmin.from('user').update({ password: newPassword }).eq('user_id', userData.user_id);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('verifyPasswordOtpAndUpdate error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
// ===== إرسال كود التحقق =====
export async function sendVerificationCode(req, res) {
  const { email, password, firstName, lastName, phone } = req.body;
  const now = Date.now();
  console.log(`[sendVerificationCode] Request for:`, { email, firstName, lastName, phone });

  try {
    // فحص المستخدمين الموجودين
    const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers();
    console.log(`[sendVerificationCode] Users fetched from Supabase`);

    // البحث عن مستخدم مؤكد بنفس الإيميل
    const confirmedUser = allUsers.users.find(u =>
      u.email === email && u.email_confirmed_at
    );

    if (confirmedUser) {
      console.log(`[sendVerificationCode] Email already registered:`, email);
      return res.status(409).json({ error: 'Email already registered' });
    }

    // البحث عن مستخدم معلق (pending verification)
    const pendingUser = allUsers.users.find(u =>
      u.email === email && !u.email_confirmed_at
    );

    // فحص الـ rate limiting
    if (pendingUser?.user_metadata?.last_sent) {
      const lastSent = pendingUser.user_metadata.last_sent;
      if (now - lastSent < 60000) {
        const waitTime = Math.ceil((60000 - (now - lastSent)) / 1000);
        console.log(`[sendVerificationCode] Rate limit hit for:`, email);
        return res.status(429).json({
          error: "Please wait before requesting another code",
          waitTime
        });
      }
    }

    const code = generateCode();
    console.log(`[sendVerificationCode] Generated code for ${email}:`, code);

    if (pendingUser) {
      // تحديث المستخدم الموجود
      await supabaseAdmin.auth.admin.updateUserById(pendingUser.id, {
        user_metadata: {
          ...pendingUser.user_metadata,
          verification_code: code,
          verification_expires: now + 5 * 60 * 1000,
          last_sent: now,
          // تحديث بيانات المستخدم في حالة تغيرت
          first_name: firstName,
          last_name: lastName,
          phone: phone,
          password: password, // محفوظ مؤقتاً
          status: 'pending_verification'
        }
      });

      console.log(`[sendVerificationCode] Updated pending user:`, email);
    } else {
      // إنشاء مستخدم جديد معلق
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password, // كلمة مرور مؤقتة
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
          phone,
          verification_code: code,
          verification_expires: now + 5 * 60 * 1000,
          last_sent: now,
          password: password, // محفوظ مؤقتاً
          status: 'pending_verification'
        },
        email_confirm: false // مهم جداً! لا تأكيد فوري
      });

      if (createError) {
        console.error('[sendVerificationCode] Error creating pending user:', createError);
        return res.status(500).json({ error: 'Failed to create verification session' });
      }

      console.log(`[sendVerificationCode] Created pending user: ${email}, ID: ${newUser.user.id}`);
    }

    // إرسال البريد الإلكتروني
    const html = renderEmailTemplate({ code, firstName, lastName, email });
    const text = `Your verification code is: ${code}`;
    console.log(`[sendVerificationCode] Sending email to:`, email);

    await sendEmail({
      to: email,
      subject: 'Your Verification Code',
      text,
      html
    });

    console.log(`[sendVerificationCode] Email sent successfully to:`, email);
    res.status(200).json({
      message: 'Verification code sent successfully',
      email,
      expiresIn: 300
    });

  } catch (error) {
    console.error('[sendVerificationCode] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}


import rateLimit from 'express-rate-limit';

// Rate limiter للتحقق من الكود
const verifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 5, // 5 محاولات كحد أقصى
  message: { error: 'Too many verification attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `verify_${req.body.email}` // Rate limit حسب الإيميل
});

export async function verifyAndSignup(req, res) {
  // تطبيق rate limiting
  await new Promise((resolve, reject) => {
    verifyRateLimit(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const { email, code } = req.body;
  const now = Date.now();

  console.log(`[verifyAndSignup] Request for:`, email);

  // التحقق من صحة البيانات المدخلة
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Code must be 6 digits' });
  }

  // استخدام transaction لضمان consistency
  const { data: dbTransaction, error: transactionError } = await supabaseAdmin.rpc('begin_transaction');

  try {
    // البحث عن المستخدم المعلق بطريقة أكثر كفاءة
    const { data: pendingUsers, error: fetchError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000 // أو استخدم pagination حسب الحاجة
    });

    if (fetchError) {
      console.error('[verifyAndSignup] Error fetching users:', fetchError);
      return res.status(500).json({ error: 'Internal server error' });
    }

    const pendingUser = pendingUsers.users.find(u =>
      u.email?.toLowerCase() === email.toLowerCase() &&
      !u.email_confirmed_at
    );

    if (!pendingUser) {
      console.log(`[verifyAndSignup] No pending verification for:`, email);
      return res.status(400).json({ error: 'No pending verification found for this email' });
    }

    const metadata = pendingUser.user_metadata;

    // التحقق من وجود بيانات التحقق
    if (!metadata?.verification_code || !metadata?.verification_expires) {
      console.log(`[verifyAndSignup] Invalid verification data for:`, email);
      return res.status(400).json({ error: 'Invalid verification data' });
    }

    // التحقق من الكود والانتهاء بطريقة آمنة
    const providedCode = code.toString().trim();
    const storedCode = metadata.verification_code.toString().trim();

    // استخدام constant-time comparison لمنع timing attacks
    if (providedCode.length !== storedCode.length ||
      !timingSafeEqual(Buffer.from(providedCode), Buffer.from(storedCode)) ||
      now > metadata.verification_expires) {

      console.log(`[verifyAndSignup] Invalid or expired code for:`, email);

      // تسجيل المحاولة الفاشلة للمراقبة
      console.warn(`[SECURITY] Failed verification attempt for: ${email} from IP: ${req.ip}`);

      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    console.log(`[verifyAndSignup] Verifying user:`, email);

    // تنظيف وتحقق من البيانات قبل الحفظ
    const sanitizedPhone = sanitizePhoneNumber(metadata.phone);
    const sanitizedFirstName = sanitizeString(metadata.first_name);
    const sanitizedLastName = sanitizeString(metadata.last_name);

    // تأكيد البريل الإلكتروني وتنظيف الـ metadata
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(pendingUser.id, {
      email_confirm: true,
      user_metadata: {
        first_name: sanitizedFirstName,
        last_name: sanitizedLastName,
        phone: sanitizedPhone,
        status: 'verified',
        verified_at: new Date().toISOString()
        // البيانات المؤقتة تُحذف تلقائياً (verification_code, verification_expires, password)
      }
    });

    if (updateError) {
      console.error('[verifyAndSignup] Error updating user:', updateError);
      return res.status(500).json({ error: 'Failed to verify user' });
    }

    console.log(`[verifyAndSignup] User verified successfully:`, pendingUser.id);
    // إنشاء ملف المستخدم في الجدول المخصص (بدون كلمة المرور)
    const userProfile = {
      user_id: pendingUser.id,
      email: pendingUser.email?.toLowerCase(),
      firstName: sanitizedFirstName,
      lastName: sanitizedLastName,
      phone: sanitizedPhone,
      email_verified: true,
      created_at: new Date().toISOString(),
    };

    const { error: insertError } = await supabaseAdmin
      .from('user')
      .insert([userProfile]);

    if (insertError) {
      console.error('[verifyAndSignup] Error inserting user profile:', insertError);

      // Rollback: حذف المستخدم من auth إذا فشل إنشاء الملف الشخصي
      try {
        await supabaseAdmin.auth.admin.deleteUser(pendingUser.id);
        console.log(`[verifyAndSignup] Rolled back auth user creation for:`, email);
      } catch (rollbackError) {
        console.error('[verifyAndSignup] Failed to rollback auth user:', rollbackError);
      }

      return res.status(500).json({ error: 'Failed to create user profile' });
    }

    // إنشاء إعدادات الحماية للمستخدم
    const { error: securityError } = await supabaseAdmin
      .from('user_security')
      .insert([{ user_id: pendingUser.id }]);

    if (securityError) {
      console.error('[verifyAndSignup] Error inserting user security:', securityError);
      // يمكن إضافة rollback هنا إذا كان الأمر ضرورياً جداً
    }

    // عدم إنشاء session تلقائياً - خلي المستخدم يسجل دخول بنفسه
    console.log(`[verifyAndSignup] User created successfully:`, email);

    // إرسال response نظيف بدون معلومات حساسة
    res.status(201).json({
      message: 'Account verified successfully. You can now sign in.',
      user: {
        id: pendingUser.id,
        email: pendingUser.email,
        firstName: sanitizedFirstName,
        lastName: sanitizedLastName,
        phone: sanitizedPhone,
        emailVerified: true,
        createdAt: userProfile.created_at
      },
      nextStep: 'redirect_to_login'
    });

  } catch (error) {
    console.error('[verifyAndSignup] Unexpected error:', error);

    // تسجيل تفاصيل الخطأ للمراقبة
    console.error(`[ERROR] verifyAndSignup failed for ${email}:`, {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({ error: 'An unexpected error occurred' });
  }
}

// ===== Helper Functions =====

// دالة للمقارنة الآمنة ضد timing attacks
function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}

// تنظيف رقم الهاتف
function sanitizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  const cleaned = phone.trim().replace(/[^\d+\-\s()]/g, '');
  return cleaned === '' ? null : cleaned;
}

// تنظيف النصوص
function sanitizeString(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  return str.trim()
    .replace(/[<>]/g, '') // إزالة HTML tags الأساسية
    .substring(0, 100); // تحديد طول النص
}

// ===== Middleware للحماية الإضافية =====
export const verifySignupSecurity = [
  // CORS protection
  (req, res, next) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }

    next();
  },

  // Request size limiting
  (req, res, next) => {
    if (req.headers['content-length'] > 1024) { // 1KB max
      return res.status(413).json({ error: 'Request too large' });
    }
    next();
  },

  // Basic input sanitization
  (req, res, next) => {
    if (req.body.email) {
      req.body.email = req.body.email.toString().toLowerCase().trim();
    }
    if (req.body.code) {
      req.body.code = req.body.code.toString().trim();
    }
    next();
  }
];

// ===== إعادة إرسال كود التحقق =====
export async function resendVerificationCode(req, res) {
  const { email } = req.body;
  const now = Date.now();
  console.log(`[resendVerificationCode] Request for:`, email);

  try {
    const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers();
    console.log(`[resendVerificationCode] Users fetched from Supabase`);
    const pendingUser = allUsers.users.find(u =>
      u.email === email && !u.email_confirmed_at
    );

    if (!pendingUser) {
      console.log(`[resendVerificationCode] No pending verification for:`, email);
      return res.status(404).json({ error: 'No pending verification for this email' });
    }

    // فحص الـ rate limiting
    const metadata = pendingUser.user_metadata;
    if (metadata.last_sent && now - metadata.last_sent < 60000) {
      const waitTime = Math.ceil((60000 - (now - metadata.last_sent)) / 1000);
      console.log(`[resendVerificationCode] Rate limit hit for:`, email);
      return res.status(429).json({
        error: "Please wait before requesting another code",
        waitTime
      });
    }

    const code = generateCode();
    console.log(`[resendVerificationCode] Generated new code for:`, email, code);

    // تحديث الكود
    await supabaseAdmin.auth.admin.updateUserById(pendingUser.id, {
      user_metadata: {
        ...metadata,
        verification_code: code,
        verification_expires: now + 5 * 60 * 1000,
        last_sent: now
      }
    });

    // إرسال البريد
    const html = renderEmailTemplate({
      code,
      firstName: metadata.first_name,
      lastName: metadata.last_name,
      email
    });
    const text = `Your new verification code is: ${code}`;
    console.log(`[resendVerificationCode] Sending email to:`, email);

    await sendEmail({
      to: email,
      subject: 'Your New Verification Code',
      text,
      html
    });

    console.log(`[resendVerificationCode] Email sent successfully to:`, email);
    res.status(200).json({
      message: 'New verification code sent successfully',
      expiresIn: 300
    });

  } catch (error) {
    console.error('[resendVerificationCode] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== فحص حالة التحقق =====
export async function verificationStatus(req, res) {
  const { email } = req.body;
  const now = Date.now();
  console.log(`[verificationStatus] Request for:`, email);

  try {
    const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers();
    console.log(`[verificationStatus] Users fetched from Supabase`);
    const pendingUser = allUsers.users.find(u =>
      u.email === email && !u.email_confirmed_at
    );

    if (!pendingUser) {
      console.log(`[verificationStatus] No pending verification for:`, email);
      return res.status(404).json({ error: 'No pending verification for this email' });
    }

    const metadata = pendingUser.user_metadata;
    const expiresIn = Math.max(0, Math.ceil((metadata.verification_expires - now) / 1000));
    const waitTime = Math.max(0, Math.ceil((60000 - (now - metadata.last_sent)) / 1000));

    console.log(`[verificationStatus] Status for ${email}: expiresIn=${expiresIn}, waitTime=${waitTime}`);
    res.status(200).json({ expiresIn, waitTime });

  } catch (error) {
    console.error('[verificationStatus] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== تسجيل الدخول =====
export async function login(req, res) {
  const { email, password } = req.body;
  console.log(`[login] Request for:`, email);

  if (!email || !password) {
    console.log(`[login] Missing email or password`);
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // فحص إذا كان الإيميل معلق للتحقق
    const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers();
    console.log(`[login] Users fetched from Supabase`);
    const pendingUser = allUsers.users.find(u =>
      u.email === email && !u.email_confirmed_at
    );

    if (pendingUser) {
      const metadata = pendingUser.user_metadata;
      const now = Date.now();
      const waitTime = Math.max(0, Math.ceil((60000 - (now - metadata.last_sent)) / 1000));
      const expiresIn = Math.max(0, Math.ceil((metadata.verification_expires - now) / 1000));
      const restart_signup = expiresIn === 0;
      console.log(`[login] Email is pending verification:`, email);
      return res.status(403).json({
        error: 'Email is waiting for verification.',
        state: 'pending_verification',
        waitTime,
        expiresIn,
        restart_signup
      });
    }

    // تسجيل الدخول العادي - استخدام supabaseAdmin للمصادقة
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    console.log(`[login] signInWithPassword result:`, { error, hasSession: !!data?.session });

    if (error || !data || !data.session) {
      console.log(`[login] Invalid email or password for:`, email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is banned
    const { data: banRecord } = await supabaseAdmin
      .from('user_bans')
      .select('ban_type, ban_description, ban_end')
      .eq('user_id', data.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (banRecord) {
      console.warn(`[login] Blocked login for banned user: ${email}`);
      return res.status(403).json({
        error: 'Your account has been banned.',
        code: 'USER_BANNED',
        details: {
          type: banRecord.ban_type,
          end_date: banRecord.ban_end
        }
      });
    }

    // Check 2FA status
    const { data: security } = await supabaseAdmin
      .from('user_security')
      .select('two_factor_enabled, two_factor_secret')
      .eq('user_id', data.user.id)
      .single();

    if (security?.two_factor_enabled) {
      console.log(`[login] 2FA required for:`, email);


      // Generate random OTP for email verification
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

      // Store in user_metadata
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
        user_metadata: {
          login_otp_code: code,
          login_otp_expires: expires
        }
      });

      if (updateError) {
        console.error('[login] Failed to store OTP:', updateError);
        // Should we fail? Yes, better safe.
        return res.status(500).json({ error: 'Failed to generate verification code' });
      }

      try {
        const html = renderEmailTemplate({
          code: code,
          email: email,
          templateName: '2fa_email.html'
        });

        await sendEmail({
          to: email,
          subject: 'Login Verification Code',
          text: `Your login code is: ${code}`,
          html: html
        });
        console.log(`[login] 2FA OTP sent to email:`, email);
      } catch (emailError) {
        console.error('[login] Failed to send 2FA email:', emailError);
      }

      // Encrypt session data to return as temporary token
      const tempToken = encryptTempToken({
        session: data.session,
        user: data.user
      });

      return res.status(200).json({
        message: '2-Factor Authentication required. Code sent to email.',
        state: '2fa_required',
        userId: data.user.id,
        tempToken: tempToken
      });
    }

    // تعيين الـ cookies
    res.cookie('access_token', data.session.access_token, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_EXPIRES
    });

    res.cookie('refresh_token', data.session.refresh_token, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_EXPIRES
    });

    console.log(`[login] Login successful for:`, email);
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: data.user.id,
        email: data.user.email,
        firstName: data.user.user_metadata?.first_name,
        lastName: data.user.user_metadata?.last_name,
        phone: data.user.user_metadata?.phone,
      }
    });

  } catch (error) {
    console.error('[login] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== تسجيل الدخول 2FA =====
export async function login2FA(req, res) {
  const { tempToken, code } = req.body;
  console.log(`[login2FA] Request received`);

  if (!tempToken || !code) {
    return res.status(400).json({ error: 'Token and code are required' });
  }

  try {
    // Decrypt temp token
    let decryptedData;
    try {
      decryptedData = decryptTempToken(tempToken);
    } catch (e) {
      console.error('[login2FA] Decryption error:', e);
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const { session, user } = decryptedData;

    // Verify 2FA code
    // Verify OTP from metadata
    // Fetch latest user data to get metadata
    const { data: { user: currentUser }, error: userError } = await supabaseAdmin.auth.admin.getUserById(user.id);

    if (userError || !currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const meta = currentUser.user_metadata || {};
    const storedCode = meta.login_otp_code;
    const expires = meta.login_otp_expires;

    if (!storedCode || !expires) {
      // Fallback check: maybe they are using the app code? 
      // But the user requested "na77i login2FA" implying replacing the logic.
      // If we rigidly stick to "only email code", then:
      return res.status(400).json({ error: 'No verification code found. Please login again.' });
    }

    if (Date.now() > expires) {
      return res.status(400).json({ error: 'Verification code expired' });
    }

    if (storedCode !== code.toString()) {
      return res.status(401).json({ error: 'Invalid verification code' });
    }

    // Code is valid - clean up
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        login_otp_code: null,
        login_otp_expires: null
      }
    });

    // Set cookies
    res.cookie('access_token', session.access_token, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_EXPIRES
    });

    res.cookie('refresh_token', session.refresh_token, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_EXPIRES
    });

    console.log(`[login2FA] Login successful for:`, user.email);
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.user_metadata?.first_name,
        lastName: user.user_metadata?.last_name,
        phone: user.user_metadata?.phone,
      }
    });

  } catch (error) {
    console.error('[login2FA] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== تسجيل الخروج =====
export async function logout(req, res) {
  console.log(`[logout] Request received`);

  try {
    // مسح الـ cookies
    res.clearCookie('access_token', COOKIE_OPTIONS);
    res.clearCookie('refresh_token', COOKIE_OPTIONS);

    console.log(`[logout] Cookies cleared successfully`);
    res.status(200).json({ message: 'Logged out successfully' });

  } catch (error) {
    console.error('[logout] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== تسجيل الخروج من جميع الأجهزة =====
export async function logoutFromAllDevices(req, res) {
  console.log(`[logoutFromAllDevices] Request received`);
  const userId = req.user?.id;
  const userEmail = req.user?.email;
  const { password } = req.body;

  if (!userId || !userEmail) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Password is required to confirm this action' });
  }

  try {
    // 1. Verify password by attempting to sign in
    const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: userEmail,
      password: password
    });

    if (signInError) {
      console.warn(`[logoutFromAllDevices] Password verification failed for user ${userEmail}`);
      return res.status(401).json({ error: 'Invalid password' });
    }

    // 2. Invalidate all tokens by updating user metadata
    // We explicitly set the time slightly in the past (-1s) to avoid race conditions with the new token we are about to generate
    const logoutTime = new Date();

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        global_logout_at: logoutTime.toISOString()
      }
    });

    if (updateError) {
      console.error('[logoutFromAllDevices] Supabase update error:', updateError);
      return res.status(500).json({ error: 'Failed to sign out from all devices' });
    }

    // 3. Re-authenticate to get a NEW valid token for the current device
    // This token will have an 'iat' > global_logout_at, so it will pass the middleware check
    const { data: newSessionData, error: reLoginError } = await supabaseAdmin.auth.signInWithPassword({
      email: userEmail,
      password: password
    });

    if (reLoginError || !newSessionData.session) {
      console.error('[logoutFromAllDevices] Re-login failed:', reLoginError);
      // Fallback: if re-login fails, at least we logged everyone out.
      res.clearCookie('access_token', COOKIE_OPTIONS);
      res.clearCookie('refresh_token', COOKIE_OPTIONS);
      return res.status(200).json({ message: 'Logged out from all devices. Please login again.' });
    }

    // 4. Set new cookies for the current device
    res.cookie('access_token', newSessionData.session.access_token, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_EXPIRES
    });

    res.cookie('refresh_token', newSessionData.session.refresh_token, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_EXPIRES
    });

    console.log(`[logoutFromAllDevices] User ${userId} refreshed session after global logout`);
    res.status(200).json({
      message: 'Logged out from all other devices successfully',
      user: {
        id: newSessionData.user.id,
        email: newSessionData.user.email
      }
    });

  } catch (error) {
    console.error('[logoutFromAllDevices] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== Helper: Check if Google Integration is Enabled =====
async function checkGoogleIntegrationEnabled() {
  try {
    const { data, error } = await supabaseAdmin
      .from('config_Integrations')
      .select('is_Integration')
      .ilike('Integrations', 'Google')
      .maybeSingle();

    if (error) {
      console.error('[checkGoogleIntegrationEnabled] Error fetching config:', error);
      return false;
    }

    if (!data) {
      console.log('[checkGoogleIntegrationEnabled] No Google integration record found.');
      return false;
    }

    return data.is_Integration === true;

  } catch (err) {
    console.error('[checkGoogleIntegrationEnabled] Unexpected error:', err);
    return false;
  }
}

// ===== معالجة تسجيل الدخول عبر Google =====
export async function handleGoogleCallback(req, res) {
  // 1. Check Integration
  const isEnabled = await checkGoogleIntegrationEnabled();
  if (!isEnabled) {
    return res.status(403).json({ error: 'Procéssus de connexion Google n\'est pas disponible pour le moment.' });
  }

  console.log('[handleGoogleCallback] Processing Google sign-in sync');
  const user = req.user; // From authMiddleware

  if (!user) {
    console.log('[handleGoogleCallback] No user session found');
    return res.status(401).json({ error: 'Unauthorized: No user session found' });
  }

  try {
    // 1. Check if user profile exists in public.user
    const { data: existingProfile, error: fetchError } = await supabaseAdmin
      .from('user')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchError) {
      console.error('[handleGoogleCallback] Error fetching profile:', fetchError);
      return res.status(500).json({ error: 'Database error checking profile' });
    }
    console.log('[handleGoogleCallback] Profile fetched successfully');

    // 2. Checking if profile exists in `public.user`
    // User requested: If in user table -> Complted. If not -> Require Signup.
    if (existingProfile) {
      console.log(`[handleGoogleCallback] Profile exists for ${user.email} -> Login allowed.`);

      // =========================================================
      // 🆕 SET HTTP-ONLY COOKIES (Secure Session) for Existing Users
      // =========================================================

      // 1. Extract Access Token from Header (Bearer ...)
      const authHeader = req.headers.authorization;
      const accessToken = authHeader && authHeader.split(' ')[1];

      // 2. Extract Refresh Token from Body
      const { refreshToken } = req.body;
      const effectiveRefreshToken = refreshToken || req.body.refresh_token;

      if (accessToken) res.cookie('access_token', accessToken, { ...COOKIE_OPTIONS, maxAge: ACCESS_TOKEN_EXPIRES });
      if (effectiveRefreshToken) res.cookie('refresh_token', effectiveRefreshToken, { ...COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_EXPIRES });

      // Determine name for response
      const rFirstName = user.first_name || user.user_metadata?.first_name || 'User';
      const rLastName = user.last_name || user.user_metadata?.last_name || '';

      return res.status(200).json({
        message: 'Google login synced & session cookies set',
        requireSignup: false,
        user: {
          id: user.id,
          email: user.email,
          firstName: rFirstName,
          lastName: rLastName
        }
      });

    } else {
      // 3. If profile does NOT exist -> Require Signup Completion
      console.log(`[handleGoogleCallback] User ${user.email} NOT found in DB -> Require completion`);

      // Extract basic info
      const metadata = user.user_metadata || {};
      const fullName = metadata.full_name || metadata.name || '';
      const nameParts = fullName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
      const avatarUrl = metadata.avatar_url || metadata.picture;

      // Generate a temporary REGISTRATION TOKEN
      const registrationToken = encryptTempToken({
        email: user.email,
        googleId: user.id,
        firstName: existingProfile ? existingProfile.firstName : firstName,
        lastName: existingProfile ? existingProfile.lastName : lastName,
        avatarUrl,
        verified: true,
        timestamp: Date.now()
      });

      return res.status(200).json({
        message: 'Google verification successful. Please complete registration.',
        requireSignup: true,
        signupData: {
          email: user.email,
          firstName: existingProfile ? existingProfile.firstName : firstName,
          lastName: existingProfile ? existingProfile.lastName : lastName,
          registrationToken // Frontend sends this back with password
        }
      });
    }

    // =========================================================
    // 🆕 SET HTTP-ONLY COOKIES (Secure Session)
    // =========================================================

    // 1. Extract Access Token from Header (Bearer ...)
    const authHeader = req.headers.authorization;
    const accessToken = authHeader && authHeader.split(' ')[1];

    // 2. Extract Refresh Token from Body (Frontend must send it!)
    const { refreshToken } = req.body;
    // Support snake_case too just in case
    const effectiveRefreshToken = refreshToken || req.body.refresh_token;

    console.log(`[handleGoogleCallback] Setting cookies - AccessToken: ${!!accessToken}, RefreshToken: ${!!effectiveRefreshToken}`);

    if (accessToken) {
      res.cookie('access_token', accessToken, {
        ...COOKIE_OPTIONS,
        maxAge: ACCESS_TOKEN_EXPIRES
      });
    }

    if (effectiveRefreshToken) {
      res.cookie('refresh_token', effectiveRefreshToken, {
        ...COOKIE_OPTIONS,
        maxAge: REFRESH_TOKEN_EXPIRES
      });
    }

    // Determine name for response
    const rFirstName = user.first_name || user.user_metadata?.full_name?.split(' ')[0] || 'User';
    const rLastName = user.last_name || user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || '';

    res.status(200).json({
      message: 'Google login synced & session cookies set',
      user: {
        id: user.id,
        email: user.email,
        firstName: rFirstName,
        lastName: rLastName
      }
    });

  } catch (error) {
    console.error('[handleGoogleCallback] Error:', error);
    res.status(500).json({ error: 'Internal server error during sync' });
  }
}

// ===== توليد رابط تسجيل الدخول (API Only) =====
export async function getGoogleAuthUrl(req, res) {
  // 1. Check Integration
  const isEnabled = await checkGoogleIntegrationEnabled();
  if (!isEnabled) {
    return res.status(403).json({ error: 'Procéssus de connexion Google n\'est pas disponible pour le moment.' });
  }

  console.log('[getGoogleAuthUrl] Generating Google OAuth URL');
  try {
    const { data, error } = await supabaseUser.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: req.headers.origin + '/auth/redirect', // The page that parses hash
        skipBrowserRedirect: true,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      console.error('[getGoogleAuthUrl] Supabase Error:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ url: data.url });

  } catch (error) {
    console.error('[getGoogleAuthUrl] Error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
}

// ===== تحديث الـ Access Token =====
export async function refreshToken(req, res) {
  console.log(`[refreshToken] Request received`);

  try {
    const refreshToken = req.cookies.refresh_token;

    if (!refreshToken) {
      console.log(`[refreshToken] No refresh token found`);
      return res.status(401).json({ error: 'No refresh token found' });
    }

    // تحديث الـ session
    const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data?.session) {
      console.error('[refreshToken] Error refreshing session:', error);
      // مسح الـ cookies التالفة
      res.clearCookie('access_token', COOKIE_OPTIONS);
      res.clearCookie('refresh_token', COOKIE_OPTIONS);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // تعيين الـ cookies الجديدة
    res.cookie('access_token', data.session.access_token, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_EXPIRES
    });

    res.cookie('refresh_token', data.session.refresh_token, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_EXPIRES
    });

    console.log(`[refreshToken] Token refreshed successfully`);
    res.status(200).json({
      message: 'Token refreshed successfully',
      user: {
        id: data.user.id,
        email: data.user.email,
        firstName: data.user.user_metadata?.first_name,
        lastName: data.user.user_metadata?.last_name,
        phone: data.user.user_metadata?.phone,
      }
    });

  } catch (error) {
    console.error('[refreshToken] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== فحص حالة المستخدم =====
export async function getUser(req, res) {
  console.log(`[getUser] Request received`);

  try {
    const accessToken = req.cookies.access_token;

    if (!accessToken) {
      console.log(`[getUser] No access token found`);
      return res.status(401).json({ error: 'No access token found' });
    }

    // التحقق من صحة الـ token
    const { data: userData, error } = await supabaseAdmin.auth.getUser(accessToken);

    if (error || !userData?.user) {
      console.error('[getUser] Error getting user:', error);
      return res.status(401).json({ error: 'Invalid access token' });
    }

    console.log(`[getUser] User data retrieved for:`, userData.user.email);
    res.status(200).json({
      user: {
        id: userData.user.id,
        email: userData.user.email,
        firstName: userData.user.user_metadata?.first_name,
        lastName: userData.user.user_metadata?.last_name,
        phone: userData.user.user_metadata?.phone,
      }
    });

  } catch (error) {
    console.error('[getUser] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== Debug والمساعدة (للتطوير فقط) =====
export async function debugCodes(req, res) {
  try {
    const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers();
    const pendingUsers = allUsers.users.filter(u =>
      !u.email_confirmed_at && u.user_metadata?.status === 'pending_verification'
    );

    const activeCodes = pendingUsers.map(user => ({
      email: user.email,
      userId: user.id,
      code: user.user_metadata.verification_code,
      expiresAt: new Date(user.user_metadata.verification_expires).toISOString(),
      timeRemaining: Math.max(0, Math.ceil((user.user_metadata.verification_expires - Date.now()) / 1000)),
      userData: {
        firstName: user.user_metadata.first_name,
        lastName: user.user_metadata.last_name,
      },
      createdAt: user.created_at
    }));

    console.log(`[debugCodes] Active codes count:`, activeCodes.length);
    res.status(200).json({
      count: activeCodes.length,
      codes: activeCodes
    });

  } catch (error) {
    console.error('[debugCodes] Error:', error);
    res.status(500).json({ error: 'Failed to fetch debug info' });
  }
}

// ===== مسح جميع المستخدمين المعلقين (للتطوير فقط) =====
export async function clearCodes(req, res) {
  try {
    const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers();
    const pendingUsers = allUsers.users.filter(u =>
      !u.email_confirmed_at && u.user_metadata?.status === 'pending_verification'
    );

    // حذف المستخدمين المعلقين
    const deletePromises = pendingUsers.map(user =>
      supabaseAdmin.auth.admin.deleteUser(user.id)
    );

    await Promise.all(deletePromises);
    console.log(`[clearCodes] Cleared pending users:`, pendingUsers.length);
    res.status(200).json({
      message: `Cleared ${pendingUsers.length} pending verification users`
    });

  } catch (error) {
    console.error('[clearCodes] Error:', error);
    res.status(500).json({ error: 'Failed to clear codes' });
  }
}

// ===== إرسال كود تغيير الإيميل =====
export async function sendEmailUpdateCode(req, res) {
  try {
    const userId = req.user.id;
    const { newEmail } = req.body;
    if (!newEmail) return res.status(400).json({ error: 'New email is required' });
    const { data: allUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) return res.status(500).json({ error: 'Failed to fetch users' });
    const emailExists = allUsers.users.some(u => u.email === newEmail);
    if (emailExists) return res.status(409).json({ error: 'Email already in use' });
    const code = Math.floor(100000 + Math.random() * 900000);
    const now = Date.now();
    await sendEmail({ to: newEmail, subject: 'Email Change Code', text: `Your verification code is: ${code}` });
    await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: { email_update_code: code, email_update_expires: now + 5 * 60 * 1000, pending_email: newEmail } });
    res.json({ message: 'Verification code sent to new email' });
  } catch (error) {
    console.error('sendEmailUpdateCode error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}

// ===== التحقق من كود تغيير الإيميل وتحديث الإيميل =====
export async function verifyEmailUpdateCode(req, res) {
  try {
    const userId = req.user.id;
    const { code: userCode } = req.body;
    if (!userCode) {
      return res.status(400).json({ error: 'الكود مطلوب' });
    }
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
    const meta = user.user_metadata;
    const now = Date.now();
    if (!meta.email_update_code || !meta.pending_email) {
      return res.status(400).json({ error: 'لا يوجد طلب تغيير إيميل' });
    }
    if (meta.email_update_code.toString() !== userCode.toString()) {
      return res.status(400).json({ error: 'الكود غالط' });
    }
    if (now > meta.email_update_expires) {
      return res.status(400).json({ error: 'الكود فات وقتو' });
    }
    // كل شيء صحيح، بدّل الإيميل في Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: meta.pending_email,
      user_metadata: {
        ...meta,
        email_update_code: null,
        email_update_expires: null,
        pending_email: null,
      },
    });
    console.log("data ---------  ", data);
    if (error) {
      console.error('Supabase email update error:', error);
      return res.status(500).json({ error: 'فشل في تغيير الإيميل', details: error.message });
    }
    // بدّل الإيميل في جدول user
    await supabaseAdmin.from('user').update({ email: meta.pending_email }).eq('user_id', userId);
    res.json({ message: 'تم تغيير الإيميل بنجاح' });
  } catch (error) {
    console.error('verifyEmailUpdateCode error:', error);
    res.status(500).json({ error: 'خطأ في السيرفر' });
  }
}

export async function verifyPassword(req, res) {
  try {
    const { email, password } = req.body;
    console.log(email, password, "email and password-----------------")
    if (!email || !password) return res.status(400).json({ valid: false, error: 'Email and password are required' });
    // Get user by email
    const { data: userData, error: userError } = await supabaseAdmin.from('user').select('password').eq('email', email);
    if (userError || !userData || userData.length === 0) return res.status(404).json({ valid: false, error: 'User not found' });
    // Compare password (plain text)
    console.log(userData, password, userData[0].password == password, "password-----------------")
    if (userData[0].password == password) {
      return res.json({ valid: true });
    } else {
      return res.json({ valid: false });
    }
  } catch (error) {
    console.error('verifyPassword error:', error);
    res.status(500).json({ valid: false, error: 'Server error' });
  }
}

export async function sendEmailOtpCode(req, res) {
  console.log("sendEmailOtpCode----------------");
  try {
    const userId = req.user.id;
    const { otpKey } = req.body;
    const email = req.body.newEmail || req.body.email;
    console.log("email", email, otpKey);
    console.log("userId", userId, "email", email, "otpKey", otpKey);
    if (!email || !otpKey) return res.status(400).json({ error: 'Email and otpKey are required' });
    // Determine entityType based on otpKey
    let entityType = 'all';
    if (otpKey.includes('user')) entityType = 'user';
    else if (otpKey.includes('clinic')) entityType = 'clinic';
    // Check if email is already used
    const { usedBy } = await validateEmailUsage(email, entityType, userId);
    if (usedBy) {
      return res.status(409).json({ error: `Email already used by a ${usedBy}` });
    }
    const code = Math.floor(100000 + Math.random() * 900000);
    console.log("code", code);
    const expires = Date.now() + 5 * 60 * 1000;
    await sendEmail({ to: email, subject: 'Your OTP Code', text: `Your verification code is: ${code}` });
    // Store in user_metadata
    const { data: { user }, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (getUserError || !user) return res.status(404).json({ error: 'User not found' });
    const meta = user.user_metadata || {};
    meta[`${otpKey}_otp_code`] = code.toString();
    meta[`${otpKey}_otp_expires`] = expires;
    await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: meta });
    res.json({ message: 'OTP code sent to email' });
  } catch (error) {
    console.error('sendEmailOtpCode error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function verifyEmailOtpCode(req, res, next) {
  try {
    const userId = req.user.id;
    const { code, otpKey } = req.body;
    const { email } = req.body.clinicData;
    console.log("verifyEmailOtpCode----------------", email, code, otpKey);
    if (!email || !code || !otpKey) {
      return res.status(400).json({ error: 'Email, code, and otpKey are required' });
    }
    const { data: { user }, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (getUserError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const meta = user.user_metadata || {};
    const storedCode = meta[`${otpKey}_otp_code`];
    const expires = meta[`${otpKey}_otp_expires`];
    if (!storedCode || !expires) {
      return res.status(400).json({ error: 'No code found for this request' });
    }
    if (Date.now() > expires) {
      return res.status(400).json({ error: 'Code expired' });
    }
    if (storedCode !== code.toString()) {
      return res.status(400).json({ error: 'Invalid code' });
    }
    // Code is valid - remove OTP data from metadata
    delete meta[`${otpKey}_otp_code`];
    delete meta[`${otpKey}_otp_expires`];
    const { data: updatedUser, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: meta });
    if (updateError) {
      console.error("Error updating user metadata:", updateError);
      return res.status(500).json({ error: 'Failed to clean up OTP data' });
    }
    // Success: call next middleware
    return next();
  } catch (error) {
    console.error('verifyEmailOtpCode error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}


// ===== Password Reset Flow (Request, Verify, Update) =====

export async function sendPasswordResetOtp(req, res) {
  try {
    const { email } = req.body;
    const { data: userData, error: userError } = await supabaseAdmin.from('user').select('user_id').eq('email', email).single();
    console.log("userData", userData, "userError", userError);
    if (userError || !userData) return res.status(404).json({ error: 'User not found' });

    const code = Math.floor(100000 + Math.random() * 900000);
    const expires = Date.now() + 5 * 60 * 1000;
    await sendEmail({ to: email, subject: 'Password Reset OTP', text: `Your code: ${code}` });
    console.log("code", code, "expires", expires);
    const { data: { user }, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userData.user_id);
    if (getUserError || !user) return res.status(404).json({ error: 'User not found' });
    const meta = user.user_metadata || {};
    meta.reset_otp_code = code.toString();
    meta.reset_otp_expires = expires;
    // Remove any previous reset token
    meta.reset_token = null;
    meta.reset_token_expires = null;
    await supabaseAdmin.auth.admin.updateUserById(userData.user_id, { user_metadata: meta });

    res.json({ message: 'OTP code sent to email' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
}

export async function verifyResetOtp(req, res) {
  try {
    const { email, code } = req.body;
    const { data: userData, error: userError } = await supabaseAdmin.from('user').select('user_id').eq('email', email).single();
    if (userError || !userData) return res.status(404).json({ error: 'User not found' });

    const { data: { user }, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userData.user_id);
    if (getUserError || !user) return res.status(404).json({ error: 'User not found' });
    const meta = user.user_metadata || {};
    if (!meta.reset_otp_code || !meta.reset_otp_expires) return res.status(400).json({ error: 'No OTP found' });
    if (Date.now() > meta.reset_otp_expires) return res.status(400).json({ error: 'OTP expired' });
    if (meta.reset_otp_code !== code.toString()) return res.status(400).json({ error: 'Invalid OTP code' });

    // Generate a short-lived reset token (random string)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = Date.now() + 10 * 60 * 1000; // 10 min expiry
    meta.reset_token = resetToken;
    meta.reset_token_expires = resetTokenExpires;
    // Remove OTP after successful verification
    meta.reset_otp_code = null;
    meta.reset_otp_expires = null;
    await supabaseAdmin.auth.admin.updateUserById(userData.user_id, { user_metadata: meta });

    res.json({ resetToken });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
}

export async function updatePasswordWithResetToken(req, res) {
  try {
    const { email, resetToken, newPassword } = req.body;
    const { data: userData, error: userError } = await supabaseAdmin.from('user').select('user_id').eq('email', email).single();
    if (userError || !userData) return res.status(404).json({ error: 'User not found' });

    const { data: { user }, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userData.user_id);
    if (getUserError || !user) return res.status(404).json({ error: 'User not found' });
    const meta = user.user_metadata || {};
    if (!meta.reset_token || !meta.reset_token_expires) return res.status(400).json({ error: 'No reset token found' });
    if (Date.now() > meta.reset_token_expires) return res.status(400).json({ error: 'Reset token expired' });
    if (meta.reset_token !== resetToken) return res.status(400).json({ error: 'Invalid reset token' });

    // Update password in Auth and user table
    await supabaseAdmin.auth.admin.updateUserById(userData.user_id, { password: newPassword, user_metadata: { ...meta, reset_token: null, reset_token_expires: null } });
    await supabaseAdmin.from('user').update({ password: newPassword }).eq('user_id', userData.user_id);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
}

// ===== Account Deletion - Step 1: Initiate =====
export async function initiateAccountDeletion(req, res) {
  try {
    const { password } = req.body;
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    console.log(`[initiateAccountDeletion] Request for user:`, userId);

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // 1. Verify password
    const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
      email: userEmail,
      password: password
    });

    if (authError || !authData.user) {
      console.log(`[initiateAccountDeletion] Password verification failed for:`, userEmail);
      return res.status(401).json({ error: 'Invalid password' });
    }

    // 2. Check if user owns any clinics
    const { data: ownedClinics, error: clinicsError } = await supabaseAdmin
      .from('clinics')
      .select('id, clinic_name,logo_url')
      .eq('created_by', userId);

    if (clinicsError) {
      console.error('[initiateAccountDeletion] Error checking clinics:', clinicsError);
      return res.status(500).json({ error: 'Failed to check clinic ownership' });
    }

    if (ownedClinics && ownedClinics.length > 0) {
      console.log(`[initiateAccountDeletion] User owns ${ownedClinics.length} clinic(s)`);
      return res.status(400).json({
        error: 'You cannot delete your account while you own clinics. Please delete or transfer ownership of all your clinics first.',
        ownedClinics: ownedClinics.map(c => ({
          id: c.id,
          name: c.clinic_name,
          logo_url: c.logo_url
        }))
      });
    }

    // 3. Generate OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

    // 4. Store OTP in user_metadata
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        delete_account_otp: code,
        delete_account_otp_expires: expires
      }
    });

    if (updateError) {
      console.error('[initiateAccountDeletion] Failed to store OTP:', updateError);
      return res.status(500).json({ error: 'Failed to generate verification code' });
    }

    // 5. Send OTP email
    try {
      const html = renderEmailTemplate({
        code: code,
        email: userEmail,
        templateName: '2fa_email.html'
      });

      await sendEmail({
        to: userEmail,
        subject: 'Account Deletion Verification Code',
        text: `Your account deletion verification code is: ${code}. This code will expire in 10 minutes.`,
        html: html
      });

      console.log(`[initiateAccountDeletion] OTP sent to:`, userEmail);
    } catch (emailError) {
      console.error('[initiateAccountDeletion] Failed to send email:', emailError);
      return res.status(500).json({ error: 'Failed to send verification email' });
    }

    res.status(200).json({
      message: 'Verification code sent to your email',
      expiresIn: 600 // 10 minutes in seconds
    });

  } catch (error) {
    console.error('[initiateAccountDeletion] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== Account Deletion - Step 2: Confirm =====
export async function confirmAccountDeletion(req, res) {
  try {
    const { code } = req.body;
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    console.log(`[confirmAccountDeletion] Request for user:`, userId);

    if (!code) {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    // 1. Fetch user metadata to verify OTP
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const meta = user.user_metadata || {};
    const storedCode = meta.delete_account_otp;
    const expires = meta.delete_account_otp_expires;

    // 2. Verify OTP
    if (!storedCode || !expires) {
      return res.status(400).json({
        error: 'No deletion request found. Please initiate account deletion first.'
      });
    }

    if (Date.now() > expires) {
      return res.status(400).json({ error: 'Verification code expired' });
    }

    if (storedCode !== code.toString()) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // 3. Double-check clinic ownership (safety check)
    const { data: ownedClinics } = await supabaseAdmin
      .from('clinics')
      .select('id')
      .eq('created_by', userId);

    if (ownedClinics && ownedClinics.length > 0) {
      console.log(`[confirmAccountDeletion] User still owns clinics, blocking deletion`);
      return res.status(400).json({
        error: 'You still own clinics. Please delete or transfer ownership first.'
      });
    }

    // 3.5. Explicitly delete from 'user' table
    const { error: userTableError } = await supabaseAdmin
      .from('user')
      .delete()
      .eq('user_id', userId);

    if (userTableError) {
      console.error('[confirmAccountDeletion] Failed to delete from user table:', userTableError);
      return res.status(500).json({ error: 'Failed to clean up user data' });
    }

    // 4. Delete user from Supabase Auth (cascade will handle related records)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('[confirmAccountDeletion] Failed to delete user:', deleteError);
      return res.status(500).json({ error: 'Failed to delete account' });
    }

    console.log(`[confirmAccountDeletion] Account deleted successfully:`, userEmail);

    res.status(200).json({
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('[confirmAccountDeletion] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== إكمال التسجيل عبر Google (New Endpoint) =====
export async function completeGoogleSignup(req, res) {
  // 1. Check Integration
  const isEnabled = await checkGoogleIntegrationEnabled();
  if (!isEnabled) {
    return res.status(403).json({ error: 'Procéssus de connexion Google n\'est pas disponible pour le moment.' });
  }

  const { registrationToken, password, firstName, lastName, phone } = req.body;
  console.log('[completeGoogleSignup] Request received', req.body);

  if (!registrationToken || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Decrypt and Verify Token
    let tokenData;
    try {
      tokenData = decryptTempToken(registrationToken);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid or expired registration session' });
    }

    // Verify timestamp (e.g. valid for 30 mins)
    if (Date.now() - tokenData.timestamp > 30 * 60 * 1000) {
      return res.status(400).json({ error: 'Session expired. Please try Google login again.' });
    }

    const email = tokenData.email;
    const googleId = tokenData.googleId;

    console.log(`[completeGoogleSignup] Finalizing signup for ${email}`);

    // 2. Create User Profile
    const finalFirstName = firstName || tokenData.firstName || 'User';
    const finalLastName = lastName || tokenData.lastName || '';

    // Update password for the existing user (Google user)
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(googleId, {
      password: password,
      user_metadata: {
        first_name: finalFirstName,
        last_name: finalLastName,
        phone: phone || null,
        google_setup_complete: true // MARK AS COMPLETE
      },
      // IMPORTANT: Explicitly set email to auto-confirm without sending email to user
      email_confirm: true
    });

    if (updateError) {
      console.error('[completeGoogleSignup] Error updating auth user:', updateError);
      return res.status(500).json({ error: 'Failed to set password' });
    }

    // 3. Create or Update User Profile in `public.user` table
    const userProfile = {
      user_id: googleId,
      email: email.toLowerCase(),
      firstName: finalFirstName,
      lastName: finalLastName,
      phone: phone || null,
      email_verified: true,
      password: password,
      created_at: new Date().toISOString() // upsert works with existing created_at usually or we exclude it on match
    };

    // Use upsert to handle both new users and existing users (force completion flow)
    const { error: insertError } = await supabaseAdmin
      .from('user')
      .upsert([userProfile], { onConflict: 'user_id' }); // Use user_id as conflict target

    if (insertError) {
      console.error('[completeGoogleSignup] Error creating/updating profile:', insertError);
      return res.status(500).json({ error: 'Failed to save user profile' });
    }

    // 4. Create Security Entry (Upsert or Ignore if exists)
    const { error: secError } = await supabaseAdmin
      .from('user_security')
      .upsert([{ user_id: googleId }], { onConflict: 'user_id', ignoreDuplicates: true });

    if (secError) {
      console.error('[completeGoogleSignup] Security entry error (non-fatal):', secError);
    }

    // 5. Auto-Login (Generate Session)
    const { data: loginData, error: loginError } = await supabaseUser.auth.signInWithPassword({
      email,
      password
    });

    if (loginError || !loginData.session) {
      return res.status(201).json({
        message: 'Account created successfully. Please login.',
        details: 'Login required'
      });
    }

    // Set Cookies
    res.cookie('access_token', loginData.session.access_token, { ...COOKIE_OPTIONS, maxAge: ACCESS_TOKEN_EXPIRES });
    res.cookie('refresh_token', loginData.session.refresh_token, { ...COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_EXPIRES });

    res.status(200).json({
      message: 'Signup completed and logged in',
      user: {
        id: googleId,
        email,
        firstName: finalFirstName,
        lastName: finalLastName
      }
    });

  } catch (error) {
    console.error('[completeGoogleSignup] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}