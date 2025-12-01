import { clerkClient } from '@clerk/clerk-sdk-node';
import pool from '../db/index.js';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

if (!CLERK_SECRET_KEY) {
  console.warn('CLERK_SECRET_KEY not set. Authentication will be disabled.');
}

// Get or create user from Clerk
export async function getOrCreateUser(clerkUserId, clerkUserData) {
  const client = await pool.connect();
  try {
    // Check if user exists
    let result = await client.query(
      'SELECT * FROM users WHERE clerk_user_id = $1',
      [clerkUserId]
    );

    if (result.rows.length > 0) {
      const existingUser = result.rows[0];
      
      // Update user data if it has changed
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;
      
      if (clerkUserData.emailAddresses?.[0]?.emailAddress !== existingUser.email) {
        updateFields.push(`email = $${++paramCount}`);
        updateValues.push(clerkUserData.emailAddresses[0].emailAddress);
      }
      if (clerkUserData.firstName !== existingUser.first_name) {
        updateFields.push(`first_name = $${++paramCount}`);
        updateValues.push(clerkUserData.firstName);
      }
      if (clerkUserData.lastName !== existingUser.last_name) {
        updateFields.push(`last_name = $${++paramCount}`);
        updateValues.push(clerkUserData.lastName);
      }
      if (clerkUserData.username !== existingUser.username) {
        updateFields.push(`username = $${++paramCount}`);
        updateValues.push(clerkUserData.username);
      }
      if (clerkUserData.imageUrl !== existingUser.image_url) {
        updateFields.push(`image_url = $${++paramCount}`);
        updateValues.push(clerkUserData.imageUrl);
      }
      if (clerkUserData.phoneNumbers?.[0]?.phoneNumber !== existingUser.phone_number) {
        updateFields.push(`phone_number = $${++paramCount}`);
        updateValues.push(clerkUserData.phoneNumbers?.[0]?.phoneNumber || null);
      }
      
      if (updateFields.length > 0) {
        updateValues.push(clerkUserId);
        const updateQuery = `
          UPDATE users 
          SET ${updateFields.join(', ')}
          WHERE clerk_user_id = $1
          RETURNING *
        `;
        result = await client.query(updateQuery, updateValues);
        return result.rows[0];
      }
      
      return existingUser;
    }

    // Create new user
    result = await client.query(
      `INSERT INTO users (
        clerk_user_id, 
        email, 
        first_name, 
        last_name, 
        username, 
        image_url, 
        phone_number,
        metadata
      ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [
        clerkUserId,
        clerkUserData.emailAddresses?.[0]?.emailAddress || '',
        clerkUserData.firstName || null,
        clerkUserData.lastName || null,
        clerkUserData.username || null,
        clerkUserData.imageUrl || null,
        clerkUserData.phoneNumbers?.[0]?.phoneNumber || null,
        JSON.stringify(clerkUserData.publicMetadata || {})
      ]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

// Verify Clerk token and get user
export async function verifyAuth(req) {
  if (!CLERK_SECRET_KEY) {
    // Development mode - allow bypass
    return { userId: 'dev-user', email: 'dev@example.com' };
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No authorization token provided');
  }

  const token = authHeader.replace('Bearer ', '');
  
  try {
    // Verify token with Clerk
    const session = await clerkClient.verifyToken(token);
    const clerkUser = await clerkClient.users.getUser(session.sub);
    
    // Get or create user in our DB with full user data
    const dbUser = await getOrCreateUser(clerkUser.id, {
      emailAddresses: clerkUser.emailAddresses,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      username: clerkUser.username,
      imageUrl: clerkUser.imageUrl,
      phoneNumbers: clerkUser.phoneNumbers,
      publicMetadata: clerkUser.publicMetadata
    });
    
    return {
      userId: dbUser.id,
      clerkUserId: clerkUser.id,
      email: dbUser.email,
      firstName: dbUser.first_name,
      lastName: dbUser.last_name,
      username: dbUser.username,
      imageUrl: dbUser.image_url
    };
  } catch (error) {
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

// Middleware for protected routes
export function requireAuth() {
  return async (req, res, next) => {
    try {
      const user = await verifyAuth(req);
      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  };
}

