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

import cookieParser from 'cookie-parser';
import { initializeSocket } from './controllers/socketController.js';



const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    credentials: true
  }
});

// Initialize WebSocket functionality
const socketManager = initializeSocket(io);



app.use(cors({
    origin: 'http://localhost:3000', // your frontend URL
    credentials: true
  }));
app.use(json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/clinics', clinicRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/teeth', teethRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/reports', reportRoutes);


// Serve static files
app.use('/uploads', express.static('uploads'));

// WebSocket connection status endpoint
app.get('/api/socket/status', (req, res) => {
  res.json({
    connectedUsers: socketManager.getConnectedUsersCount(),
    status: 'WebSocket server is running'
  });
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
