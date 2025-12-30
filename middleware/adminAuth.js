import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../supabaseClient.js';

export async function adminAuthMiddleware(req, res, next) {
    let token = req.cookies?.access_token;

    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');

        // Check if it's an admin token
        if (decoded.role !== 'admin' || decoded.type !== 'admin_token') {
            return res.status(403).json({ error: 'Not authorized as admin' });
        }
        console.log(decoded,"----------------------");
        // Verify against Admins table
        const { data: admin, error } = await supabaseAdmin
            .from('Admins')
            .select('*')
            .eq('admin_id', decoded.id)
            .single();

        if (error || !admin) {
            console.error('Admin auth failed: Admin not found in table', error);
            return res.status(401).json({ error: 'Admin not found or invalid token' });
        }
        console.log(admin,"----------------------");
        req.user = admin;
        next();

    } catch (error) {
        console.error('Admin auth middleware error:', error);
        return res.status(401).json({ error: 'Invalid token' });
    }
}
