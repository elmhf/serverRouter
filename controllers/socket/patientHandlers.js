/**
 * Handle patient selection
 */
export const handleSelectPatient = (socket, connectedUsers) => {
    socket.on('select_patient', async (data) => {
        try {
            const { userId, clinicId, patientId } = data;

            // Update user's current patient
            const userInfo = connectedUsers.get(socket.id);
            if (userInfo) {
                userInfo.currentPatientId = patientId;
                connectedUsers.set(socket.id, userInfo);
            }

            // Join patient-specific room
            socket.join(`patient_${patientId}`);

            console.log(`👤 User ${userId} selected patient ${patientId}`);

            // Notify other users viewing the same patient
            socket.to(`patient_${patientId}`).emit('patient_selected', {
                userId,
                patientId,
                timestamp: new Date()
            });

            socket.emit('patient_selection_success', {
                message: 'Successfully connected to patient',
                patientId
            });

        } catch (error) {
            console.error('Patient selection error:', error);
            socket.emit('patient_selection_error', { error: 'Failed to select patient' });
        }
    });
};

/**
 * Handle patient updates
 */
export const handlePatientUpdated = (socket) => {
    socket.on('patient_updated', async (data) => {
        try {
            const { patientId, clinicId, updateType, updatedBy } = data;

            console.log(`📝 Patient ${patientId} updated by ${updatedBy}`);

            // Broadcast to all users in the clinic
            socket.to(`clinic_${clinicId}`).emit('patient_updated_notification', {
                patientId,
                updateType,
                updatedBy,
                timestamp: new Date()
            });

            // Also notify users specifically viewing this patient
            socket.to(`patient_${patientId}`).emit('patient_updated_detailed', {
                patientId,
                updateType,
                updatedBy,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Patient update notification error:', error);
        }
    });
};

/**
 * Initialize all patient handlers
 */
export const initializePatientHandlers = (socket, connectedUsers) => {
    handleSelectPatient(socket, connectedUsers);
    handlePatientUpdated(socket);
};
