import { supabaseUser } from '../supabaseClient.js';

// Store connected users and their clinic/patient info
const connectedUsers = new Map();

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

// 🆕 دالة مساعدة لجلب عدد التقارير للمريض
const getPatientReportsCount = async (patientId) => {
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

export const initializeSocket = (io) => {
  console.log('🔌 WebSocket server initialized');

  // Initialize Supabase realtime for report status changes
  initializeRealtimeSubscriptions(io);

  io.on('connection', (socket) => {
    console.log(`🔗 User connected: ${socket.id}`);

    // Handle user login and clinic selection
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

    // Handle patient selection
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

    // Handle patient updates (real-time notifications)
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

    // Handle report creation notifications
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
          totalReports, // 🆕 إضافة العدد الإجمالي
          timestamp: new Date()
        });

      } catch (error) {
        console.error('Report creation notification error:', error);
      }
    });

    // Handle report status change notifications
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
          totalReports, // 🆕 إضافة العدد الإجمالي
          timestamp: new Date()
        });

        // Also notify users specifically viewing this patient
        socket.to(`patient_${patientId}`).emit('report_status_changed_detailed', {
          reportId,
          patientId,
          oldStatus,
          newStatus,
          updatedBy,
          totalReports, // 🆕 إضافة العدد الإجمالي
          timestamp: new Date()
        });

      } catch (error) {
        console.error('Report status change notification error:', error);
      }
    });

    // Handle report deletion notifications
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
          totalReports, // 🆕 إضافة العدد الإجمالي
          timestamp: new Date(),
          source: 'socket_event',
          message: `تم حذف تقرير ${reportType} بواسطة ${deletedBy}`
        };

        // استخدام نفس أسماء الأحداث
        socket.to(`clinic_${clinicId}`).emit('report_deleted_realtime', deletionData);
        socket.to(`patient_${patientId}`).emit('report_deleted_detailed_realtime', deletionData);

      } catch (error) {
        console.error('Report deletion notification error:', error);
      }
    });

    // Handle real-time chat/messages
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

    // Handle user typing indicators
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

    // Handle user activity (online status)
    socket.on('user_activity', (data) => {
      const { userId, clinicId, activity } = data;
      
      socket.to(`clinic_${clinicId}`).emit('user_activity_update', {
        userId,
        activity,
        timestamp: new Date()
      });
    });

    // Handle disconnection
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

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  // Return connected users info for debugging
  return {
    getConnectedUsers: () => {
      return Array.from(connectedUsers.values());
    },
    getConnectedUsersCount: () => {
      return connectedUsers.size;
    },
    // 🆕 معلومات الكاش للتصحيح
    getCacheInfo: () => {
      return {
        size: reportCache.size,
        reports: Array.from(reportCache.keys())
      };
    }
  };
};

