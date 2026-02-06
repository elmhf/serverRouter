import 'dotenv/config';
import express, { json } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import clinicRoutes from './routes/clinicRoutes.js';
import permissionRoutes from './routes/permissionRoutes.js';
import teethRoutes from './routes/teethRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import notificationRoutes from './routes/notificationRouter.js';
import securityRoutes from './routes/securityRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import storageRoutes from './routes/storageRoutes.js';
import cookieParser from 'cookie-parser';
import { initializeSocket } from './sockets/index.js';



const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://xdant.vercel.app", "https://xdental-frontend.up.railway.app","https://serverrouter.onrender.com","https://xdant.vercel.app"],
    credentials: true
  }
});

// Initialize WebSocket functionality
const socketManager = initializeSocket(io);

// Export io instance for use in other modules
export { io };

// Make io available in app.locals for controllers
app.locals.io = io;


app.use(cors({
  origin: ["http://localhost:3000", "https://xdant.vercel.app", "https://xdental-frontend.up.railway.app","https://serverrouter.onrender.com","https://xdant.vercel.app"], // Allow specific origins
  credentials: true
}));
app.use(json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/storage', storageRoutes);
app.use('/api/clinics', clinicRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/teeth', teethRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes)
import testRoutes from './routes/testRoutes.js';

app.use('/api/security', securityRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/test', testRoutes);
// Serve static files
app.use('/uploads', express.static('uploads'));

// WebSocket connection status and stats endpoint
import { supabaseUser } from './supabaseClient.js';

app.get('/api/socket/status', async (req, res) => {
  try {
    // 1. Get online users with device info
    const connectedUsers = socketManager.getConnectedUsers();

    // 2. Get total registered users count
    const { count, error } = await supabaseUser
      .from('user')
      .select('*', { count: 'exact', head: true });

    res.json({
      status: 'online',
      onlineUsersCount: connectedUsers.length,
      totalRegisteredUsers: count || 0,
      onlineUsers: connectedUsers.map(u => ({
        socketId: u.socketId,
        userId: u.userId,
        clinicId: u.clinicId,
        currentPatientId: u.currentPatientId,
        device: u.userAgent, // Added device info
        ip: u.ip            // Added IP info
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔌 WebSocket server initialized`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server gracefully...');
  process.exit(0);
});
