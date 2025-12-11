import { supabaseUser } from '../../supabaseClient.js';

/**
 * Handle user joining notification room
 */
export const handleJoinNotificationRoom = (socket) => {
    socket.on('join_notification_room', async (data) => {
        try {
            const { userId } = data;

            // Join user-specific notification room
            socket.join(`user_${userId}`);

            console.log(`🔔 User ${userId} joined notification room`);

            socket.emit('notification_room_joined', {
                message: 'Successfully joined notification room',
                userId
            });

        } catch (error) {
            console.error('Notification room join error:', error);
            socket.emit('notification_room_error', { error: 'Failed to join notification room' });
        }
    });
};

/**
 * Handle marking notification as read
 */
export const handleMarkNotificationRead = (socket) => {
    socket.on('mark_notification_read', async (data) => {
        try {
            const { notificationId, userId } = data;

            // Update notification in database
            const { error } = await supabaseUser
                .from('notifications')
                .update({ is_read: true })
                .eq('id', notificationId)
                .eq('user_id', userId);

            if (error) {
                console.error('Error marking notification as read:', error);
                socket.emit('notification_read_error', { error: 'Failed to mark notification as read' });
                return;
            }

            console.log(`✅ Notification ${notificationId} marked as read`);

            // Emit confirmation to user
            socket.emit('notification_read_success', {
                notificationId,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Mark notification read error:', error);
            socket.emit('notification_read_error', { error: 'Failed to mark notification as read' });
        }
    });
};

/**
 * Initialize all notification handlers
 */
export const initializeNotificationHandlers = (socket) => {
    handleJoinNotificationRoom(socket);
    handleMarkNotificationRead(socket);
};
