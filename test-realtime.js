/**
 * Script للتحقق من حالة Supabase Realtime للإشعارات
 */

import { supabaseUser } from './supabaseClient.js';

console.log('🔍 Testing Supabase Realtime for notifications...\n');

// اختبار الاتصال
const testRealtime = async () => {
    console.log('1️⃣ Creating test subscription...');

    const channel = supabaseUser
        .channel('test_notifications')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications'
            },
            (payload) => {
                console.log('✅ REALTIME WORKING! Received:', payload);
            }
        )
        .subscribe((status) => {
            console.log('📡 Subscription status:', status);

            if (status === 'SUBSCRIBED') {
                console.log('✅ Successfully subscribed to notifications table');
                console.log('\n2️⃣ Now add a test notification from Supabase Dashboard');
                console.log('   or run: npm run test:notification');
            } else if (status === 'CHANNEL_ERROR') {
                console.error('❌ Failed to subscribe!');
                console.error('\nPossible reasons:');
                console.error('1. Realtime not enabled on notifications table');
                console.error('2. RLS policies blocking access');
                console.error('3. Network/connection issue');
                console.error('\nTo fix:');
                console.error('1. Go to Supabase Dashboard → Database → Replication');
                console.error('2. Enable Realtime for "notifications" table');
                console.error('3. Run: ALTER TABLE notifications REPLICA IDENTITY FULL;');
            }
        });

    // Keep script running
    console.log('\n⏳ Listening for notifications... (Press Ctrl+C to exit)\n');
};

testRealtime();
