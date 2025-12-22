import { initializeRealtimeSubscriptions, cleanupRealtimeSubscriptions, getCacheInfo } from './services/supabaseRealtime.js';
import { initializeNotificationHandlers } from './handlers/notificationHandlers.js';
import { initializeUserHandlers } from './handlers/userHandlers.js';
import { initializePatientHandlers } from './handlers/patientHandlers.js';
import { initializeReportHandlers } from './handlers/reportHandlers.js';
import { initializeMessagingHandlers } from './handlers/messagingHandlers.js';

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
export { emitReportDeletion } from './services/supabaseRealtime.js';
export { emitToUser, emitToClinic, emitToPatient } from './utils/helpers.js';
