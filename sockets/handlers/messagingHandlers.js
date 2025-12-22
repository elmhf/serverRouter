/**
 * Handle real-time chat/messages
 */
export const handleSendMessage = (socket) => {
    socket.on('send_message', async (data) => {
        try {
            const { clinicId, patientId, message, senderId, senderName } = data;

            const messageData = {
                senderId,
                senderName,
                message,
                timestamp: new Date()
            };

            // Send to clinic members
            socket.to(`clinic_${clinicId}`).emit('new_message', messageData);

            // Also send to patient-specific room if patientId is provided
            if (patientId) {
                socket.to(`patient_${patientId}`).emit('new_patient_message', {
                    ...messageData,
                    patientId
                });
            }

        } catch (error) {
            console.error('Message sending error:', error);
        }
    });
};

/**
 * Handle typing start indicator
 */
export const handleTypingStart = (socket) => {
    socket.on('typing_start', (data) => {
        const { clinicId, patientId, userId } = data;

        if (patientId) {
            socket.to(`patient_${patientId}`).emit('user_typing', {
                userId,
                patientId,
                isTyping: true
            });
        } else {
            socket.to(`clinic_${clinicId}`).emit('user_typing', {
                userId,
                isTyping: true
            });
        }
    });
};

/**
 * Handle typing stop indicator
 */
export const handleTypingStop = (socket) => {
    socket.on('typing_stop', (data) => {
        const { clinicId, patientId, userId } = data;

        if (patientId) {
            socket.to(`patient_${patientId}`).emit('user_typing', {
                userId,
                patientId,
                isTyping: false
            });
        } else {
            socket.to(`clinic_${clinicId}`).emit('user_typing', {
                userId,
                isTyping: false
            });
        }
    });
};

/**
 * Initialize all messaging handlers
 */
export const initializeMessagingHandlers = (socket) => {
    handleSendMessage(socket);
    handleTypingStart(socket);
    handleTypingStop(socket);
};
