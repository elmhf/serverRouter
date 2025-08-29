import { supabaseUser } from '../supabaseClient.js';

export async function authMiddleware(req, res, next) {
  console.log('authMiddleware - HTTP-Only Cookies*****************');
  // قراءة الـ tokens من الـ HTTP-only cookies فقط
  let accessToken = req.cookies?.access_token;
  let refreshToken = req.cookies?.refresh_token;
console.log('Access Token:---------------------------8888888888888888', req.cookies);
  // التحقق من وجود الـ token في الـ headers (للـ API calls)
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
      // الـ token صالح
      req.user = {
        id: userData.user.id,
        email: userData.user.email,
        ...userData.user.user_metadata
      };
      return next();
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

  // Access token - مدة قصيرة
  res.cookie('access_token', accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000 // 15 دقيقة
  });

  // Refresh token - مدة أطول
  res.cookie('refresh_token', refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 أيام
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
