import { supabaseUser, supabaseAdmin } from '../supabaseClient.js';
import jwt from 'jsonwebtoken';

// Token Expiration Configuration
const TOKEN_CONFIG = {
  ACCESS_TOKEN_AGE: parseInt(process.env.ACCESS_TOKEN_AGE) || 15 * 60 * 1000,
  REFRESH_TOKEN_AGE: parseInt(process.env.REFRESH_TOKEN_AGE) || 7 * 24 * 60 * 60 * 1000
};


export async function authMiddleware(req, res, next) {
  // Log the API request
  console.log(`[API Request] ${req.method} ${req.originalUrl || req.url}`);

  // 1. Check Maintenance Mode
  try {
    const { data: maintenanceSettings, error: maintenanceError } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'SERVER_API_MAINTENANCE_MODE')
      .maybeSingle();
    console.log("maintenanceSettings", maintenanceSettings);
    if (!maintenanceError && maintenanceSettings) {
      // Check if value is explicitly 'true' (string or boolean)
      const isMaintenanceModeActive = String(maintenanceSettings.value).toLowerCase() === 'true';

      if (!isMaintenanceModeActive) { // If value is NOT 'true'
        console.warn(`[Maintenance] Blocked access from ${req.ip}`);
        return res.status(503).json({
          error: 'Server is currently under maintenance. Please try again later.',
          code: 'MAINTENANCE_MODE'
        });
      }
    } else {

      console.log('[Maintenance] Setting not found, assuming system is UP.');
    }
  } catch (err) {
    console.error('[Maintenance] Failed to check status:', err);
    // Proceed or Block? Proceeding is safer for up-time.
  }

  let accessToken = req.cookies?.access_token;
  let refreshToken = req.cookies?.refresh_token;
  if (!accessToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    accessToken = req.headers.authorization.split(' ')[1];
  }

  if (!accessToken) {
    return res.status(401).json({
      error: 'No access token provided',
      code: 'NO_TOKEN'
    });
  }


  try {
    // محاولة التحقق من الـ access token
    const { data: userData, error: userError } = await supabaseUser.auth.getUser(accessToken);

    if (!userError && userData && userData.user) {
      // Check for global logout
      const metadata = userData.user.user_metadata || {};
      if (metadata.global_logout_at) {
        const logoutTime = new Date(metadata.global_logout_at).getTime();
        try {
          // Decode token to get 'iat' (Issued At)
          const payload = JSON.parse(atob(accessToken.split('.')[1]));
          const tokenIssuedAt = payload.iat * 1000; // Convert to ms

          // If the token was issued BEFORE the last global logout, it's invalid
          if (tokenIssuedAt < logoutTime) {
            console.warn('Token invalidated by global logout');
            clearAuthCookies(res);
            return res.status(401).json({
              error: 'Session expired (Global Logout)',
              code: 'GLOBAL_LOGOUT'
            });
          }
        } catch (e) {
          // Ignore parsing error for supabase tokens if needed, but it should work
        }
      }

      // Token is valid
      req.user = {
        id: userData.user.id,
        email: userData.user.email,
        ...userData.user.user_metadata
      };

      // ✅ Check if user is BANNED (exists in user_bans table)
      const { data: banRecord, error: banError } = await supabaseAdmin
        .from('user_bans')
        .select('id')
        .eq('user_id', userData.user.id)
        .maybeSingle();

      if (!banError && banRecord) {
        console.warn(`Blocked access for banned user: ${userData.user.email}`);
        clearAuthCookies(res);
        return res.status(403).json({
          error: 'Your account has been banned. Please contact support.',
          code: 'USER_BANNED'
        });
      }

      return next();
    }

    // ✅ Fallback: Try verifying as Custom Admin Token
    try {
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET || 'secret');
      if (decoded.role === 'admin' && decoded.type === 'admin_token') {
        req.user = {
          id: decoded.id,
          email: decoded.email,
          role: 'admin'
        };
        return next();
      }
    } catch (err) {
      // Just ignore invalid custom token, proceed to refresh logic
    }

    // إذا كان الـ access token غير صالح أو منتهي الصلاحية
    console.log('Access token invalid or expired, attempting refresh...');

    if (!refreshToken) {
      // مسح الـ cookies المنتهية الصلاحية
      clearAuthCookies(res);
      return res.status(401).json({
        error: 'Access token expired and no refresh token available',
        code: 'TOKEN_EXPIRED'
      });
    }

    // محاولة refresh الـ token
    const { data: refreshData, error: refreshError } = await supabaseUser.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (refreshError || !refreshData || !refreshData.session) {
      console.error('Refresh token error:', refreshError);
      // مسح الـ cookies غير الصالحة
      clearAuthCookies(res);
      return res.status(401).json({
        error: 'Failed to refresh token',
        code: 'REFRESH_FAILED'
      });
    }

    // تحديث الـ cookies بالـ tokens الجديدة
    const { session } = refreshData;
    setAuthCookies(res, session.access_token, session.refresh_token);

    // إعداد بيانات المستخدم
    req.user = {
      id: session.user.id,
      email: session.user.email,
      ...session.user.user_metadata
    };

    console.log('Token refreshed successfully for user:', session.user.email);
    return next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    clearAuthCookies(res);
    return res.status(500).json({
      error: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
}

// دالة لإعداد الـ HTTP-only cookies
function setAuthCookies(res, accessToken, refreshToken) {
  const isProduction = process.env.NODE_ENV === 'production';

  const cookieOptions = {
    httpOnly: true,        // HTTP-only لأمان أكبر
    secure: isProduction,  // HTTPS في الـ production فقط
    sameSite: 'lax',      // حماية من CSRF
    path: '/'
  };

  // Access token
  res.cookie('access_token', accessToken, {
    ...cookieOptions,
    maxAge: TOKEN_CONFIG.ACCESS_TOKEN_AGE
  });

  // Refresh token
  res.cookie('refresh_token', refreshToken, {
    ...cookieOptions,
    maxAge: TOKEN_CONFIG.REFRESH_TOKEN_AGE
  });
}

// دالة لمسح الـ cookies
function clearAuthCookies(res) {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  };

  res.clearCookie('access_token', cookieOptions);
  res.clearCookie('refresh_token', cookieOptions);
}

