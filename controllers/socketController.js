import { initializeRealtimeSubscriptions, cleanupRealtimeSubscriptions, getCacheInfo } from './socket/realtimeSubscriptions.js';
import { initializeNotificationHandlers } from './socket/notificationHandlers.js';
import { initializeUserHandlers } from './socket/userHandlers.js';
import { initializePatientHandlers } from './socket/patientHandlers.js';
import { initializeReportHandlers } from './socket/reportHandlers.js';
import { initializeMessagingHandlers } from './socket/messagingHandlers.js';

// Store connected users and their clinic/patient info
const connectedUsers = new Map();

/**
 * Initialize Socket.IO server with all event handlers
 */
export const initializeSocket = (io) => {
  console.log('🔌 WebSocket server initialized');

  // Initialize Supabase realtime for report status changes and notifications
  initializeRealtimeSubscriptions(io);

  io.on('connection', (socket) => {
    console.log(`🔗 User connected: ${socket.id}`);

    // Initialize all handlers
    initializeUserHandlers(socket, connectedUsers);
    initializeNotificationHandlers(socket);
    initializePatientHandlers(socket, connectedUsers);
    initializeReportHandlers(socket);
    initializeMessagingHandlers(socket);

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
    getCacheInfo: getCacheInfo
  };
};

// Export helper functions and cleanup
export { cleanupRealtimeSubscriptions };
export { emitReportDeletion } from './socket/realtimeSubscriptions.js';
export { emitToUser, emitToClinic, emitToPatient } from './socket/helpers.js';