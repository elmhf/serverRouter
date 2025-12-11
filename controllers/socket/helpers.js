/**
 * Helper function to emit to specific users
 */
export const emitToUser = (io, userId, event, data, connectedUsers) => {
    for (const [socketId, userInfo] of connectedUsers.entries()) {
        if (userInfo.userId === userId) {
            io.to(socketId).emit(event, data);
        }
    }
};

/**
 * Helper function to emit to clinic
 */
export const emitToClinic = (io, clinicId, event, data) => {
    io.to(`clinic_${clinicId}`).emit(event, data);
};

/**
 * Helper function to emit to patient viewers
 */
export const emitToPatient = (io, patientId, event, data) => {
    io.to(`patient_${patientId}`).emit(event, data);
};
