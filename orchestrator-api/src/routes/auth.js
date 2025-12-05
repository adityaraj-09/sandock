import express from 'express';
import { registerUser, loginUser } from '../services/auth.js';
import { z } from 'zod';

const router = express.Router();

// Register a new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, username } = req.body;

    const result = await registerUser({
      email,
      password,
      firstName,
      lastName,
      username
    });

    res.status(201).json({
      success: true,
      user: result.user,
      token: result.token,
      message: 'User registered successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data', 
        details: error.errors 
      });
    }
    
    if (error.message === 'User with this email already exists') {
      return res.status(409).json({ error: error.message });
    }

    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await loginUser(email, password);

    res.json({
      success: true,
      user: result.user,
      token: result.token,
      message: 'Login successful'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data', 
        details: error.errors 
      });
    }

    if (error.message === 'Invalid email or password') {
      return res.status(401).json({ error: error.message });
    }

    console.error('Error logging in user:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

export default router;

