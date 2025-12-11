/**
 * Handle user login and clinic selection
 */
export const handleUserLogin = (socket, connectedUsers) => {
    socket.on('user_login', async (data) => {
        try {
            const { userId, clinicId } = data;

            // Store user connection info
            connectedUsers.set(socket.id, {
                userId,
                clinicId,
                socketId: socket.id,
                connectedAt: new Date()
            });

            // Join clinic room for real-time updates
            socket.join(`clinic_${clinicId}`);

            console.log(`👤 User ${userId} joined clinic ${clinicId}`);

            // Notify other clinic members
            socket.to(`clinic_${clinicId}`).emit('user_joined_clinic', {
                userId,
                clinicId,
                timestamp: new Date()
            });

            socket.emit('login_success', {
                message: 'Successfully connected to clinic',
                clinicId,
                userId
            });

        } catch (error) {
            console.error('Socket login error:', error);
            socket.emit('login_error', { error: 'Failed to connect to clinic' });
        }
    });
};

/**
 * Handle user activity (online status)
 */
export const handleUserActivity = (socket) => {
    socket.on('user_activity', (data) => {
        const { userId, clinicId, activity } = data;

        socket.to(`clinic_${clinicId}`).emit('user_activity_update', {
            userId,
            activity,
            timestamp: new Date()
        });
    });
};

/**
 * Handle user disconnection
 */
export const handleDisconnect = (socket, connectedUsers) => {
    socket.on('disconnect', () => {
        const userInfo = connectedUsers.get(socket.id);

        if (userInfo) {
            console.log(`👋 User ${userInfo.userId} disconnected from clinic ${userInfo.clinicId}`);

            // Notify other clinic members
            socket.to(`clinic_${userInfo.clinicId}`).emit('user_left_clinic', {
                userId: userInfo.userId,
                clinicId: userInfo.clinicId,
                timestamp: new Date()
            });

            // Remove from connected users
            connectedUsers.delete(socket.id);
        }

        console.log(`🔌 User disconnected: ${socket.id}`);
    });
};

/**
 * Initialize all user handlers
 */
export const initializeUserHandlers = (socket, connectedUsers) => {
    handleUserLogin(socket, connectedUsers);
    handleUserActivity(socket);
    handleDisconnect(socket, connectedUsers);
};
