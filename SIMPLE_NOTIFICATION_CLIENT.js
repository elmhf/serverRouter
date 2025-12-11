/**
 * ============================================
 * كود بسيط للاتصال واستقبال الإشعارات Real-Time
 * ============================================
 */

import { io } from 'socket.io-client';

// 1️⃣ الاتصال بالسيرفر
const socket = io('http://localhost:5000', {
    withCredentials: true,
    transports: ['websocket', 'polling']
});

// 2️⃣ معلومات المستخدم (غيّرها حسب المستخدم الحالي)
const userId = 'YOUR_USER_ID_HERE';  // ضع ID المستخدم هنا

// 3️⃣ عند الاتصال بالسيرفر
socket.on('connect', () => {
    console.log('✅ Connected to server');

    // الانضمام لـ notification room
    socket.emit('join_notification_room', { userId });
});

// 4️⃣ تأكيد الانضمام للـ room
socket.on('notification_room_joined', (data) => {
    console.log('✅ Joined notification room successfully:', data);
});

// 5️⃣ استقبال الإشعارات الجديدة 🔔
socket.on('new_notification', (notification) => {
    console.log('🔔 NEW NOTIFICATION RECEIVED:', notification);

    // البيانات المستلمة:
    console.log('ID:', notification.id);
    console.log('Title:', notification.title);
    console.log('Message:', notification.message);
    console.log('Type:', notification.type);
    console.log('Created At:', notification.createdAt);

    // هنا تقدر تعمل أي شيء بالإشعار:
    // - عرض toast notification
    // - تحديث الـ badge
    // - إضافة للقائمة
    // - تشغيل صوت

    showNotificationToUser(notification);
});

// 6️⃣ دالة لعرض الإشعار للمستخدم (مثال)
function showNotificationToUser(notification) {
    // مثال 1: عرض في console
    alert(`${notification.title}\n${notification.message}`);

    // مثال 2: إذا كنت تستخدم toast library
    // toast.info(notification.message);

    // مثال 3: إضافة للـ UI
    // addNotificationToList(notification);
}

// 7️⃣ معالجة الأخطاء
socket.on('notification_room_error', (error) => {
    console.error('❌ Error joining notification room:', error);
});

socket.on('disconnect', (reason) => {
    console.log('❌ Disconnected:', reason);
});

socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error);
});

// 8️⃣ (اختياري) وضع علامة "مقروء" على الإشعار
function markAsRead(notificationId) {
    socket.emit('mark_notification_read', {
        notificationId,
        userId
    });
}

// تأكيد القراءة
socket.on('notification_read_success', (data) => {
    console.log('✅ Notification marked as read:', data.notificationId);
});

// ============================================
// مثال للاستخدام في React
// ============================================

/*
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function NotificationComponent() {
  const [notifications, setNotifications] = useState([]);
  const [socket, setSocket] = useState(null);
  
  useEffect(() => {
    // الاتصال
    const newSocket = io('http://localhost:5000', {
      withCredentials: true
    });
    
    const userId = 'YOUR_USER_ID'; // من context أو session
    
    newSocket.on('connect', () => {
      console.log('✅ Connected');
      newSocket.emit('join_notification_room', { userId });
    });
    
    // استقبال الإشعارات
    newSocket.on('new_notification', (notification) => {
      console.log('🔔 New notification:', notification);
      
      // إضافة للقائمة
      setNotifications(prev => [notification, ...prev]);
      
      // عرض toast
      toast.info(notification.message);
    });
    
    setSocket(newSocket);
    
    // تنظيف عند الخروج
    return () => {
      newSocket.close();
    };
  }, []);
  
  return (
    <div>
      <h2>Notifications ({notifications.length})</h2>
      {notifications.map(notif => (
        <div key={notif.id} className="notification">
          <h3>{notif.title}</h3>
          <p>{notif.message}</p>
          <small>{new Date(notif.createdAt).toLocaleString()}</small>
        </div>
      ))}
    </div>
  );
}
*/

// ============================================
// مثال للاستخدام في Vue
// ============================================

/*
import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';

export default {
  setup() {
    const notifications = ref([]);
    let socket = null;
    
    onMounted(() => {
      socket = io('http://localhost:5000', {
        withCredentials: true
      });
      
      const userId = 'YOUR_USER_ID';
      
      socket.on('connect', () => {
        console.log('✅ Connected');
        socket.emit('join_notification_room', { userId });
      });
      
      socket.on('new_notification', (notification) => {
        console.log('🔔 New notification:', notification);
        notifications.value.unshift(notification);
      });
    });
    
    onUnmounted(() => {
      if (socket) {
        socket.close();
      }
    });
    
    return {
      notifications
    };
  }
};
*/

export { socket, markAsRead };
