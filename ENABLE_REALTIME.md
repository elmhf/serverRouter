# كيفية تفعيل Supabase Realtime للإشعارات

## المشكلة
رسالة `New notification created in database` ما تظهرش في console السيرفر.

## السبب الأساسي
**Supabase Realtime مش مفعّل** على جدول `notifications`.

---

## ✅ الحل: تفعيل Realtime

### الطريقة 1: من Supabase Dashboard

1. افتح [Supabase Dashboard](https://supabase.com/dashboard)
2. اختر مشروعك
3. روح لـ **Database** → **Replication**
4. دوّر على جدول `notifications`
5. فعّل **Enable Realtime** ✅

### الطريقة 2: من SQL Editor

نفذ هذا الـ SQL:

```sql
-- تفعيل Realtime على جدول notifications
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- إضافة policy للـ realtime (إذا عندك RLS)
CREATE POLICY "Enable realtime for all users" 
ON notifications 
FOR SELECT 
USING (true);
```

---

## 🧪 اختبار Realtime

### 1. شغّل السيرفر
```bash
npm run dev
```

### 2. شوف console عند البداية
المفروض تشوف:
```
🔌 Initializing Supabase realtime subscriptions...
🔔 Notification subscription status: SUBSCRIBED
✅ Notification realtime subscription active
```

### 3. اختبر بإضافة notification

**من Supabase Dashboard:**
1. روح لـ **Table Editor**
2. افتح جدول `notifications`
3. اضغط **Insert row**
4. أضف:
   - `user_id`: أي user_id موجود
   - `title`: "Test"
   - `message`: "Testing realtime"
   - `type`: "info"
   - `is_read`: false

**المفروض تشوف في console:**
```
🔔 New notification created in database: {
  new: {
    id: "...",
    user_id: "...",
    title: "Test",
    message: "Testing realtime"
  }
}
🔔 Notification sent to user abc-123
```

---

## 🔍 استخدم Test Script

شغّل الـ script للتحقق:
```bash
node test-realtime.js
```

إذا شفت:
- ✅ `SUBSCRIBED` → Realtime شغال
- ❌ `CHANNEL_ERROR` → Realtime مش مفعّل

---

## 📊 الفرق بين Manual و Realtime

### Manual Emission (فوري)
```javascript
await addNotification({
  user_id: userId,
  title: "Test",
  io: req.app.locals.io  // ✅ يرسل فوراً
})
```
- يرسل **مباشرة** للـ client
- **لا يظهر** في console كـ "database_realtime"
- أسرع

### Realtime Subscription (تلقائي)
```javascript
await addNotification({
  user_id: userId,
  title: "Test"
  // بدون io
})
```
- يمر عبر Supabase Realtime
- **يظهر** في console كـ "New notification created in database"
- يعمل من أي مصدر (API, Dashboard, Trigger)

---

## ✅ التوصية

استخدم **الاثنين معاً**:
```javascript
await addNotification({
  user_id: userId,
  title: "Test",
  message: "Test message",
  io: req.app.locals.io  // Manual (سريع)
})
// + Realtime (backup تلقائي)
```

بهذه الطريقة:
- الإشعار يوصل **فوراً** عبر manual
- وإذا فشل، Realtime يرسله تلقائياً
