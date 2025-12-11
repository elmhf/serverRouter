import { supabaseAdmin ,supabaseUser} from '../../supabaseClient.js';
import { getPatientReportsCount } from './reportHandlers.js';

// Store Supabase realtime subscriptions
const realtimeSubscriptions = new Map();

// 🆕 Cache للتقارير - يحل مشكلة البيانات المفقودة عند الحذف
const reportCache = new Map();

// 🆕 تنظيف الكاش كل ساعة لمنع تراكم البيانات
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000; // ساعة واحدة
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 ساعة

setInterval(() => {
    const now = Date.now();
    for (const [reportId, data] of reportCache.entries()) {
        if (now - data.cachedAt > MAX_CACHE_AGE) {
            reportCache.delete(reportId);
        }
    }
    console.log(`🧹 Cache cleanup completed. Current size: ${reportCache.size}`);
}, CACHE_CLEANUP_INTERVAL);

/**
 * Initialize Supabase realtime subscriptions for reports and notifications
 */
export const initializeRealtimeSubscriptions = (io) => {
    console.log('🔌 Initializing Supabase realtime subscriptions...');

    // Report UPDATE subscription
    const reportUpdateSubscription = supabaseAdmin
        .channel('report_status_changes')
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'report_ai'
            },
            async (payload) => {
                console.log('📊 Report updated in database:', payload);

                try {
                    const { new: newRecord, old: oldRecord } = payload;

                    // تحديث الكاش بالبيانات الجديدة
                    const cachedData = reportCache.get(newRecord.report_id);
                    if (cachedData) {
                        reportCache.set(newRecord.report_id, {
                            ...cachedData,
                            status: newRecord.status,
                            updatedAt: Date.now()
                        });
                    }

                    // فحص إذا كان oldRecord يحتوي على status
                    if (!oldRecord.status) {
                        console.log('⚠️ Old record missing status, fetching from database...');

                        const { data: oldReport, error: oldError } = await supabaseUser
                            .from('report_ai')
                            .select('status')
                            .eq('report_id', newRecord.report_id)
                            .maybeSingle();

                        if (oldError) {
                            console.error('Error fetching old status:', oldError);
                            return;
                        }

                        if (!oldReport) {
                            console.log('⚠️ Old report not found, using unknown status');
                            oldRecord.status = 'unknown';
                        } else {
                            oldRecord.status = oldReport.status;
                        }

                        console.log(`📊 Status changed from ${oldRecord.status} to ${newRecord.status}`);
                    } else {
                        if (oldRecord.status === newRecord.status) {
                            console.log('📊 Status unchanged, skipping notification');
                            return;
                        }

                        console.log(`📊 Status changed from ${oldRecord.status} to ${newRecord.status}`);
                    }

                    // Get patient and clinic information
                    const { data: patient, error: patientError } = await supabaseUser
                        .from('patients')
                        .select('clinic_id, first_name, last_name')
                        .eq('id', newRecord.patient_id)
                        .single();

                    if (patientError) {
                        console.error('Error fetching patient data:', patientError);
                        return;
                    }

                    const clinicId = patient.clinic_id;
                    const patientName = `${patient.first_name} ${patient.last_name}`;
                    const oldStatus = oldRecord.status || 'unknown';

                    const totalReports = await getPatientReportsCount(newRecord.patient_id);

                    // Emit WebSocket event to clinic members
                    io.to(`clinic_${clinicId}`).emit('report_status_changed_realtime', {
                        reportId: newRecord.report_id,
                        patientId: newRecord.patient_id,
                        patientName: patientName,
                        oldStatus: oldStatus,
                        newStatus: newRecord.status,
                        reportType: newRecord.raport_type,
                        timestamp: new Date(),
                        source: 'database_realtime',
                        totalReports: totalReports,
                        report: {
                            id: newRecord.report_id,
                            created_at: newRecord.created_at,
                            raport_type: newRecord.raport_type,
                            patient_id: newRecord.patient_id,
                            status: newRecord.status,
                            report_url: newRecord.report_url,
                            data_url: newRecord.data_url
                        }
                    });

                    // Also emit to users specifically viewing this patient
                    io.to(`patient_${newRecord.patient_id}`).emit('report_status_changed_detailed_realtime', {
                        reportId: newRecord.report_id,
                        patientId: newRecord.patient_id,
                        patientName: patientName,
                        oldStatus: oldStatus,
                        newStatus: newRecord.status,
                        reportType: newRecord.raport_type,
                        timestamp: new Date(),
                        source: 'database_realtime',
                        totalReports: totalReports,
                        report: {
                            id: newRecord.report_id,
                            created_at: newRecord.created_at,
                            raport_type: newRecord.raport_type,
                            patient_id: newRecord.patient_id,
                            status: newRecord.status,
                            report_url: newRecord.report_url,
                            data_url: newRecord.data_url
                        }
                    });

                    console.log(`📊 Real-time notification sent for report ${newRecord.report_id}: ${oldStatus} → ${newRecord.status}`);

                } catch (error) {
                    console.error('Error processing realtime report status change:', error);
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'report_ai'
            },
            async (payload) => {
                console.log('📊 New report created in database:', payload);

                try {
                    const { new: newRecord } = payload;

                    // إضافة التقرير للكاش عند الإنشاء
                    const reportCacheData = {
                        report_id: newRecord.report_id,
                        patient_id: newRecord.patient_id,
                        raport_type: newRecord.raport_type,
                        status: newRecord.status,
                        created_at: newRecord.created_at,
                        report_url: newRecord.report_url,
                        data_url: newRecord.data_url,
                        cachedAt: Date.now()
                    };

                    reportCache.set(newRecord.report_id, reportCacheData);
                    console.log(`💾 Report ${newRecord.report_id} cached. Cache size: ${reportCache.size}`);

                    // Get patient and clinic information
                    const { data: patient, error: patientError } = await supabaseUser
                        .from('patients')
                        .select('clinic_id, first_name, last_name')
                        .eq('id', newRecord.patient_id)
                        .maybeSingle();

                    if (patientError) {
                        console.error('Error fetching patient data:', patientError);
                        return;
                    }

                    if (!patient) {
                        console.error('Patient not found:', newRecord.patient_id);
                        return;
                    }

                    const clinicId = patient.clinic_id;
                    const patientName = `${patient.first_name} ${patient.last_name}`;

                    // إضافة معلومات المريض والعيادة للكاش
                    reportCacheData.clinic_id = clinicId;
                    reportCacheData.patient_name = patientName;
                    reportCache.set(newRecord.report_id, reportCacheData);

                    const totalReports = await getPatientReportsCount(newRecord.patient_id);

                    // Emit WebSocket event to clinic members
                    const reportEventData = {
                        reportId: newRecord.report_id,
                        patientId: newRecord.patient_id,
                        patientName: patientName,
                        reportType: newRecord.raport_type,
                        status: newRecord.status,
                        timestamp: new Date(),
                        source: 'database_realtime',
                        totalReports: totalReports,
                        report: {
                            id: newRecord.report_id,
                            created_at: newRecord.created_at,
                            raport_type: newRecord.raport_type,
                            patient_id: newRecord.patient_id,
                            status: newRecord.status,
                            report_url: newRecord.report_url,
                            data_url: newRecord.data_url
                        },
                        clinicId: clinicId,
                        message: `تم إنشاء تقرير ${newRecord.raport_type} جديد للمريض ${patientName}`
                    };

                    io.to(`clinic_${clinicId}`).emit('report_created_realtime', reportEventData);
                    io.to(`patient_${newRecord.patient_id}`).emit('report_created_realtime', reportEventData);

                    console.log(`📊 Real-time notification sent for new report ${newRecord.report_id}`);

                } catch (error) {
                    console.error('Error processing realtime report creation:', error);
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'DELETE',
                schema: 'public',
                table: 'report_ai'
            },
            async (payload) => {
                console.log('📊 Report deleted in database:', payload);

                try {
                    const { old: oldRecord } = payload;
                    console.log('🗑️ Deleted report ID:', oldRecord.report_id);

                    // محاولة الحصول على البيانات من الكاش أولاً
                    const cachedReportData = reportCache.get(oldRecord.report_id);

                    let patientInfo = null;
                    let reportInfo = null;

                    if (cachedReportData) {
                        console.log('💾 Found report data in cache:', cachedReportData);

                        patientInfo = {
                            clinic_id: cachedReportData.clinic_id,
                            first_name: cachedReportData.patient_name?.split(' ')[0] || 'مريض',
                            last_name: cachedReportData.patient_name?.split(' ').slice(1).join(' ') || 'غير محدد'
                        };

                        reportInfo = {
                            report_id: cachedReportData.report_id,
                            patient_id: cachedReportData.patient_id,
                            raport_type: cachedReportData.raport_type,
                            status: cachedReportData.status,
                            report_url: cachedReportData.report_url,
                            data_url: cachedReportData.data_url
                        };

                        reportCache.delete(oldRecord.report_id);
                        console.log(`🗑️ Removed from cache. New cache size: ${reportCache.size}`);

                    } else {
                        console.log('⚠️ Report not found in cache, trying database...');

                        if (oldRecord.patient_id) {
                            try {
                                const { data: patient, error: patientError } = await supabaseUser
                                    .from('patients')
                                    .select('clinic_id, first_name, last_name')
                                    .eq('id', oldRecord.patient_id)
                                    .maybeSingle();

                                if (!patientError && patient) {
                                    patientInfo = patient;
                                }
                            } catch (error) {
                                console.log('⚠️ Could not fetch patient info for deleted report');
                            }
                        }

                        reportInfo = oldRecord;
                    }

                    const deletionNotification = {
                        reportId: oldRecord.report_id,
                        patientId: reportInfo?.patient_id || oldRecord.patient_id,
                        reportType: reportInfo?.raport_type || 'غير محدد',
                        timestamp: new Date(),
                        source: 'database_realtime',
                        deletedReport: reportInfo || oldRecord,
                        ...(patientInfo && {
                            patientName: `${patientInfo.first_name} ${patientInfo.last_name}`,
                            clinicId: patientInfo.clinic_id,
                            message: `تم حذف تقرير ${reportInfo?.raport_type || 'غير محدد'} للمريض ${patientInfo.first_name} ${patientInfo.last_name}`
                        }),
                        ...(!patientInfo && {
                            message: `تم حذف التقرير ${oldRecord.report_id}`
                        })
                    };

                    const patientIdForCount = reportInfo?.patient_id || oldRecord.patient_id;
                    if (patientIdForCount) {
                        const totalReports = await getPatientReportsCount(patientIdForCount);
                        deletionNotification.totalReports = totalReports;
                    }

                    if (patientInfo && patientInfo.clinic_id) {
                        io.to(`clinic_${patientInfo.clinic_id}`).emit('report_deleted_realtime', deletionNotification);

                        if (deletionNotification.patientId) {
                            io.to(`patient_${deletionNotification.patientId}`).emit('report_deleted_detailed_realtime', deletionNotification);
                        }

                        console.log(`🗑️ Deletion notification sent to clinic ${patientInfo.clinic_id}`);
                    } else {
                        io.emit('report_deleted_realtime', deletionNotification);
                        console.log(`🗑️ General deletion notification sent`);
                    }

                } catch (error) {
                    console.error('Error processing realtime report deletion:', error);
                }
            }
        )
        .subscribe((status) => {
            console.log('🔌 Report subscription status:', status);

            if (status === 'SUBSCRIBED') {
                console.log('✅ Report realtime subscription active');
            } else if (status === 'CHANNEL_ERROR') {
                console.error('❌ Report realtime subscription error');
                setTimeout(() => {
                    console.log('🔄 Retrying subscription...');
                    initializeRealtimeSubscriptions(io);
                }, 5000);
            }
        });

    realtimeSubscriptions.set('report_status_changes', reportUpdateSubscription);

    // Notification INSERT subscription
    const notificationSubscription = supabaseUser
        .channel('notification_changes')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications'
            },
            async (payload) => {
                console.log('🔔 New notification created in database:', payload);

                try {
                    const { new: newNotification } = payload;

                    // Emit notification to the specific user
                    io.to(`user_${newNotification.user_id}`).emit('new_notification', {
                        id: newNotification.id,
                        user_id: newNotification.user_id,
                        title: newNotification.title,
                        message: newNotification.message,
                        type: newNotification.type,
                        is_read: newNotification.is_read,
                        token: newNotification.token,
                        meta_data: newNotification.meta_data,
                        created_at: newNotification.created_at,
                        timestamp: new Date(),
                        source: 'database_realtime'
                    });

                    console.log(`🔔 Notification sent to user ${newNotification.user_id}`);

                } catch (error) {
                    console.error('Error processing realtime notification:', error);
                }
            }
        )
        .subscribe((status) => {
            console.log('🔔 Notification subscription status:', status);

            if (status === 'SUBSCRIBED') {
                console.log('✅ Notification realtime subscription active');
            } else if (status === 'CHANNEL_ERROR') {
                console.error('❌ Notification realtime subscription error');
            }
        });

    realtimeSubscriptions.set('notification_changes', notificationSubscription);
};