// 🆕 تحسين initialize realtime subscriptions
const initializeRealtimeSubscriptions = (io) => {
  console.log('🔌 Initializing Supabase realtime subscriptions...');

  const subscription = supabaseUser
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
            
            // جلب الـ old status من قاعدة البيانات
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

          // 🆕 جلب عدد التقارير للمريض
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
            totalReports: totalReports, // 🆕 إضافة العدد الإجمالي
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
            totalReports: totalReports, // 🆕 إضافة العدد الإجمالي
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

          console.log(`📊 Real-time notification sent for report ${newRecord.report_id}: ${oldStatus} → ${newRecord.status} ${totalReports}`);

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
          
          // 🆕 إضافة التقرير للكاش عند الإنشاء
          const reportCacheData = {
            report_id: newRecord.report_id,
            patient_id: newRecord.patient_id,
            raport_type: newRecord.raport_type,
            status: newRecord.status,
            created_at: newRecord.created_at,
            report_url: newRecord.report_url,
            data_url: newRecord.data_url,
            cachedAt: Date.now() // لتتبع عمر البيانات
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

          // 🆕 إضافة معلومات المريض والعيادة للكاش
          reportCacheData.clinic_id = clinicId;
          reportCacheData.patient_name = patientName;
          reportCache.set(newRecord.report_id, reportCacheData);

          // 🆕 جلب عدد التقارير للمريض (بعد الإضافة)
          const totalReports = await getPatientReportsCount(newRecord.patient_id);

          // Emit WebSocket event to clinic members with complete report data
          const reportEventData = {
            reportId: newRecord.report_id,
            patientId: newRecord.patient_id,
            patientName: patientName,
            reportType: newRecord.raport_type,
            status: newRecord.status,
            timestamp: new Date(),
            source: 'database_realtime',
            totalReports: totalReports, // 🆕 إضافة العدد الإجمالي
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

          // 🆕 محاولة الحصول على البيانات من الكاش أولاً
          const cachedReportData = reportCache.get(oldRecord.report_id);
          
          let patientInfo = null;
          let reportInfo = null;

          if (cachedReportData) {
            // ✅ البيانات متوفرة في الكاش
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

            // إزالة من الكاش
            reportCache.delete(oldRecord.report_id);
            console.log(`🗑️ Removed from cache. New cache size: ${reportCache.size}`);
            
          } else {
            // ⚠️ البيانات غير متوفرة في الكاش - محاولة جلبها من قاعدة البيانات
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

          // إنشاء إشعار الحذف
          const deletionNotification = {
            reportId: oldRecord.report_id,
            patientId: reportInfo?.patient_id || oldRecord.patient_id,
            reportType: reportInfo?.raport_type || 'غير محدد',
            timestamp: new Date(),
            source: 'database_realtime',
            deletedReport: reportInfo || oldRecord,
            // إضافة معلومات المريض والعيادة إذا كانت متوفرة
            ...(patientInfo && {
              patientName: `${patientInfo.first_name} ${patientInfo.last_name}`,
              clinicId: patientInfo.clinic_id,
              message: `تم حذف تقرير ${reportInfo?.raport_type || 'غير محدد'} للمريض ${patientInfo.first_name} ${patientInfo.last_name}`
            }),
            // رسالة افتراضية إذا لم تكن المعلومات متوفرة
            ...(!patientInfo && {
              message: `تم حذف التقرير ${oldRecord.report_id}`
            })
          };

          // 🆕 جلب عدد التقارير المتبقية للمريض (بعد الحذف)
          const patientIdForCount = reportInfo?.patient_id || oldRecord.patient_id;
          if (patientIdForCount) {
            const totalReports = await getPatientReportsCount(patientIdForCount);
            deletionNotification.totalReports = totalReports;
          }

          // إرسال الإشعارات
          if (patientInfo && patientInfo.clinic_id) {
            // إرسال للعيادة المحددة
            io.to(`clinic_${patientInfo.clinic_id}`).emit('report_deleted_realtime', deletionNotification);
            
            // إرسال لمشاهدي المريض المحدد
            if (deletionNotification.patientId) {
              io.to(`patient_${deletionNotification.patientId}`).emit('report_deleted_detailed_realtime', deletionNotification);
            }
            
            console.log(`🗑️ Deletion notification sent to clinic ${patientInfo.clinic_id} for report: ${oldRecord.report_id}`);
          } else {
            // إرسال عام إذا لم نتمكن من تحديد العيادة
            io.emit('report_deleted_realtime', deletionNotification);
            console.log(`🗑️ General deletion notification sent for report: ${oldRecord.report_id}`);
          }

        } catch (error) {
          console.error('Error processing realtime report deletion:', error);
        }
      }
    )
    .subscribe((status) => {
      console.log('🔌 Supabase realtime subscription status:', status);
      
      if (status === 'SUBSCRIBED') {
        console.log('✅ Supabase realtime subscription active');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Supabase realtime subscription error');
        // إعادة المحاولة بعد 5 ثواني
        setTimeout(() => {
          console.log('🔄 Retrying subscription...');
          initializeRealtimeSubscriptions(io);
        }, 5000);
      }
    });

  // Store subscription for cleanup
  realtimeSubscriptions.set('report_status_changes', subscription);
};

// Helper function to emit to specific users
export const emitToUser = (io, userId, event, data) => {
  for (const [socketId, userInfo] of connectedUsers.entries()) {
    if (userInfo.userId === userId) {
      io.to(socketId).emit(event, data);
    }
  }
};

// Helper function to emit to clinic
export const emitToClinic = (io, clinicId, event, data) => {
  io.to(`clinic_${clinicId}`).emit(event, data);
};

// Helper function to emit to patient viewers
export const emitToPatient = (io, patientId, event, data) => {
  io.to(`patient_${patientId}`).emit(event, data);
};

// 🆕 تحسين helper function للحذف اليدوي
export const emitReportDeletion = async (io, clinicId, patientId, reportData, deletedBy) => {
  // إضافة البيانات للكاش قبل الحذف (في حالة لم تكن موجودة)
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

  // 🆕 جلب عدد التقارير المتبقية للمريض (قبل الحذف الفعلي)
  const totalReports = await getPatientReportsCount(patientId);
  // طرح 1 لأن التقرير لم يحذف بعد من قاعدة البيانات
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
    totalReports: remainingReports, // 🆕 إضافة العدد المتبقي
    message: `تم حذف تقرير ${reportData.raport_type} بواسطة ${deletedBy}`
  };

  io.to(`clinic_${clinicId}`).emit('report_deleted_realtime', deletionData);
  io.to(`patient_${patientId}`).emit('report_deleted_detailed_realtime', deletionData);
  
  console.log(`🗑️ Manual deletion notification sent for report ${reportData.report_id || reportData.id}. Remaining reports: ${remainingReports}`);
};

// Cleanup function for realtime subscriptions
export const cleanupRealtimeSubscriptions = () => {
  console.log('🧹 Cleaning up realtime subscriptions...');
  
  for (const [name, subscription] of realtimeSubscriptions.entries()) {
    subscription.unsubscribe();
    console.log(`✅ Unsubscribed from ${name}`);
  }
  
  realtimeSubscriptions.clear();
  
  // 🆕 تنظيف الكاش أيضاً
  reportCache.clear();
  console.log('🗑️ Report cache cleared');
};