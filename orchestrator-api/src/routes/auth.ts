import { Router, Request, Response } from 'express';
import { registerUser, loginUser } from '../services/auth.js';
import { z } from 'zod';

const router = Router();

router.post('/register', async (req: Request, res: Response): Promise<void> => {
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
      res.status(400).json({
        error: 'Invalid request data',
        details: error.errors
      });
      return;
    }

    if ((error as Error).message === 'User with this email already exists') {
      res.status(409).json({ error: (error as Error).message });
      return;
    }

    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
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
      res.status(400).json({
        error: 'Invalid request data',
        details: error.errors
      });
      return;
    }

    if ((error as Error).message === 'Invalid email or password') {
      res.status(401).json({ error: (error as Error).message });
      return;
    }

    console.error('Error logging in user:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

export default router;