/**
 * Cleanup function for realtime subscriptions
 */
export const cleanupRealtimeSubscriptions = () => {
    console.log('🧹 Cleaning up realtime subscriptions...');

    for (const [name, subscription] of realtimeSubscriptions.entries()) {
        subscription.unsubscribe();
        console.log(`✅ Unsubscribed from ${name}`);
    }

    realtimeSubscriptions.clear();
    reportCache.clear();
    console.log('🗑️ Report cache cleared');
};

/**
 * Get cache info for debugging
 */
export const getCacheInfo = () => {
    return {
        size: reportCache.size,
        reports: Array.from(reportCache.keys())
    };
};

/**
 * Manual report deletion emission helper
 */
export const emitReportDeletion = async (io, clinicId, patientId, reportData, deletedBy) => {
    if (reportData.report_id && !reportCache.has(reportData.report_id)) {
        reportCache.set(reportData.report_id, {
            report_id: reportData.report_id || reportData.id,
            patient_id: reportData.patient_id,
            raport_type: reportData.raport_type,
            status: reportData.status,
            clinic_id: clinicId,
            cachedAt: Date.now()
        });
    }

    const totalReports = await getPatientReportsCount(patientId);
    const remainingReports = Math.max(0, totalReports - 1);

    const deletionData = {
        reportId: reportData.report_id || reportData.id,
        patientId: reportData.patient_id,
        reportType: reportData.raport_type,
        deletedBy: deletedBy,
        timestamp: new Date(),
        source: 'manual_deletion',
        deletedReport: reportData,
        clinicId: clinicId,
        totalReports: remainingReports,
        message: `تم حذف تقرير ${reportData.raport_type} بواسطة ${deletedBy}`
    };

    io.to(`clinic_${clinicId}`).emit('report_deleted_realtime', deletionData);
    io.to(`patient_${patientId}`).emit('report_deleted_detailed_realtime', deletionData);

    console.log(`🗑️ Manual deletion notification sent for report ${reportData.report_id || reportData.id}`);
};

export { reportCache };
