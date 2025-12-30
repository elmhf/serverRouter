import { supabaseUser } from '../../supabaseClient.js';
import { isClinicCreator } from '../../utils/permissionUtils.js';

/**
 * Handle patient selection
 */
export const handleSelectPatient = (socket, connectedUsers) => {
    socket.on('select_patient', async (data) => {
        try {
            const { userId, clinicId, patientId } = data;
            console.warn(`⛔  ${userId, clinicId, patientId}`);            // 🆕 Security Check: Verify Role
            // 1. Check if Creator
            const isCreator = await isClinicCreator(userId, clinicId);
            let hasAccess = isCreator;

            // 2. If not creator, check role (admin or full_access)
            if (!hasAccess) {
                const { data: userRole, error } = await supabaseUser
                    .from('user_clinic_roles')
                    .select('role')
                    .eq('user_id', userId)
                    .eq('clinic_id', clinicId)
                    .single();

                if (!error && userRole) {
                    if (['admin', 'full_access'].includes(userRole.role)) {
                        hasAccess = true;
                    }
                }
            }

            if (!hasAccess) {
                console.warn(`⛔ User ${userId} attempted to access patient ${patientId} without permission.`);
                socket.emit('patient_selection_error', {
                    error: 'Access Denied: You do not have permission to view this patient (Requires: Owner, Admin, or Full Access)'
                });
                return;
            }

            // Update user's current patient
            const userInfo = connectedUsers.get(socket.id);
            if (userInfo) {
                userInfo.currentPatientId = patientId;
                connectedUsers.set(socket.id, userInfo);
            }

            // Join patient-specific room
            socket.join(`patient_${patientId}`);
            // Also join the clinic room to receive clinic-wide updates (like updated_patient)
            socket.join(`clinic_${clinicId}`);

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
