/**
 * مثال كامل: كيفية الاتصال بالـ WebSocket Rooms
 * 
 * تثبيت المكتبة أولاً:
 * npm install socket.io-client
 */

import { io } from 'socket.io-client';

// ========================================
// 1. إعداد الاتصال
// ========================================

const socket = io('http://localhost:5000', {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
});

// ========================================
// 2. معلومات المستخدم (من session أو context)
// ========================================

const userId = 'user-123';        // ID المستخدم الحالي
const clinicId = 'clinic-456';    // ID العيادة
let currentPatientId = null;      // ID المريض الحالي (يتغير عند الاختيار)

// ========================================
// 3. الاتصال بالسيرفر
// ========================================

socket.on('connect', () => {
    console.log('✅ Connected to WebSocket server');
    console.log('Socket ID:', socket.id);

    // الانضمام للـ rooms الأساسية
    joinNotificationRoom();
    joinClinicRoom();
});

socket.on('disconnect', (reason) => {
    console.log('❌ Disconnected from server:', reason);
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
});

// ========================================
// 4. الانضمام لـ Notification Room
// ========================================

function joinNotificationRoom() {
    socket.emit('join_notification_room', { userId });

    console.log(`🔔 Joining notification room: user_${userId}`);
}

// استقبال تأكيد الانضمام
socket.on('notification_room_joined', (data) => {
    console.log('✅ Joined notification room:', data);
});

socket.on('notification_room_error', (error) => {
    console.error('❌ Failed to join notification room:', error);
});

// ========================================
// 5. الانضمام لـ Clinic Room
// ========================================

function joinClinicRoom() {
    socket.emit('user_login', {
        userId,
        clinicId
    });

    console.log(`🏥 Joining clinic room: clinic_${clinicId}`);
}

// استقبال تأكيد الانضمام
socket.on('login_success', (data) => {
    console.log('✅ Joined clinic room:', data);
});

socket.on('login_error', (error) => {
    console.error('❌ Failed to join clinic room:', error);
});

// ========================================
// 6. الانضمام لـ Patient Room (عند اختيار مريض)
// ========================================

function selectPatient(patientId) {
    currentPatientId = patientId;

    socket.emit('select_patient', {
        userId,
        clinicId,
        patientId
    });

    console.log(`👤 Selecting patient: patient_${patientId}`);
}

// استقبال تأكيد الانضمام
socket.on('patient_selection_success', (data) => {
    console.log('✅ Joined patient room:', data);
});

socket.on('patient_selection_error', (error) => {
    console.error('❌ Failed to select patient:', error);
});

// ========================================
// 7. استقبال الإشعارات الشخصية
// ========================================

socket.on('new_notification', (notification) => {
    console.log('🔔 New notification received:', notification);

    // عرض الإشعار في الـ UI
    displayNotification(notification);

    // تحديث عداد الإشعارات
    updateNotificationBadge();
});

// ========================================
// 8. استقبال تحديثات العيادة
// ========================================

// تقرير جديد في العيادة
socket.on('report_created_realtime', (data) => {
    console.log('📊 New report created:', data);

    // تحديث قائمة التقارير
    refreshReportsList();
});

// تغيير حالة تقرير
socket.on('report_status_changed_realtime', (data) => {
    console.log('📊 Report status changed:', data);
    console.log(`Status: ${data.oldStatus} → ${data.newStatus}`);

    // تحديث التقرير في الـ UI
    updateReportStatus(data.reportId, data.newStatus);
});

// حذف تقرير
socket.on('report_deleted_realtime', (data) => {
    console.log('🗑️ Report deleted:', data);

    // إزالة التقرير من الـ UI
    removeReportFromUI(data.reportId);
});

// مستخدم انضم للعيادة
socket.on('user_joined_clinic', (data) => {
    console.log('👤 User joined clinic:', data);

    // تحديث قائمة المستخدمين المتصلين
    updateOnlineUsers();
});

// مستخدم غادر العيادة
socket.on('user_left_clinic', (data) => {
    console.log('👋 User left clinic:', data);

    // تحديث قائمة المستخدمين المتصلين
    updateOnlineUsers();
});

// ========================================
// 9. استقبال تحديثات المريض
// ========================================

// تحديث معلومات المريض
socket.on('patient_updated_detailed', (data) => {
    console.log('👤 Patient updated:', data);

    // تحديث بيانات المريض في الـ UI
    refreshPatientData(data.patientId);
});

