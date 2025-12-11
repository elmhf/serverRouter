# Security Features Implementation

We have implemented the backend logic for the `user_security` table.

## 1. Database Schema
Assumed existing table:
```sql
CREATE TABLE IF NOT EXISTS public.user_security (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(user_id) ON DELETE CASCADE,
  two_factor_enabled boolean DEFAULT false,
  two_factor_secret text,
  two_factor_recovery_codes text[] DEFAULT ARRAY[]::text[],
  last_2fa_challenge timestamptz,
  login_notifications boolean DEFAULT true,
  allowed_devices jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

## 2. API Endpoints

### Get Security Settings
- **Method**: `GET`
- **URL**: `/api/security`
- **Headers**: `Authorization: Bearer <token>` (or cookie)
- **Response**: Returns the `user_security` row for the authenticated user.

### Update Security Settings
- **Method**: `PUT`
- **URL**: `/api/security`
- **Headers**: `Authorization: Bearer <token>` (or cookie)
- **Body**: JSON object with fields to update (e.g., `{ "two_factor_enabled": true, "login_notifications": false }`).
- **Response**: Returns the updated row.

## 3. 2-Step Verification (2FA)

### Initiate 2FA
- **Method**: `POST`
- **URL**: `/api/security/initiate`
- **Response**:
  ```json
  {
    "secret": "JBSWY3DPEHPK3PXP",
    "qrCode": "data:image/png;base64,..."
  }
  ```
  - Also sends an email to the user with the manual entry code.

### Verify and Enable 2FA
- **Method**: `POST`
- **URL**: `/api/security/verify`
- **Body**: `{ "token": "123456", "secret": "JBSWY3DPEHPK3PXP" }` (Secret from initiate step)
- **Response**:
  ```json
  {
    "message": "2-Factor Authentication enabled successfully",
    "recoveryCodes": ["...", "..."]
  }
  ```

### Login with 2FA
If a user has 2FA enabled, the standard `/api/auth/login` will return:
```json
{
  "message": "2-Factor Authentication required",
  "state": "2fa_required",
  "userId": "...",
  "tempToken": "..."
}
```
To complete login:
- **Method**: `POST`
- **URL**: `/api/auth/login-2fa`
- **Body**: `{ "tempToken": "...", "code": "123456" }`
- **Response**: Successful login with cookies.

### Disable 2FA (Step 1: Initiate)
- **Method**: `POST`
- **URL**: `/api/security/disable-initiate`
- **Body**: `{ "password": "current_password" }`
- **Response**: Sends verification code to email.

### Disable 2FA (Step 2: Confirm)
- **Method**: `POST`
- **URL**: `/api/security/disable-confirm`
- **Body**: `{ "code": "123456" }`
- **Response**: Success message.

## 4. Frontend Integration Guide

### 4.1 Enabling 2FA Flow
1. **Initiate**: Call `POST /api/security/initiate`.
   - Result: `{ secret: '...', qrCode: '...' }`
   - Action: Show QR Code to user.
2. **Scan & Input**: User scans QR code with Authenticator app and enters the 6-digit code.
3. **Verify**: Call `POST /api/security/verify` with `{ token: '123456', secret: '...' }`.
   - Success: 2FA is now enabled.
   - Store the returned `recoveryCodes` securely.

### 4.2 Login with 2FA Flow
1. **Normal Login**: User attempts login at `/api/auth/login`.
2. **Check Response**:
   - If `200 OK` and body contains `state: '2fa_required'`:
     - **Do NOT** redirect to dashboard yet.
     - Store `tempToken` from response in memory.
     - Show "Enter 2FA Code" screen.
   - If `200 OK` and normal user object: Login complete.
3. **Submit 2FA**: User enters code. Call `POST /api/auth/login-2fa` with `{ tempToken: '...', code: '123456' }`.
   - Success: Received auth cookies. Redirect to dashboard.

### 4.3 Client-Side Example (Javascript/React)

```javascript
async function handleLogin(email, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();

  if (response.ok) {
    if (data.state === '2fa_required') {
      // Step 2: 2FA Required
      const tempToken = data.tempToken;
      // Show 2FA Input UI...
      return { step: '2fa', tempToken };
    } else {
      // Login Success
      return { step: 'complete', user: data.user };
    }
  }
}

async function handle2FASubmit(tempToken, code) {
  const response = await fetch('/api/auth/login-2fa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken, code })
  });

  if (response.ok) {
    // 2FA Success - Cookies set
    window.location.href = '/dashboard';
  }
}

async function initiateDisable2FA(password) {
  const response = await fetch('/api/security/disable-initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  // If success, show OTP input
}

async function confirmDisable2FA(code) {
  const response = await fetch('/api/security/disable-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  // If success, 2FA is off
}
```

## 5. Automatic Creation
We have modified `authController.js` to automatically create a `user_security` record whenever a new user verifies their account and completes signup.

## 4. Files Created/Modified
- `controllers/securityController.js` (Created)
- `routes/securityRoutes.js` (Created)
- `server.js` (Modified to register routes)
- `controllers/authController.js` (Modified to add creation hook)
