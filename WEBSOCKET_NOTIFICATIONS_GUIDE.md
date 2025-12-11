# WebSocket Notifications - Client Integration Guide

## Overview
This guide shows how to integrate Socket.IO client to receive real-time notifications from the server.

## Installation

```bash
npm install socket.io-client
```

## Client-Side Implementation

### 1. Initialize Socket Connection

```javascript
import { io } from 'socket.io-client';

// Connect to the WebSocket server
const socket = io('http://localhost:5000', {
  withCredentials: true,
  transports: ['websocket', 'polling']
});

// Connection event handlers
socket.on('connect', () => {
  console.log('✅ Connected to WebSocket server');
  
  // Join notification room after connection
  const userId = getCurrentUserId(); // Your function to get user ID
  socket.emit('join_notification_room', { userId });
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from WebSocket server');
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
```

### 2. Listen for New Notifications

```javascript
// Listen for new notifications
socket.on('new_notification', (notification) => {
  console.log('🔔 New notification received:', notification);
  
  // notification object structure:
  // {
  //   id: string,
  //   userId: string,
  //   title: string,
  //   message: string,
  //   type: 'info' | 'success' | 'error',
  //   isRead: boolean,
  //   token: string,
  //   metaData: object,
  //   createdAt: timestamp,
  //   timestamp: Date,
  //   source: 'database_realtime' | 'manual_emission'
  // }
  
  // Update UI with new notification
  displayNotification(notification);
  
  // Show toast/alert
  showToast(notification.title, notification.message, notification.type);
  
  // Update notification badge count
  updateNotificationBadge();
});
```

### 3. Join Notification Room

```javascript
// Join user-specific notification room
function joinNotificationRoom(userId) {
  socket.emit('join_notification_room', { userId });
}

// Listen for successful room join
socket.on('notification_room_joined', (data) => {
  console.log('✅ Joined notification room:', data);
});

socket.on('notification_room_error', (error) => {
  console.error('❌ Failed to join notification room:', error);
});
```

### 4. Mark Notification as Read (via WebSocket)

```javascript
function markNotificationAsRead(notificationId, userId) {
  socket.emit('mark_notification_read', {
    notificationId,
    userId
  });
}

// Listen for confirmation
socket.on('notification_read_success', (data) => {
  console.log('✅ Notification marked as read:', data.notificationId);
  updateNotificationUI(data.notificationId, { isRead: true });
});

socket.on('notification_read_error', (error) => {
  console.error('❌ Failed to mark notification as read:', error);
});
```

### 5. Mark Notification as Read (via HTTP API)

