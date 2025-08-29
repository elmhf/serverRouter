
import { Router } from 'express';
import supabase from '../supabaseClient.js';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// In-memory storage for verification codes
const codes = new Map(); // email => { code, expires, lastSent, userData }

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "jihadchaabani75@gmail.com",
    pass: "rpyftsyyccvyoofk", // Gmail App Password
  },
});

// ======= Helpers =======
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function renderEmailTemplate({ code, firstName, lastName, email }) {

    const templatePath = path.join(__dirname, "..", "auth", "tamplate", "email.html");
    let html = fs.readFileSync(templatePath, "utf8");
    return html
      .replace(/\{\{CODE\}\}/g, code)
      .replace(/\{\{firstName\}\}/g, firstName || "")
      .replace(/\{\{lastName\}\}/g, lastName || "")
      .replace(/\{\{email\}\}/g, email || "");

    }

// Validation
const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const validateSignupInput = (req, res, next) => {
  const { email, password, firstName, lastName } = req.body;
  if (!email || !validateEmail(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First name and last name are required' });
  }
  next();
};

// ========== Step 1: Send Verification Code ==========
router.post('/send-verification-code', validateSignupInput, async (req, res) => {
  const { email, password, firstName, lastName, phone } = req.body;
  
  console.log('📧 Sending verification code to:', email);
  
  try {
    const now = Date.now();
    const existing = codes.get(email);

    // Rate limiting: 1 minute between requests
    if (existing && now - existing.lastSent < 60000) {
      const waitTime = Math.ceil((60000 - (now - existing.lastSent)) / 1000);
      console.log(`⏰ Rate limit hit for ${email}, wait ${waitTime}s`);
      return res.status(429).json({ 
        error: "الرجاء الانتظار قبل طلب رمز آخر - Please wait before requesting another code",
        waitTime: waitTime
      });
    }

    // Check if email already exists in Supabase
    const { data: existingUser, error: checkError } = await supabase
      .from('user')
      .select('email, email_verified')
      .eq('email', email)
      .single();

    if (existingUser && existingUser.email_verified) {
      console.log(`❌ Email already registered: ${email}`);
      return res.status(409).json({ error: 'البريد الإلكتروني مسجل بالفعل - Email already registered' });
    }

    // Generate and store verification code with user data
    const code = generateCode();
    const hashedPassword = await bcrypt.hash(password, 10);
    
    console.log(`🔢 Generated code ${code} for ${email}`);
    
    codes.set(email, {
      code,
      expires: now + 5 * 60 * 1000, // 5 minutes
      lastSent: now,
      userData: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone
      }
    });

    // Send verification email
    const html = renderEmailTemplate({ code, firstName, lastName, email });
    
    const mailOptions = {
      from: `"Xdantel" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "رمز التحقق - Your Verification Code",
      text: `رمز التحقق الخاص بك هو: ${code}\nYour verification code is: ${code}\nهذا الرمز صالح لمدة 5 دقائق - This code expires in 5 minutes.`,
      html: html,
    };

    console.log('📤 Sending email...');
    await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully');

    res.status(200).json({ 
      message: "تم إرسال رمز التحقق بنجاح - Verification code sent successfully",
      email: email,
      expiresIn: 300 // 5 minutes in seconds
    });

  } catch (error) {
    console.error('❌ Send verification code error:', error);
    
    // Check if it's a nodemailer error
    if (error.code === 'EAUTH') {
      return res.status(500).json({ 
        error: "خطأ في إعدادات البريد الإلكتروني - Email authentication failed. Please check email configuration." 
      });
    }
    
    res.status(500).json({ 
      error: "فشل في إرسال رمز التحقق - Failed to send verification code",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== Step 2: Verify Code and Create User ==========
router.post('/verify-and-signup', async (req, res) => {
  const { email, code } = req.body;

  console.log(`🔍 Verifying code for ${email}`);

  if (!email || !code) {
    return res.status(400).json({ 
      error: 'البريد الإلكتروني ورمز التحقق مطلوبان - Email and verification code are required' 
    });
  }

  try {
    const entry = codes.get(email);
    
    if (!entry) {
      console.log(`❌ No verification code found for ${email}`);
      return res.status(404).json({ 
        error: 'لم يتم العثور على رمز تحقق لهذا البريد الإلكتروني - No verification code found for this email' 
      });
    }

    const now = Date.now();
    if (now > entry.expires) {
      console.log(`⏰ Code expired for ${email}`);
      codes.delete(email);
      return res.status(400).json({ 
        error: 'انتهت صلاحية رمز التحقق - Verification code has expired' 
      });
    }

    if (entry.code !== code.toString()) {
      console.log(`❌ Invalid code for ${email}. Expected: ${entry.code}, Got: ${code}`);
      return res.status(400).json({ 
        error: 'رمز التحقق غير صحيح - Invalid verification code' 
      });
    }

    console.log(`✅ Code verified for ${email}, creating user...`);

    // Code is valid, create user in Supabase
    const { userData } = entry;
    
    // 1. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: userData.email,
      password: userData.password, // This should be the original password, not hashed
      user_metadata: {
        first_name: userData.firstName,
        last_name: userData.lastName,
        phone: userData.phone,
      },
      email_confirm: true, // Mark as confirmed since we verified via our system
    });

    if (authError) {
      console.error('❌ Supabase auth error:', authError);
      
      // Handle specific Supabase errors
      if (authError.message.includes('already registered')) {
        return res.status(400).json({ 
          error: 'البريد الإلكتروني مسجل بالفعل - Email already registered' 
        });
      }
      
      return res.status(400).json({ 
        error: 'فشل في إنشاء الحساب - Failed to create account',
        details: process.env.NODE_ENV === 'development' ? authError.message : undefined
      });
    }

    const userId = authData.user.id;
    console.log(`✅ User created in Supabase Auth with ID: ${userId}`);

    // 2. Insert user data in custom user table
    const { error: insertError } = await supabase
      .from('user')
      .insert([{
        user_id: userId,
        email: userData.email,
        password: userData.password, // Store hashed password
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        email_verified: true, // Already verified
        created_at: new Date().toISOString()
      }]);

    if (insertError) {
      console.error('❌ Database insert error:', insertError);
      // Cleanup: delete from auth if profile creation failed
      try {
        await supabase.auth.admin.deleteUser(userId);
        console.log('🧹 Cleaned up auth user after profile creation failure');
      } catch (cleanupError) {
        console.error('❌ Failed to cleanup auth user:', cleanupError);
      }
      
      return res.status(500).json({ 
        error: 'فشل في إنشاء ملف المستخدم - Failed to create user profile',
        details: process.env.NODE_ENV === 'development' ? insertError.message : undefined
      });
    }

    console.log(`✅ User profile created successfully for ${userData.email}`);

    // Clean up verification code
    codes.delete(email);
    console.log(`🧹 Cleaned up verification code for ${email}`);

    res.status(201).json({
      message: 'تم إنشاء الحساب وتأكيده بنجاح - User created and verified successfully',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        email_verified: true,
        created_at: authData.user.created_at
      }
    });

  } catch (error) {
    console.error('❌ Verify and signup error:', error);
    res.status(500).json({ 
      error: 'خطأ في الخادم - Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== Resend Verification Code ==========
router.post('/resend-verification-code', async (req, res) => {
  const { email } = req.body;

  console.log(`🔄 Resending verification code to: ${email}`);

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ 
      error: 'بريد إلكتروني صحيح مطلوب - Valid email is required' 
    });
  }

  try {
    const now = Date.now();
    const existing = codes.get(email);

    if (!existing) {
      console.log(`❌ No pending verification for ${email}`);
      return res.status(404).json({ 
        error: 'لا يوجد تحقق معلق لهذا البريد الإلكتروني - No pending verification for this email' 
      });
    }

    // Rate limiting
    if (now - existing.lastSent < 60000) {
      const waitTime = Math.ceil((60000 - (now - existing.lastSent)) / 1000);
      console.log(`⏰ Rate limit hit for resend ${email}, wait ${waitTime}s`);
      return res.status(429).json({ 
        error: "الرجاء الانتظار قبل طلب رمز آخر - Please wait before requesting another code",
        waitTime: waitTime
      });
    }

    // Generate new code but keep same user data
    const code = generateCode();
    existing.code = code;
    existing.expires = now + 5 * 60 * 1000;
    existing.lastSent = now;

    console.log(`🔢 Generated new code ${code} for ${email}`);

    // Send new verification email
    const html = renderEmailTemplate({ 
      code, 
      firstName: existing.userData.firstName, 
      lastName: existing.userData.lastName, 
      email 
    });
    
    const mailOptions = {
      from: `"Xdantel" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "رمز التحقق الجديد - Your New Verification Code",
      text: `رمز التحقق الجديد الخاص بك هو: ${code}\nYour new verification code is: ${code}\nهذا الرمز صالح لمدة 5 دقائق - This code expires in 5 minutes.`,
      html: html,
    };

    console.log('📤 Sending new verification email...');
    await transporter.sendMail(mailOptions);
    console.log('✅ New verification email sent successfully');

    res.status(200).json({ 
      message: "تم إرسال رمز التحقق الجديد بنجاح - New verification code sent successfully",
      expiresIn: 300
    });

  } catch (error) {
    console.error('❌ Resend verification code error:', error);
    
    if (error.code === 'EAUTH') {
      return res.status(500).json({ 
        error: "خطأ في إعدادات البريد الإلكتروني - Email authentication failed" 
      });
    }
    
    res.status(500).json({ 
      error: "فشل في إرسال رمز التحقق الجديد - Failed to resend verification code",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== Login Route ==========
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Check if email is pending verification
  if (codes.has(email)) {
    const entry = codes.get(email);
    const now = Date.now();
    const waitTime = Math.max(0, Math.ceil((60000 - (now - entry.lastSent)) / 1000));
    const expiresIn = Math.max(0, Math.ceil((entry.expires - now) / 1000));
    const restart_signup = expiresIn === 0;
    return res.status(403).json({
      error: 'Email is waiting for verification. Please verify your email before logging in.',
      state: 'pending_verification',
      waitTime, // seconds until they can request a new code
      expiresIn, // seconds until code expires
      restart_signup
    });
  }

  try {
    // Fetch user from Supabase user table
    const { data: user, error } = await supabase
      .from('user')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Compare password
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Optionally, you can generate a JWT or session here
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.user_id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email_verified: user.email_verified,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ========== Get active codes (development only) ==========
if (process.env.NODE_ENV === 'development') {
  router.get('/debug/active-codes', (req, res) => {
    const activeCodes = Array.from(codes.entries()).map(([email, data]) => ({
      email,
      code: data.code,
      expiresAt: new Date(data.expires).toISOString(),
      timeRemaining: Math.max(0, Math.ceil((data.expires - Date.now()) / 1000)),
      userData: {
        firstName: data.userData.firstName,
        lastName: data.userData.lastName
      }
    }));

    res.status(200).json({
      count: activeCodes.length,
      codes: activeCodes
    });
  });

  router.delete('/debug/clear-codes', (req, res) => {
    const count = codes.size;
    codes.clear();
    console.log(`🧹 Cleared ${count} verification codes`);
    
    res.status(200).json({
      message: `تم مسح ${count} رمز تحقق - Cleared ${count} verification codes`
    });
  });
}

export default router;