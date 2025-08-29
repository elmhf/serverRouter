const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export default function validateSignupInput(req, res, next) {
  const { email, password, firstName, lastName } = req.body;

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First and last name are required' });
  }

  next();
} 