// دالة للتحقق من انتهاء صلاحية الـ token
export function isTokenExpired(token) {
  if (!token) return true;

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Date.now() / 1000;

    // التحقق إذا كان الـ token سينتهي خلال دقيقتين
    return payload.exp < (currentTime + 120);
  } catch (error) {
    console.error('Error checking token expiration:', error);
    return true;
  }
}

// Middleware للـ refresh المبكر
export async function preemptiveRefreshMiddleware(req, res, next) {
  const accessToken = req.cookies?.access_token;
  const refreshToken = req.cookies?.refresh_token;

  // فقط إذا كان هناك tokens وكان الـ access token قريب من الانتهاء
  if (accessToken && refreshToken && isTokenExpired(accessToken)) {
    console.log('Token will expire soon, refreshing preemptively...');

    try {
      const { data: refreshData, error } = await supabaseUser.auth.refreshSession({
        refresh_token: refreshToken
      });

      if (!error && refreshData?.session) {
        const { session } = refreshData;
        setAuthCookies(res, session.access_token, session.refresh_token);
        console.log('Preemptive refresh completed');
      }
    } catch (error) {
      console.error('Preemptive refresh error:', error);
      // لا نمسح الـ cookies هنا، نتركها للـ authMiddleware
    }
  }

  next();
}

// دالة لتسجيل الدخول وإعداد الـ cookies
export async function loginAndSetCookies(res, session) {
  if (!session || !session.access_token || !session.refresh_token) {
    throw new Error('Invalid session data');
  }

  setAuthCookies(res, session.access_token, session.refresh_token);

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      ...session.user.user_metadata
    }
  };
}

// دالة لتسجيل الخروج
export function logoutAndClearCookies(res) {
  clearAuthCookies(res);
  return { message: 'Logged out successfully' };
}

// Middleware للتحقق من صحة الـ cookies
export function validateCookiesMiddleware(req, res, next) {
  const accessToken = req.cookies?.access_token;
  const refreshToken = req.cookies?.refresh_token;

  // إذا كان هناك access token بدون refresh token، امسح الكل
  if (accessToken && !refreshToken) {
    console.log('Invalid cookie state: access token without refresh token');
    clearAuthCookies(res);
  }

  next();
}