// تقرير جديد للمريض الحالي
socket.on('report_created_realtime', (data) => {
    if (data.patientId === currentPatientId) {
        console.log('📊 New report for current patient:', data);

        // تحديث تقارير المريض
        refreshPatientReports();
    }
});

// ========================================
// 10. إرسال الرسائل (Chat)
// ========================================

function sendMessage(message) {
    socket.emit('send_message', {
        clinicId,
        patientId: currentPatientId, // اختياري
        message,
        senderId: userId,
        senderName: 'اسم المستخدم'
    });
}

// استقبال رسالة جديدة
socket.on('new_message', (data) => {
    console.log('💬 New message:', data);

    // عرض الرسالة في الـ chat
    displayMessage(data);
});

// ========================================
// 11. مؤشرات الكتابة (Typing Indicators)
// ========================================

function startTyping() {
    socket.emit('typing_start', {
        userId,
        clinicId,
        patientId: currentPatientId
    });
}

function stopTyping() {
    socket.emit('typing_stop', {
        userId,
        clinicId,
        patientId: currentPatientId
    });
}

// استقبال مؤشر الكتابة
socket.on('user_typing', (data) => {
    console.log('⌨️ User typing:', data);

    if (data.isTyping) {
        showTypingIndicator(data.userId);
    } else {
        hideTypingIndicator(data.userId);
    }
});

// ========================================
// 12. وضع علامة "مقروء" على الإشعار
// ========================================

function markNotificationAsRead(notificationId) {
    socket.emit('mark_notification_read', {
        notificationId,
        userId
    });
}

// استقبال تأكيد القراءة
socket.on('notification_read_success', (data) => {
    console.log('✅ Notification marked as read:', data.notificationId);

    // تحديث الإشعار في الـ UI
    updateNotificationUI(data.notificationId, { isRead: true });
});

// ========================================
// 13. دوال مساعدة للـ UI (أمثلة)
// ========================================

function displayNotification(notification) {
    // مثال: عرض toast notification
    console.log(`📢 ${notification.title}: ${notification.message}`);

    // يمكنك استخدام مكتبة مثل react-toastify
    // toast.info(notification.message);
}

function updateNotificationBadge() {
    // تحديث عداد الإشعارات غير المقروءة
    console.log('🔔 Updating notification badge...');
}

function refreshReportsList() {
    // إعادة جلب قائمة التقارير من الـ API
    console.log('📊 Refreshing reports list...');
}

function updateReportStatus(reportId, newStatus) {
    // تحديث حالة التقرير في الـ UI
    console.log(`📊 Updating report ${reportId} status to ${newStatus}`);
}

function removeReportFromUI(reportId) {
    // إزالة التقرير من الـ UI
    console.log(`🗑️ Removing report ${reportId} from UI`);
}

function updateOnlineUsers() {
    // تحديث قائمة المستخدمين المتصلين
    console.log('👥 Updating online users list...');
}

function refreshPatientData(patientId) {
    // تحديث بيانات المريض
    console.log(`👤 Refreshing patient ${patientId} data...`);
}

function refreshPatientReports() {
    // تحديث تقارير المريض
    console.log('📊 Refreshing patient reports...');
}

function displayMessage(message) {
    // عرض الرسالة في الـ chat
    console.log(`💬 ${message.senderName}: ${message.message}`);
}

function showTypingIndicator(userId) {
    // عرض مؤشر الكتابة
    console.log(`⌨️ User ${userId} is typing...`);
}

function hideTypingIndicator(userId) {
    // إخفاء مؤشر الكتابة
    console.log(`⌨️ User ${userId} stopped typing`);
}

function updateNotificationUI(notificationId, updates) {
    // تحديث الإشعار في الـ UI
    console.log(`🔔 Updating notification ${notificationId}:`, updates);
}

// ========================================
// 14. تصدير الدوال للاستخدام
// ========================================

export {
    socket,
    selectPatient,
    sendMessage,
    startTyping,
    stopTyping,
    markNotificationAsRead
};

// ========================================
// 15. مثال استخدام في React Component
// ========================================

/*
import { useEffect } from 'react';
import { socket, selectPatient } from './socket-client';

function MyComponent() {
  useEffect(() => {
    // الاتصال عند تحميل الـ component
    socket.connect();
    
    // الانفصال عند إزالة الـ component
    return () => {
      socket.disconnect();
    };
  }, []);
  
  const handleSelectPatient = (patientId) => {
    selectPatient(patientId);
  };
  
  return (
    <div>
      <button onClick={() => handleSelectPatient('patient-789')}>
        Select Patient
      </button>
    </div>
  );
}
*/
