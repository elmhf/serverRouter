import { supabaseUser } from '../../supabaseClient.js';

// 🆕 دالة مساعدة لجلب عدد التقارير للمريض
export const getPatientReportsCount = async (patientId) => {
    try {
        const { count, error } = await supabaseUser
            .from('report_ai')
            .select('*', { count: 'exact', head: true })
            .eq('patient_id', patientId);

        if (error) {
            console.error('Error fetching patient reports count:', error);
            return 0;
        }

        return count || 0;
    } catch (error) {
        console.error('Error in getPatientReportsCount:', error);
        return 0;
    }
};

/**
 * Handle report creation notifications
 */
export const handleReportCreated = (socket) => {
    socket.on('report_created', async (data) => {
        try {
            const { reportId, patientId, clinicId, createdBy, reportType } = data;

            console.log(`📊 Report ${reportId} created for patient ${patientId}`);

            // 🆕 جلب عدد التقارير للمريض
            const totalReports = await getPatientReportsCount(patientId);

            // Broadcast to clinic members
            socket.to(`clinic_${clinicId}`).emit('report_created_notification', {
                reportId,
                patientId,
                reportType,
                createdBy,
                totalReports,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Report creation notification error:', error);
        }
    });
};

/**
 * Handle report status change notifications
 */
export const handleReportStatusChanged = (socket) => {
    socket.on('report_status_changed', async (data) => {
        try {
            const { reportId, patientId, clinicId, oldStatus, newStatus, updatedBy } = data;

            console.log(`📊 Report ${reportId} status changed from ${oldStatus} to ${newStatus}`);

            // 🆕 جلب عدد التقارير للمريض
            const totalReports = await getPatientReportsCount(patientId);

            // Broadcast to clinic members
            socket.to(`clinic_${clinicId}`).emit('report_status_changed_notification', {
                reportId,
                patientId,
                oldStatus,
                newStatus,
                updatedBy,
                totalReports,
                timestamp: new Date()
            });

            // Also notify users specifically viewing this patient
            socket.to(`patient_${patientId}`).emit('report_status_changed_detailed', {
                reportId,
                patientId,
                oldStatus,
                newStatus,
                updatedBy,
                totalReports,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Report status change notification error:', error);
        }
    });
};

/**
 * Handle report deletion notifications
 */
export const handleReportDeleted = (socket) => {
    socket.on('report_deleted', async (data) => {
        try {
            const { reportId, patientId, clinicId, deletedBy, reportType } = data;

            console.log(`🗑️ Report ${reportId} deleted by ${deletedBy}`);

            // 🆕 جلب عدد التقارير المتبقية للمريض
            const totalReports = await getPatientReportsCount(patientId);

            const deletionData = {
                reportId,
                patientId,
                reportType,
                deletedBy,
                totalReports,
                timestamp: new Date(),
                source: 'socket_event',
                message: `تم حذف تقرير ${reportType} بواسطة ${deletedBy}`
            };

            socket.to(`clinic_${clinicId}`).emit('report_deleted_realtime', deletionData);
            socket.to(`patient_${patientId}`).emit('report_deleted_detailed_realtime', deletionData);

        } catch (error) {
            console.error('Report deletion notification error:', error);
        }
    });
};

/**
 * Initialize all report handlers
 */
export const initializeReportHandlers = (socket) => {
    handleReportCreated(socket);
    handleReportStatusChanged(socket);
    handleReportDeleted(socket);
};