```javascript
async function markNotificationAsReadAPI(notificationId) {
  try {
    const response = await fetch('http://localhost:5000/api/notifications/markAsRead', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}` // Your auth token
      },
      credentials: 'include',
      body: JSON.stringify({ notificationId })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Notification marked as read');
      updateNotificationUI(notificationId, { isRead: true });
    }
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
  }
}
```

### 6. Fetch All Notifications (HTTP API)

```javascript
async function fetchNotifications() {
  try {
    const response = await fetch('http://localhost:5000/api/notifications/getNotifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('📋 Notifications:', data.notifications);
      displayNotifications(data.notifications);
    }
  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
  }
}
```

### 7. Clear All Notifications (HTTP API)

```javascript
async function clearAllNotifications() {
  try {
    const response = await fetch('http://localhost:5000/api/notifications/clearAll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ All notifications cleared');
      clearNotificationUI();
    }
  } catch (error) {
    console.error('❌ Error clearing notifications:', error);
  }
}
```

## Complete React Example

```javascript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function NotificationComponent({ userId }) {
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io('http://localhost:5000', {
      withCredentials: true,
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('✅ Connected to WebSocket');
      newSocket.emit('join_notification_room', { userId });
    });

    // Listen for new notifications
    newSocket.on('new_notification', (notification) => {
      console.log('🔔 New notification:', notification);
      
      // Add to notifications list
      setNotifications(prev => [notification, ...prev]);
      
      // Update unread count
      setUnreadCount(prev => prev + 1);
      
      // Show toast notification
      showToast(notification.title, notification.message, notification.type);
    });

    newSocket.on('notification_room_joined', (data) => {
      console.log('✅ Joined notification room');
      // Fetch existing notifications
      fetchNotifications();
    });

    setSocket(newSocket);

    // Cleanup on unmount
    return () => {
      newSocket.close();
    };
  }, [userId]);

  const markAsRead = (notificationId) => {
    if (socket) {
      socket.emit('mark_notification_read', {
        notificationId,
        userId
      });
      
      // Update local state
      setNotifications(prev =>
        prev.map(notif =>
          notif.id === notificationId
            ? { ...notif, isRead: true }
            : notif
        )
      );
      
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
  };

  const fetchNotifications = async () => {
    // Implement API call to fetch notifications
    // Update notifications state
  };

  return (
    <div className="notifications">
      <div className="notification-badge">
        {unreadCount > 0 && <span>{unreadCount}</span>}
      </div>
      
      <div className="notification-list">
        {notifications.map(notif => (
          <div
            key={notif.id}
            className={`notification ${notif.isRead ? 'read' : 'unread'}`}
            onClick={() => markAsRead(notif.id)}
          >
            <h4>{notif.title}</h4>
            <p>{notif.message}</p>
            <span className="time">{new Date(notif.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default NotificationComponent;
```

## Server-Side: Creating Notifications

```javascript
import { addNotification } from './utils/notification.js';
import { io } from './server.js'; // Import io instance

// Example: Create a notification
async function createNotification(userId, title, message, type = 'info') {
  const { data, error } = await addNotification({
    user_id: userId,
    title,
    message,
    type,
    token: null, // Optional
    meta_data: { /* any additional data */ },
    io // Optional: for immediate emission (Supabase realtime will also broadcast)
  });
  
  if (error) {
    console.error('Failed to create notification:', error);
    return null;
  }
  
  return data;
}

// Example usage
await createNotification(
  'user-123',
  'New Message',
  'You have a new message from Dr. Smith',
  'info'
);
```

## API Endpoints

### POST `/api/notifications/getNotifications`
Fetch all notifications for the authenticated user.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "notifications": [
    {
      "id": "uuid",
      "user_id": "user-123",
      "title": "Notification Title",
      "message": "Notification message",
      "type": "info",
      "is_read": false,
      "created_at": "2025-11-22T10:00:00Z"
    }
  ]
}
```

### POST `/api/notifications/markAsRead`
Mark a specific notification as read.

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "notificationId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Notification marked as read"
}
```

### POST `/api/notifications/clearAll`
Clear all notifications for the authenticated user.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "message": "All notifications cleared successfully",
  "deletedCount": 5
}
```

## WebSocket Events

### Client → Server

| Event | Data | Description |
|-------|------|-------------|
| `join_notification_room` | `{ userId: string }` | Join user-specific notification room |
| `mark_notification_read` | `{ notificationId: string, userId: string }` | Mark notification as read |

### Server → Client

| Event | Data | Description |
|-------|------|-------------|
| `new_notification` | Notification object | New notification created |
| `notification_room_joined` | `{ message: string, userId: string }` | Successfully joined notification room |
| `notification_read_success` | `{ notificationId: string, timestamp: Date }` | Notification marked as read |
| `notification_room_error` | `{ error: string }` | Error joining notification room |
| `notification_read_error` | `{ error: string }` | Error marking notification as read |

## Notes

- **Automatic Broadcasting**: Notifications are automatically broadcast via Supabase realtime subscription when inserted into the database
- **Manual Emission**: You can optionally pass the `io` instance to `addNotification()` for immediate emission
- **User Rooms**: Each user joins a room named `user_{userId}` for targeted notifications
- **Persistence**: All notifications are stored in Supabase and can be fetched via API
