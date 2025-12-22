import { supabaseAdmin, supabaseUser } from '../supabaseClient.js';
import { clearAllNotificationsByUserId, markAllNotificationsAsRead } from '../utils/notification.js';

export async function getNotificationsByUserId(userId) {
  const { data, error } = await supabaseUser
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Error fetching notifications:", error);
    return [];
  }
  return { data, error };
}

export const getUserNotifications = async (req, res) => {
  console.log('fetch notification ------fffff---------')
  try {
    const userId = req.user?.id;
    console.log('userId', userId)
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing",
      });
    }

    const { data, error } = await getNotificationsByUserId(userId);

    if (error) {
      return res.status(500).json({
        success: false,
        message: "musta7il notifications tjik tawa 😂",
      });
    }

    return res.status(200).json({
      success: true,
      notifications: data,
    });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error ya queen 😭",
    });
  }
};

export const markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { notificationId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing",
      });
    }

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: "Notification ID missing",
      });
    }

    const { error } = await supabaseUser
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to mark notification as read",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing",
      });
    }

    const { data, error } = await markAllNotificationsAsRead(userId);

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to mark all notifications as read",
      });
    }

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read successfully",
      updatedCount: data?.length || 0,
    });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const clearAllNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing",
      });
    }

    const { data, error } = await clearAllNotificationsByUserId(userId);

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to clear notifications",
      });
    }

    return res.status(200).json({
      success: true,
      message: "All notifications cleared successfully",
      deletedCount: data?.length || 0,
    });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};