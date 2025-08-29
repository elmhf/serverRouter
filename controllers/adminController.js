import {supabaseAdmin} from '../supabaseClient.js';

// ✅ مثال: جيب جميع المستخدمين
export const getAllUsers = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*');

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ مثال: عمل promote لمستخدم (يولي admin)
export const promoteToAdmin = async (req, res) => {
  const { userId } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ role: 'admin' })
      .eq('id', userId);

    if (error) throw error;

    res.json({ message: 'User promoted to admin', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ مثال: حذف user
export const deleteUser = async (req, res) => {
  const { userId } = req.params;

  try {
    const { error } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) throw error;

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
